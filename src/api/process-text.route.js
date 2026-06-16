import express from 'express'
import { resolveConceptAnchors } from '../utils/concept-anchor.js'
import { cleanInput, filterStyleInstructions, detectStyleInstruction } from '../utils/context-builder.js'
import { buildSignalEngine, classifyDomain as _classifyDomain } from '../utils/semantic-signal-engine.js'
import { buildProjectContextHint, registerFile, clearProjectMap } from '../utils/celf-project-context-map.js'
import { createMemory, recall } from '../utils/spiral-memory.js'
import { updateSessionCapsule, buildSessionContext } from '../utils/session-capsule.js'

const router = express.Router()

const MAX_INPUT_CHARS      = 40000
const MAX_TEXT_MAP         = 300
const RECOVERED_CODE_LIMIT = 14000

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','fuer',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

const processingLock       = new Set()
const semanticTextMaps     = new Map()
const styleStore           = new Map()
const rawCodeStore         = new Map()
const codeSessionStore     = new Map()
const sessionMemoryStore   = new Map()
const capsuleMemory        = new Map()
const anchorMemory         = new Map()
const metricsStore         = new Map()
const _semanticState       = new Map()
const codeAnalysisStore    = new Map()
const sessionLanguageStore = new Map()

function getOrCreateMemory(sid) {
  if (!sessionMemoryStore.has(sid)) {
    const m = createMemory()
    m.loaded = true
    sessionMemoryStore.set(sid, m)
  }
  return sessionMemoryStore.get(sid)
}

const classifyDomain = _classifyDomain
const USE_SSE        = process.env.USE_SSE !== 'false'

const CELF_DEFINITION =
  'CELF AI is an intelligent conversation system ' +
  'that maintains context, preserves your goals, ' +
  'and focuses on what matters in each response ' +
  'without repetition or drift.'

const CELF_SAFE_REPLY =
  'CELF AI helps maintain conversation quality, context, and user goals. ' +
  'I can explain it at a high level, but technical internals are not available.'

const isCELFInternalQuery = (q) => {
  const t = String(q || '').toLowerCase()
  const hasCELF = /\bcelf\b/i.test(t)
  const hasInternal = /\b(كيف|how|wie|comment|come|как|nasıl|يعمل|work|داخل|internal|آلية|mechanism|signal|routing|instruction|تعليمات|توجيه|إشار|يشتغل|arbeitet|fonctionne)\b/i.test(t)
  return hasCELF && hasInternal
}

