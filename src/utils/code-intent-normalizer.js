// code-intent-normalizer.js
// Single source of truth for "what does the user want to do WITH CODE" specifically —
// (not a general-purpose intent classifier; scope is intentionally code-only for now)
// replaces the scattered per-language regex lists previously duplicated across
// route.js (codeRelated/explainCodeRelated) and semantic-signal-engine.js
// (classifyQuestionType's code_improve/code_fix/... keyword lists).
//
// Flow: local dictionary (fast, free, multilingual) → if no match,
// a single small Claude haiku call classifies the intent from a fixed list.
// Result is cached per-session so the LLM fallback only ever fires once per
// distinct unmatched phrasing style, not on every message.

const KNOWN_INTENTS = [
  'code_fix',
  'code_improve',
  'code_explain',
  'code_analyze',
  'code_build',
  'general',
]

// Local multilingual dictionary — fast path. Add new languages/phrasings here,
// in ONE place, instead of touching route.js and sse.js separately.
const INTENT_PATTERNS = {
  code_fix: [
    /اصلح|أصلح|عدل|تعديل|ثغرة|خطأ|مشكلة|لا يعمل|crash|exception/i,
    /\bfix\b|\bdebug\b|\brepair\b/i,
    /korrigier|behebe|reparier|fehler/i,
    /corrige|répare|bogue|erreur/i,
  ],
  code_improve: [
    /حسّن|حسن|طبّق|طبق|نفّذ|نفذ|اختبر/i,
    /\bimprove\b|\brefactor\b|\boptimi[sz]e\b|\benhance\b|\bapply\b|\bupdate\b/i,
    /verbesser|optimier|aktualisier|anwend/i,
    /améliore|optimise|applique|mets à jour/i,
  ],
  code_explain: [
    /اشرح|شرح|وضح|فسّر|فسر/i,
    /\bexplain\b|\bdescribe\b|\bwalk me through\b/i,
    /erklär|beschreib/i,
    /explique|décris/i,
  ],
  code_analyze: [
    /حلل|تحليل|افحص|قيّم/i,
    /\banaly[sz]|\breview\b|\binspect\b|\bcheck\b/i,
    /analysier|überprüf|prüf/i,
    /analyse|vérifie|examine/i,
  ],
  code_build: [
    /ابنِ|ابن|أنشئ|انشئ|اصنع/i,
    /\bbuild\b|\bimplement\b|\bcreate\b|\badd.*feature\b/i,
    /bau|implementier|erstell/i,
    /construis|implémente|crée/i,
  ],
}

// Generic code-relatedness check — used as a coarse fallback signal when no
// specific intent matched but the text is still clearly about code.
const GENERIC_CODE_SIGNAL = [
  /كود|الكود|ملف|الملف/i,
  /\bcode\b|\bfile\b|\bfunction\b|\bclass\b/i,
  /code\b|datei|funktion|klasse/i,
  /code\b|fichier|fonction|classe/i,
]

const _sessionIntentCache = new Map() // sid -> { phraseHash -> intent }

function _hashPhrase(text) {
  const normalized = String(text || '').toLowerCase().trim().slice(0, 100)
  let h = 2166136261
  for (let i = 0; i < normalized.length; i++) { h ^= normalized.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (Math.abs(h >>> 0)).toString(36)
}

function _localMatch(questionOnly) {
  const t = String(questionOnly || '')
  for (const intent of Object.keys(INTENT_PATTERNS)) {
    if (INTENT_PATTERNS[intent].some(p => p.test(t))) return intent
  }
  return null
}

function _hasGenericCodeSignal(questionOnly) {
  const t = String(questionOnly || '')
  return GENERIC_CODE_SIGNAL.some(p => p.test(t))
}

async function _classifyViaLLM(questionOnly, timeoutMs = 8000) {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: `Classify the user's intent regarding code into exactly one of: ${KNOWN_INTENTS.join(', ')}. Reply with only the label, nothing else.`,
      messages: [{ role: 'user', content: String(questionOnly || '').slice(0, 300) }],
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const raw = data?.content?.filter(c => c.type === 'text').map(c => c.text).join('').trim().toLowerCase()
    return KNOWN_INTENTS.includes(raw) ? raw : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * normalizeIntent — the single entry point.
 *
 * @param {string} questionOnly - cleaned question text (no code blocks/tags)
 * @param {string} sid - session id, used for the LLM-fallback cache
 * @param {object} [opts]
 * @param {boolean} [opts.hasStoredCode] - whether there is prior code context in this session
 * @returns {Promise<{ intent: string, source: 'local'|'llm'|'cache'|'none', isCodeRelated: boolean }>}
 */
async function normalizeIntent(questionOnly, sid, opts = {}) {
  const t = String(questionOnly || '')
  if (!t.trim()) return { intent: 'general', source: 'none', isCodeRelated: false }

  const localIntent = _localMatch(t)
  if (localIntent) {
    return { intent: localIntent, source: 'local', isCodeRelated: true }
  }

  const genericSignal = _hasGenericCodeSignal(t)
  const hasStoredCode = !!opts.hasStoredCode

  // Only escalate to the LLM when the phrasing is genuinely ambiguous AND
  // there's a real reason to suspect code intent (generic code word present,
  // or there's already code context in this session this could be referring to).
  // Otherwise this is just an ordinary non-code question — no need to ask anything.
  if (!genericSignal && !hasStoredCode) {
    return { intent: 'general', source: 'none', isCodeRelated: false }
  }

  const phraseHash = _hashPhrase(t)
  const sessionCache = _sessionIntentCache.get(sid)
  if (sessionCache?.has(phraseHash)) {
    return { intent: sessionCache.get(phraseHash), source: 'cache', isCodeRelated: true }
  }

  const llmIntent = await _classifyViaLLM(t)
  const resolved = llmIntent || 'general'

  const cache = sessionCache ?? new Map()
  cache.set(phraseHash, resolved)
  if (cache.size > 50) cache.delete(cache.keys().next().value)
  _sessionIntentCache.set(sid, cache)

  return { intent: resolved, source: llmIntent ? 'llm' : 'none', isCodeRelated: resolved !== 'general' }
}

function clearIntentCache(sid) {
  _sessionIntentCache.delete(sid)
}

export { normalizeIntent, clearIntentCache, KNOWN_INTENTS }