const isCELFDefinitionQuery = (q) => {
  const t = String(q || '').toLowerCase()
  const hasCELF = /\bcelf\b/i.test(t)
  const hasDefinition = /\b(ما|what|was|qu[e']|che|что|nedir|شو|إيش|يعني|هو|هي|is|sind|est|è|تعريف|define|explain|about|عن|c.est)\b/i.test(t)
  return hasCELF && hasDefinition
}

function semanticHash(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
  let h = 2166136261
  for (let i = 0; i < normalized.length; i++) { h ^= normalized.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (Math.abs(h >>> 0)).toString(36)
}

function semanticCompress(text, maxWords = 12) {
  const cleaned = String(text ?? '').replace(/```[\s\S]*?```/g, '').trim()
  const words   = cleaned.split(/\s+/).filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))
  return words.slice(0, maxWords).join(' ')
}

function jaccardSimilarity(textA, textB) {
  const setA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const setB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  if (!setA.size || !setB.size) return 0
  let overlap = 0
  for (const w of setA) if (setB.has(w)) overlap++
  return (setA.size + setB.size - overlap) > 0 ? overlap / (setA.size + setB.size - overlap) : 0
}

function extractSymbols(raw) {
  const symbols  = []
  const patterns = [
    /function\s+(\w+)/g, /class\s+(\w+)/g, /const\s+(\w+)\s*=/g,
    /router\.(get|post|put|delete|patch)\(['"](\/[^'"]*)['"]/g,
    /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
    /export\s+(class|function|const)\s+(\w+)/g
  ]
  for (const pat of patterns) {
    let m; pat.lastIndex = 0
    while ((m = pat.exec(raw)) !== null) {
      const sym = m[2] || m[1]
      if (sym && sym.length > 2) symbols.push(sym.toLowerCase())
    }
  }
  return [...new Set(symbols)].slice(0, 25)
}

function extractCodeName(raw, questionOnly = '') {
  const fileMatch = questionOnly && questionOnly.match(/\b([\w.-]+\.(js|ts|py|jsx|tsx|css|html|json))\b/)
  if (fileMatch) return fileMatch[1].replace(/\.[^.]+$/, '')
  const titleComment = raw.match(/^\/\/\s*([A-Z][A-Za-z0-9\s\-_]{3,40})\s*$/m)
  if (titleComment) return titleComment[1].trim().replace(/\s+/g, '_')
  const m =
    raw.match(/^export\s+default\s+(?:class|function)\s+(\w+)/m) ||
    raw.match(/^export\s+(?:default\s+)?class\s+(\w+)/m)         ||
    raw.match(/^export\s+(?:default\s+)?function\s+(\w+)/m)      ||
    raw.match(/^export\s+const\s+(\w+)/m)                        ||
    raw.match(/\bclass\s+(\w+)/m)                                 ||
    raw.match(/\bfunction\s+(\w+)/m)
  return m ? m[1] : null
}

function detectCodeBlocks(text) {
  const blocks = []
  const fenced = /```(?:[a-zA-Z0-9_+-]*)?(?: |\n)([\s\S]*?)```/gi
  let match
  while ((match = fenced.exec(text)) !== null) {
    const code = match[1].trim()
    if (code.length > 30) blocks.push(code)
  }
  if (blocks.length === 0) {
    const codeSignals = [
      /^(import|export|const|let|var|function|class|async)\s/m,
      /=>\s*\{/, /\bthis\.\w+\s*=/, /<(!DOCTYPE|html|head|body)/i
    ]
    const isSingleFunction =
      /^\s*(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(|async\s+function\s+\w+|\w+\s*=\s*\(.*\)\s*=>)/m.test(text) &&
      /[{}]/.test(text)
    if (isSingleFunction || (codeSignals.filter(p => p.test(text)).length >= 2 && text.length > 50))
      blocks.push(text)
  }
  return blocks
}

function compressAssistantMessage(content) {
  if (typeof content !== 'string') return content
  const codeBlockPattern = /```(\w*)\n?([\s\S]*?)```/g
  const parts = []; let lastIndex = 0; let match
  codeBlockPattern.lastIndex = 0
  while ((match = codeBlockPattern.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index)
    const lang       = match[1]?.trim() || 'code'
    if (textBefore.trim()) parts.push({ type: 'text', content: textBefore.trim() })
    parts.push({ type: 'label', content: `[${lang} implementation]` })
    lastIndex = match.index + match[0].length
  }
  const textAfter = content.slice(lastIndex).trim()
  if (textAfter) parts.push({ type: 'text', content: textAfter })
  if (!parts.length) return '[response provided]'
  const textParts  = parts.filter(p => p.type === 'text').map(p => p.content.slice(0, 200))
  const labelParts = parts.filter(p => p.type === 'label').map(p => p.content)
  return [textParts.join('\n').trim(), labelParts.join(', ')].filter(Boolean).join('\n') || '[response provided]'
}

function compressUserMessage(content) {
  if (typeof content !== 'string') return ''
  const hasCode = /```[\s\S]*?```/.test(content) || /export\s+class\s+\w+/.test(content)
  if (!hasCode) return content.slice(0, 400)
  return content.replace(/```[\s\S]*?```/g, '[code attached]').replace(/\s{2,}/g, ' ').trim().slice(0, 300) || '[code message]'
}

function storeSemanticEntry(sid, t, text) {
  const map        = semanticTextMaps.get(sid) ?? new Map()
  const compressed = semanticCompress(text, 15)
  if (!compressed) return
  const hash = semanticHash(compressed)
  for (const [, entry] of map) {
    if (entry.hash === hash) return
    if (jaccardSimilarity(entry.text, compressed) >= 0.72) return
  }
  map.set(t, { hash, text: compressed })
  if (map.size > MAX_TEXT_MAP) map.delete(map.keys().next().value)
  semanticTextMaps.set(sid, map)
}

function storeCodeContext(sid, rawArr, tValue, options = {}) {
  const contexts = rawCodeStore.get(sid) ?? []
  for (const raw of rawArr) {
    if (!raw || raw.length < 30) continue
    let cs = 2166136261
    for (let i = 0; i < raw.length; i++) { cs ^= raw.charCodeAt(i); cs = Math.imul(cs, 16777619) }
    const hash     = Math.abs(cs >>> 0).toString(16)
    const existing = contexts.find(c => c.hash === hash)
    if (existing) { existing.updatedAt = Date.now(); existing.msgIndex = tValue; continue }
    const symbols   = extractSymbols(raw)
    const domain    = classifyDomain(raw)
    const summary   = `${domain} code: ${symbols.slice(0,6).join(', ') || 'general'}`
    const parentCtx     = options.parentHash ? contexts.find(c => c.hash === options.parentHash) : null
    const name          = options.name ?? parentCtx?.name ?? extractCodeName(raw, options.questionOnly ?? '') ?? `file_${tValue}`
    const version       = parentCtx ? parentCtx.version + 1 : 1
    const parentVersion = parentCtx ? parentCtx.version : null
    contexts.push({
      id: `ctx_${tValue}_${hash.slice(0,6)}`,
      name,
      version,
      parentVersion,
      raw,
      symbols,
      summary,
      domain,
      hash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      msgIndex: tValue
    })
  }
  if (contexts.length > 10) contexts.splice(0, contexts.length - 10)
  rawCodeStore.set(sid, contexts)
}

function retrieveRelevantCode(questionText, sid, currentMsgIndex) {
  const contexts = rawCodeStore.get(sid) ?? []
  if (!contexts.length) return null
  let best = null, bestScore = 0
  const qLower = questionText.toLowerCase()
  for (const ctx of contexts) {
    const symbolBoost = (ctx.symbols ?? []).filter(s => qLower.includes(s)).length * 0.15
    const domainMatch = classifyDomain(questionText) === ctx.domain ? 0.30 : 0
    const msgAge      = Math.max(0, currentMsgIndex - ctx.msgIndex)
    const freshness   = Math.max(0, 1 - msgAge / 20)
    const finalScore  = symbolBoost * 0.50 + domainMatch * 0.35 + freshness * 0.15
    if (finalScore > bestScore && finalScore > 0.10) { bestScore = finalScore; best = ctx }
  }
  return best
}

function updateAnchors(sid, topicText, weight, domain = 'general') {
  if (!topicText || weight < 0.3) return
  const sessionAnchors = anchorMemory.get(sid) instanceof Map ? anchorMemory.get(sid) : new Map()
  const store    = sessionAnchors.get(domain) ?? []
  const existing = store.find(a => a.concept === topicText)
  if (existing) { existing.weight = Math.min(1, existing.weight * 0.9 + weight * 0.1) }
  else { store.push({ concept: topicText, weight, t: Date.now() }) }
  store.sort((a, b) => b.weight - a.weight)
  if (store.length > 5) store.pop()
  sessionAnchors.set(domain, store)
  anchorMemory.set(sid, sessionAnchors)
}

function buildCapsuleContext(sid, domain = 'general') {
  const sessionCaps = capsuleMemory.get(sid)
  if (!sessionCaps) return []
  const domainCaps  = sessionCaps.get(domain) ?? []
  const generalCaps = domain !== 'general' ? (sessionCaps.get('general') ?? []) : []
  const caps = [...domainCaps.slice(-2), ...generalCaps.slice(-1)]
  if (!caps.length) return []
  const lines = caps.map(c => {
    const parts = [`topic:${c.topic}`]
    if (c.covered?.length) parts.push(`covered:${c.covered.slice(0,3).join(',')}`)
    if (c.pending?.length) parts.push(`pending:${c.pending.slice(0,2).join(',')}`)
    return parts.join(' | ')
  })
  return [{ role: 'user', content: `[memory]\n${lines.join('\n')}` }]
}

function buildAnchorContext(sid, domain = 'general') {
  const sessionAnchors = anchorMemory.get(sid)
  if (!sessionAnchors) return []
  const anchors = sessionAnchors instanceof Map
    ? [...(sessionAnchors.get(domain) ?? []), ...(domain !== 'general' ? (sessionAnchors.get('general') ?? []) : [])]
    : sessionAnchors
  if (!anchors.length) return []
  const top = anchors.slice(0, 3).map(a => `${a.concept}(${Math.round(a.weight*100)}%)`).join(', ')
  return [{ role: 'user', content: `[persistent topics: ${top}]` }]
}

function buildHistoryLayer(history, continuity, sid, needsRawCode = false, currentDomain = 'general', maxHistory = 4) {
  const filtered = filterStyleInstructions(history)
  const clean    = filtered.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.length > 0)
  const limit    = Math.min(maxHistory, 4)
  if (clean.length <= limit) return clean.map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : compressUserMessage(h.content) }))
  if (continuity >= 0.70) {
    return clean.slice(-limit).map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : compressUserMessage(h.content) }))
  }
  if (continuity >= 0.40) {
    const msgs = clean.slice(-limit).map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : compressUserMessage(h.content) }))
    return [...msgs, ...buildCapsuleContext(sid, currentDomain)]
  }
  if (continuity >= 0.20) return [...buildCapsuleContext(sid, currentDomain), ...buildAnchorContext(sid, currentDomain)]
  return clean.slice(-limit).map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : compressUserMessage(h.content) }))
}

function resolveCodeStrategy(fieldSignals) {
  const fs = String(fieldSignals || '')
  return {
    needsRaw:     fs.includes('@input.raw_required') || fs.includes('#code_full'),
    needsSummary: fs.includes('@input.summary_ok')   || fs.includes('#code_summary'),
    wantsReturn:  fs.includes('@output.full_return'),
    wantsReview:  fs.includes('@output.focused_review'),
    wantsFull:    fs.includes('#full_file'),
  }
}

function chooseMaxTokens(outputShape, wantsReturn, hasCode, remaining) {
  if (wantsReturn) return Math.min(64000, remaining)
  const base      = { brief: 1200, balanced: 2800, detailed: 5000, full: 8000 }[outputShape] ?? 2800
  const codeBonus = hasCode ? 800 : 0
  return Math.min(base + codeBonus, remaining, 8000)
}

function checkPayload(systemHint, messages, wantsReturn = false) {
  const size  = JSON.stringify({ system: systemHint, messages }).length
  const limit = wantsReturn ? 200000 : 120000
  if (size > limit) throw new Error('prompt_too_large')
  return size
}

function buildClaudeBody(model, maxTokens, systemHint, messages) {
  const body = { model, max_tokens: maxTokens, messages }
  if (systemHint && String(systemHint).trim()) body.system = String(systemHint).trim()
  return body
}

async function fetchClaude(body, timeoutMs = 120000) {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body), signal: controller.signal
    })
  } finally { clearTimeout(timer) }
}

function isTruncated(data) { return data?.stop_reason === 'max_tokens' }

async function fetchWebResults(query, maxResults = 5) {
  if (!process.env.SERPER_API_KEY) return null
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_API_KEY },
      body:    JSON.stringify({ q: query, num: maxResults, gl: 'us', hl: 'ar' })
    })
    if (!res.ok) return null
    const data  = await res.json()
    const items = data.organic ?? []
    if (!items.length) return null
    return items
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet ?? ''}\n${r.link}`)
      .join('\n\n')
  } catch { return null }
}

function removeOverlap(existing, continuation) {
  const checkLen = Math.min(120, continuation.length)
  const tail     = existing.slice(-checkLen * 2)
  const head     = continuation.slice(0, checkLen)
  for (let len = checkLen; len >= 20; len--) {
    const fragment = head.slice(0, len)
    if (tail.includes(fragment)) return continuation.slice(continuation.indexOf(fragment) + fragment.length)
  }
  return continuation
}

async function continuationCall(currentText, partialReply, systemHint, model = 'claude-haiku-4-5-20251001') {
  const hasOpenCode    = (partialReply.match(/```/g) ?? []).length % 2 !== 0
  const continuePrompt = hasOpenCode
    ? 'continue exactly from where you stopped - complete the open code block, do not repeat what was already written'
    : 'continue exactly from where you stopped - do not repeat what was already written'
  const body = buildClaudeBody(model, 4096, systemHint, [
    { role: 'user', content: currentText },
    { role: 'assistant', content: partialReply },
    { role: 'user', content: continuePrompt }
  ])
  const response = await fetchClaude(body, 30000)
  return await response.json()
}

function setStyle(sid, style, ttl) { styleStore.set(sid, { style, ttl }) }
function getAndTickStyle(sid) {
  const entry = styleStore.get(sid)
  if (!entry) return null
  if (entry.ttl <= 0) { styleStore.delete(sid); return null }
  entry.ttl--
  return entry.style
}

function getSemanticState(sid) {
  if (!_semanticState.has(sid)) _semanticState.set(sid, { dominantDomain: 'general', driftCount: 0 })
  return _semanticState.get(sid)
}

function updateSemanticState(sid, detectedDomain) {
  const state = getSemanticState(sid)
  if (detectedDomain !== 'general') {
    if (state.dominantDomain === 'general') {
      state.dominantDomain = detectedDomain
      state.driftCount = 0
    } else if (detectedDomain !== state.dominantDomain) {
      state.driftCount++
      if (state.driftCount >= 3) { state.dominantDomain = detectedDomain; state.driftCount = 0 }
    } else {
      state.driftCount = 0
    }
  }
  return state
}

router.get('/process-text', (_req, res) => {
  res.json({ ok: true, status: 'online', engine: 'signal-engine', version: '14.9' })
})

router.post('/process-text', async (req, res) => {
  const {
    text = '', sessionId, history = [], image = null, imageMimeType = 'image/jpeg',
    recoveredCode = null, sessionSummary = null,
  } = req.body

  const hasText  = typeof text  === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) return res.status(400).json({ error: 'missing_input' })
  if (!sessionId)            return res.status(400).json({ error: 'missing_session_id' })
  if (processingLock.has(sessionId)) return res.status(429).json({ error: 'request_in_progress', retry: true })
  processingLock.add(sessionId)

  const sid = sessionId

  try {
    const rawText     = hasText && text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) + '\n\n[truncated]' : text
    const cleanedText = hasText ? cleanInput(rawText) : rawText

    if (hasText) {
      const styleDetected = detectStyleInstruction(cleanedText)
      if (styleDetected) setStyle(sid, styleDetected.style, styleDetected.ttl)
    }
    const activeStyle = getAndTickStyle(sid)
    const wordCount   = cleanedText.trim().split(/\s+/).length
    const codeBlocks  = detectCodeBlocks(text || cleanedText)

    const tValue     = (history?.length ?? 0) + 1
    const continuity = Math.min(1, (history?.length ?? 0) / 10)

    storeSemanticEntry(sid, tValue, cleanedText.replace(/```[\s\S]*?```/g,'').replace(/\s{2,}/g,' ').trim())

    const questionOnly = cleanedText
      .replace(/```[\s\S]*?```/g, '')
      .split('\n')
      .filter(line => {
        const l = line.trim()
        if (!l) return false
        if (/^\s*(import|export|const|let|var|function|class|async|return|if|for|while|try|catch)/i.test(l)) return false
        if (/[{};]/.test(l) && l.length > 30) return false
        return true
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000) || cleanedText.slice(0, 400)

    const userIsArabic = (() => {
      if (sessionLanguageStore.has(sid)) return sessionLanguageStore.get(sid)
      if (!questionOnly) return false
      const detected = /[\u0600-\u06FF]/.test(questionOnly)
      sessionLanguageStore.set(sid, detected)
      return detected
    })()

    if (isCELFInternalQuery(questionOnly)) {
      processingLock.delete(sid)
      console.log(`[${sid.slice(-8)}] 🔒 celf_internal_query intercepted`)
      return res.json({ reply: CELF_SAFE_REPLY, newSummary: null })
    }
    if (isCELFDefinitionQuery(questionOnly)) {
      processingLock.delete(sid)
      console.log(`[${sid.slice(-8)}] ℹ️ celf_definition_query intercepted`)
      return res.json({ reply: CELF_DEFINITION, newSummary: null })
    }

    const { anchors } = resolveConceptAnchors(questionOnly)

    const _detectedDomain = classifyDomain(questionOnly) !== 'general'
      ? classifyDomain(questionOnly)
      : classifyDomain(cleanedText)
    let activeDomain = _detectedDomain !== 'general'
      ? _detectedDomain
      : (getSemanticState(sid).dominantDomain ?? 'general')

    const HARD_BLOCK_DOMAINS = new Set(['science','math','humanities'])

    const codeRelated = /اصلح|أصلح|عدل|تعديل|حلل|اشرح|وضح|analyze|explain|fix|edit|refactor|review|debug|ثغرة|خطأ|مشكلة|improve|update|check|اختبر/i.test(questionOnly)
    const explainCodeRelated =
      /اشرح|شرح|وضح|explain/i.test(questionOnly) &&
      /كود|الكود|code|file|ملف|function|class|html|css|js|javascript/i.test(questionOnly)

    let hasStoredCode       = (rawCodeStore.get(sid) ?? []).length > 0
    const codeSessionActive = codeSessionStore.get(sid)?.active === true
    const hasCodeAnchor     = anchors.some(a => ['@repair_intent','@build_intent','@analysis_intent'].includes(a))
    const refRelated        = hasStoredCode && continuity > 0.20 && /هذا|هذه|ذلك|هنا|السابق|الكود|الملف|يعني|معنى|اشرح|وضح|this|that|previous|above/i.test(questionOnly)
    const generalAllowsCode = activeDomain === 'general' && (hasCodeAnchor || codeSessionActive || codeRelated || explainCodeRelated || refRelated || codeBlocks.length > 0)
    const shouldBlockCode   = HARD_BLOCK_DOMAINS.has(activeDomain) || (activeDomain === 'general' && !generalAllowsCode)

    if (codeBlocks.length > 0) {
      storeCodeContext(sid, codeBlocks, tValue, { questionOnly })
      const _storedCtx = (rawCodeStore.get(sid) ?? []).at(-1)
      if (_storedCtx) try { registerFile(sid, { name: _storedCtx.name, version: _storedCtx.version, summary: _storedCtx.summary, domain: _storedCtx.domain, symbols: _storedCtx.symbols }) } catch {}
      codeSessionStore.set(sid, { active: true, ttl: 6 })
    } else {
      const cs = codeSessionStore.get(sid)
      if (cs?.active) { cs.ttl--; if (cs.ttl <= 0) cs.active = false }
    }

    if (!rawCodeStore.has(sid) && recoveredCode && typeof recoveredCode === 'string' && recoveredCode.length > 30 && !shouldBlockCode) {
      storeCodeContext(sid, [recoveredCode], tValue)
      codeSessionStore.set(sid, { active: true, ttl: 6 })
    }

    const _isVeryLongText = cleanedText.length > 4000 && codeBlocks.length === 0 && !shouldBlockCode
    const _isLongText     = cleanedText.length > 600  && codeBlocks.length === 0

    if (_isVeryLongText) {
      storeCodeContext(sid, [cleanedText], tValue, {
        questionOnly,
        name: questionOnly.slice(0, 30).replace(/\s+/g, '_') || `artifact_${tValue}`,
      })
    }

    hasStoredCode = (rawCodeStore.get(sid) ?? []).length > 0
    const hasCode        = codeBlocks.length > 0 || (hasStoredCode && !shouldBlockCode)
    const effectiveMatch = hasCode && !shouldBlockCode ? retrieveRelevantCode(cleanedText, sid, tValue) : null

    const shouldAttachStoredCode =
      hasStoredCode && !shouldBlockCode &&
      (codeBlocks.length > 0 || codeRelated || explainCodeRelated || refRelated ||
       hasCodeAnchor || codeSessionActive || (continuity > 0.20 && hasStoredCode))

    const _lastCtx    = (rawCodeStore.get(sid) ?? []).at(-1)
    const codeSummary = _lastCtx
      ? `[code_summary] ${_lastCtx.name} v${_lastCtx.version} — ${_lastCtx.summary} — ${Math.round(_lastCtx.raw.length / 1024 * 10) / 10}KB`
      : null
    const _codeBase   = effectiveMatch?.raw ?? _lastCtx?.raw ?? null
    const _codeHash   = _lastCtx?.hash || null
    const _codeKey    = _codeHash ? `${sid}:${_codeHash}` : null
    const isFirstPass = !!_codeKey && !codeAnalysisStore.has(_codeKey)

    const _historyChars   = JSON.stringify(history ?? []).length
    const _availableChars = Math.max(20000, 100000 - _historyChars)
    const firstPassLimit  = Math.min(80000, Math.floor(_availableChars * 0.8))

    const hasCodeContext = Boolean(_codeBase || codeSummary)

    const { fieldSignals, llmSignals, systemHint: _systemHint, allowCodeSuggestion, outputShape, questionType } =
      USE_SSE
        ? buildSignalEngine({
            sid,
            celfResult: { field: { continuity, noveltyPressure: 0, semanticCoherence: 0 } },
            questionOnly,
            codeBlocks,
            continuity,
            anchors,
            storedRaw: shouldAttachStoredCode ? codeSummary : null,
            hasCodeContext,
            userIsArabic,
            semanticState: getSemanticState(sid),
            activeStyle,
          })
        : {
            fieldSignals:        null,
            systemHint:          userIsArabic ? 'أجب باللغة العربية.' : null,
            allowCodeSuggestion: false,
            outputShape:         'balanced',
            questionType:        'general',
          }

    const needsWebSearch = fieldSignals?.includes('@tool.web_required') ?? false
    const strategy       = resolveCodeStrategy(fieldSignals)
    const isBrief        = outputShape === 'brief'

    let storedRaw = null
    if (!shouldBlockCode) {
      if (isFirstPass && _codeBase)              storedRaw = _codeBase
      else if (strategy.wantsReturn)             storedRaw = _lastCtx?.raw ?? null
      else if (shouldAttachStoredCode)           storedRaw = codeSummary
      if (!storedRaw && recoveredCode && typeof recoveredCode === 'string' && recoveredCode.length > 30) {
        storedRaw = (isFirstPass || strategy.wantsReturn)
          ? recoveredCode.slice(0, firstPassLimit)
          : `[code_summary] recovered code — ${Math.round(recoveredCode.length / 1024 * 10) / 10}KB`
      }
    }
    const finalHasCode = codeBlocks.length > 0 || !!storedRaw
    updateSemanticState(sid, activeDomain)

    const _memory = getOrCreateMemory(sid)

    // استرجع الكبسولة من Client إذا أرسلها (cross-session persistence)
    if (sessionSummary && !_memory.field.capsules.has(`session_${sid}`)) {
      try {
        const { remember: _remember } = await import('../utils/spiral-memory.js')
        await _remember(_memory, {
          id:          `session_${sid}`,
          type:        'session_summary',
          title:       sessionSummary.lastTopic || sessionSummary.goal || sid,
          summary:     sessionSummary.goal ?? '',
          sessionData: sessionSummary,
          entities:    [],
          signals:     [],
        }, { theta: 0, isActive: true, type: 'session_summary' })
        console.log(`[${sid.slice(-8)}]   capsule:restored from client goal:"${(sessionSummary.goal ?? '').slice(0, 40)}"`)
      } catch {}
    }

    let _recalled = []
    try {
      const _recallResult = await recall(_memory, {
        questionType,
        domain: activeDomain,
        title:  questionOnly.slice(0, 60),
        type:   'session_summary',
      }, { limit: 2 })
      _recalled = _recallResult.results ?? []
    } catch {}
    const _sessionCapsule = _memory.field.capsules.get(`session_${sid}`) ?? null
    const { capsuleHint, capsuleContent } = buildSessionContext(_sessionCapsule, history, rawCodeStore.get(sid) ?? [], _recalled)

    // إذا capsuleContent موجود و domain انجرف لـ sports → صحّح فوراً
    if (capsuleContent && activeDomain === 'sports') {
      activeDomain = 'creative'
      updateSemanticState(sid, 'creative')
    }

    // إذا capsuleContent موجود → لا حاجة لـ web search
    const _needsWebSearch = needsWebSearch && !capsuleContent

    const styleMap  = { concise:'Be concise.', detailed:'Be detailed.', arabic:'Respond in Arabic.', english:'Reply in English.', german:'Antworte auf Deutsch.' }
    const styleHint = activeStyle && styleMap[activeStyle] ? styleMap[activeStyle] : null

    const outputShapeHint = isBrief
      ? '[Output Shape]\nBe brief. Max 3 points. No preamble.'
      : questionType === 'code_explain'
      ? (userIsArabic
        ? '[Output Shape]\nاشرح الكود بشكل طبيعي وواضح. لا تستخدم شكل المراجعة المنظمة. لا مقدمة.'
        : '[Output Shape]\nExplain the code naturally and clearly. No structured review format. No preamble.')
      : isFirstPass
      ? (userIsArabic
        ? '[Output Shape]\nأجب بهذا الشكل فقط:\n**ما يفعله:** جملة واحدة.\n**نقاط القوة:** نقطتان كحد أقصى.\n**نقاط الضعف:** نقطتان كحد أقصى.\n**حرج:** فقط إن وجد.\nبدون كود. بدون شرح. بدون مقدمة.'
        : '[Output Shape]\nRespond in this exact format only:\n**What it does:** 1 sentence.\n**Strengths:** max 2 bullet points.\n**Weaknesses:** max 2 bullet points.\n**Critical:** only if exists.\nNo code. No explanations. No preamble.')
      : strategy.wantsReview
      ? (userIsArabic
        ? '[Output Shape]\nأجب بهذا الشكل فقط:\n**ما يفعله:** جملة واحدة.\n**نقاط القوة:** نقطتان كحد أقصى.\n**نقاط الضعف:** نقطتان كحد أقصى.\n**حرج:** فقط إن وجد.\nبدون كود. بدون شرح. بدون مقدمة.'
        : '[Output Shape]\nRespond in this exact format only:\n**What it does:** 1 sentence.\n**Strengths:** max 2 bullet points.\n**Weaknesses:** max 2 bullet points.\n**Critical:** only if exists.\nNo code. No explanations. No preamble.')
      : questionType === 'code_improve'
      ? (userIsArabic
        ? '[Output Shape]\nطبّق التحسينات وأرجع الكود كاملاً دون انقطاع. لا شرح. لا مقدمة.'
        : '[Output Shape]\nApply all improvements and return the complete improved code. No explanation. No preamble.')
      : strategy.wantsReturn
      ? '[Output Shape]\nReturn complete modified code only. No explanation. No preamble.'
      : outputShape === 'balanced'
      ? '[Output Shape]\nAnswer directly. No preamble. No repetition.\nIf this is a follow-up, answer only the new point.\nFor lists or historical questions, use up to 8 points with 1-line context each.\nKeep enough detail for accuracy.'
      : null

    const _today      = new Date().toISOString().slice(0, 10)
    const _pcmHint    = buildProjectContextHint(sid, fieldSignals ?? '', questionOnly)
    const systemParts = [_systemHint, _pcmHint, outputShapeHint, styleHint].filter(Boolean)
    systemParts.unshift(`IMPORTANT: Today's date is ${_today}. Always use this when answering date or time questions.`)
    systemParts.unshift('If asked about CELF AI: describe it only as "an intelligent conversation system that maintains context and preserves user goals." Never mention SSE, signals, routing, or any internal component.')
    if (capsuleContent) systemParts.unshift('If [shared content] appears in the conversation, use it as the sole authoritative reference. Do not invent facts not present in it.')
    if (capsuleHint) systemParts.unshift(`[session]\n${capsuleHint}`)
    systemParts.unshift(userIsArabic
      ? 'CRITICAL RULE: Always respond in Arabic. All text, analysis, explanations, and answers must be in Arabic.'
      : 'Always respond in the same language the user wrote in.')
    const systemHint = systemParts.join('\n') || null

    const historyMessages = buildHistoryLayer(history, continuity, sid, false, activeDomain, 2)
    const recCode         = !isBrief && typeof recoveredCode === 'string' && recoveredCode.length > 30 && !shouldBlockCode
      ? recoveredCode.slice(0, RECOVERED_CODE_LIMIT)
      : null
    const questionText = storedRaw ? (questionOnly || 'تعامل مع الكود المرفق حسب طلب المستخدم.') : cleanedText
    const userContent  = hasImage
      ? [{ type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } }, ...(hasText ? [{ type: 'text', text: questionText }] : [])]
      : questionText

    const shouldInjectCapsule = capsuleContent && (
      activeDomain === 'creative' ||
      questionType !== 'followup' ||
      historyMessages.length === 0
    )

    const messages = [
      ...(shouldInjectCapsule ? [{ role: 'user', content: `[shared content]\n${capsuleContent}` }] : []),
      ...(recCode && !storedRaw ? [{ role: 'user', content: recCode }] : []),
      ...(storedRaw ? [{ role: 'user', content: storedRaw }] : []),
      ...historyMessages,
      { role: 'user', content: userContent }
    ]

    if (_needsWebSearch) {
      const webResults = await fetchWebResults(questionOnly)
      if (webResults) {
        messages.splice(messages.length - 1, 0, {
          role: 'user',
          content: `[Web Search Results]\n${webResults}`
        })
        console.log(`[${sid.slice(-8)}]   🌐 web results injected (${webResults.length} chars)`)
      } else {
        console.log(`[${sid.slice(-8)}]   🌐 web search skipped (no SERPER_API_KEY or no results)`)
      }
    }

    const inputEstimate = Math.ceil((systemHint?.length ?? 0) / 4 + JSON.stringify(messages).length / 4)
    const remaining     = Math.max(1000, 180000 - inputEstimate)
    const maxTokens     = chooseMaxTokens(outputShape, strategy.wantsReturn, finalHasCode, remaining)
    const model = strategy.wantsReturn
      ? 'claude-sonnet-4-6'
      : 'claude-haiku-4-5-20251001'

    let payloadSize = 0
    try { payloadSize = checkPayload(systemHint, messages, strategy.wantsReturn) } catch (e) { return res.status(413).json({ error: 'prompt_too_large' }) }

    const _sl          = strategy.needsRaw ? 'raw' : strategy.needsSummary ? 'sum' : 'none'
    const _hintPreview = _systemHint?.split('\n').filter(l => l.startsWith('[')).join(' | ').slice(0, 120) ?? '-'
    console.log(`[${sid.slice(-8)}] → shape:${outputShape} st:${_sl} max:${maxTokens} dom:${activeDomain} type:${questionType ?? '-'}${_needsWebSearch ? ' 🌐web' : ''}${!USE_SSE ? ' ⚡NO-SSE' : ''}`)
    console.log(`[${sid.slice(-8)}]   field:${fieldSignals ?? '-'}`)
    console.log(`[${sid.slice(-8)}]   llm:${llmSignals ?? '-'}`)
    console.log(`[${sid.slice(-8)}]   hint:${_hintPreview}`)
    if (_lastCtx) console.log(`[${sid.slice(-8)}]   stored:${_lastCtx.name} v${_lastCtx.version}`)

    let claudeData, reply = null, inputTokensTotal = 0, outputTokensTotal = 0

    try {
      const claudeBody     = buildClaudeBody(model, maxTokens, systemHint, messages)
      const claudeResponse = await fetchClaude(claudeBody)
      claudeData           = await claudeResponse.json()
      if (!claudeResponse.ok) {
        if (strategy.wantsReturn) {
          reply = '[CELF_LIMIT]\nFile too large or output budget exceeded.\nSplit the file or reduce the change scope.'
          inputTokensTotal  = claudeData?.usage?.input_tokens  ?? 0
          outputTokensTotal = claudeData?.usage?.output_tokens ?? 0
        } else {
          throw new Error(`Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`)
        }
      } else {
        reply             = claudeData?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || null
        if (isFirstPass && reply) codeAnalysisStore.set(_codeKey, true)
        inputTokensTotal  = claudeData?.usage?.input_tokens  ?? 0
        outputTokensTotal = claudeData?.usage?.output_tokens ?? 0

        if (strategy.wantsReturn && isTruncated(claudeData)) {
          reply = '[CELF_LIMIT]\nFull return requires more output tokens than available.\nIncrease output budget or split the file intentionally.'
        } else {
          let continuationCount = 0
          while (reply && isTruncated(claudeData) && continuationCount < 2) {
            continuationCount++
            if (outputTokensTotal >= 4096) break
            const contData = await continuationCall(questionText, reply, systemHint, model)
            if (!contData?.content?.[0]?.text) break
            reply             += removeOverlap(reply, contData.content[0].text)
            inputTokensTotal  += contData?.usage?.input_tokens  ?? 0
            outputTokensTotal += contData?.usage?.output_tokens ?? 0
            claudeData         = contData
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return res.status(504).json({ error: 'claude_timeout' })
      throw err
    }

    const currentDomain = classifyDomain(questionOnly || cleanedText)
    updateAnchors(sid, cleanedText.slice(0,80), 0.5, currentDomain)

    const shouldSaveNewVersion =
      (strategy.wantsReturn || fieldSignals?.includes('#full_file')) &&
      reply && !reply.startsWith('[CELF_LIMIT]')
    if (shouldSaveNewVersion) {
      const replyBlocks = detectCodeBlocks(reply)
      if (replyBlocks.length > 0 && replyBlocks[0].length > 200) {
        storeCodeContext(sid, replyBlocks, tValue + 0.9, {
          name:       _lastCtx?.name,
          parentHash: _lastCtx?.hash,
        })
        codeSessionStore.set(sid, { active: true, ttl: 6 })
        const _newCtx = (rawCodeStore.get(sid) ?? []).at(-1)
        if (_newCtx) {
          try { registerFile(sid, { name: _newCtx.name, version: _newCtx.version, summary: _newCtx.summary, domain: _newCtx.domain, symbols: _newCtx.symbols }) } catch {}
          console.log(`[${sid.slice(-8)}]   saved:${_newCtx.name} v${_newCtx.version} (parent:v${_newCtx.parentVersion ?? '-'})`)
        }
      }
    }

    try {
      await updateSessionCapsule(_memory, sid, {
        goal:        (questionOnly || cleanedText).slice(0, 100),
        lastTopic:   activeDomain,
        lastVersion: _lastCtx?.name ?? null,
        content:     _isLongText    ? cleanedText.slice(0, 2000) : undefined,
        decisions:   _isLongText || questionType === 'creative_write'
          ? []
          : reply && !strategy.wantsReturn
            ? [`${questionOnly.slice(0, 80)}: ${reply.slice(0, 300)}`]
            : [],
        entities: anchors.filter(a => !a.startsWith('@') && !a.startsWith('#')).slice(0, 5),
      }, { domain: activeDomain, questionType })
      const _sc = _memory.field.capsules.get(`session_${sid}`)
      if (_sc) {
        const _sd = _sc.sessionData ?? {}
        console.log(`[${sid.slice(-8)}]   capsule:θ${_sc.theta}° ring${_sc.ring} goal:"${(_sd.goal ?? '').slice(0, 40)}" content:${_sd.content ? _sd.content.length + 'ch' : 'none'} decisions:${(_sd.decisions ?? []).length}`)
      }
    } catch {}

    const costUSD = parseFloat(((inputTokensTotal/1_000_000)*1.0 + (outputTokensTotal/1_000_000)*5.0).toFixed(6))
    console.log(`[${sid.slice(-8)}] ← in:${inputTokensTotal} out:${outputTokensTotal} $${costUSD}`)
    metricsStore.set(sid, { sessionId: sid, inputTokens: inputTokensTotal, outputTokens: outputTokensTotal, costUSD, maxTokens, payloadSize, updatedAt: new Date().toISOString() })

    const _newSummary = _memory.field.capsules.get(`session_${sid}`)?.sessionData ?? null

    return res.json({
      reply,
      newSummary:     _newSummary,
      nextSuggestion: null,
      celfVault:      [],
      observer:       null,
      metrics: { inputTokens: inputTokensTotal, outputTokens: outputTokensTotal, costUSD, maxTokens, model, payloadSize }
    })

  } catch (err) {
    console.error('[process-text] error:', err.message)
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  } finally {
    processingLock.delete(sid)
  }
})

router.get('/metrics/:id', (req, res) => {
  const m = metricsStore.get(req.params.id)
  if (!m) return res.status(404).json({ error: 'metrics_not_found' })
  return res.json(m)
})

router.delete('/session/:id', (req, res) => {
  const id = req.params.id
  metricsStore.delete(id); semanticTextMaps.delete(id); styleStore.delete(id)
  processingLock.delete(id); _semanticState.delete(id); rawCodeStore.delete(id)
  codeSessionStore.delete(id); sessionMemoryStore.delete(id); capsuleMemory.delete(id)
  anchorMemory.delete(id)
  clearProjectMap(id)
  sessionLanguageStore.delete(id)
  for (const [k] of codeAnalysisStore) { if (k.startsWith(`${id}:`)) codeAnalysisStore.delete(k) }
  return res.json({ ok: true })
})

export default router
