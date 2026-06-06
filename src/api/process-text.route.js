import express from 'express'
import { resolveConceptAnchors } from '../utils/concept-anchor.js'
import { cleanInput, filterStyleInstructions, detectStyleInstruction } from '../utils/context-builder.js'
import { buildSignalEngine, classifyDomain as _classifyDomain } from '../utils/semantic-signal-engine.js'

const router = express.Router()

// ═══════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════

const MAX_INPUT_CHARS      = 40000
const MAX_TEXT_MAP         = 300
const SUMMARY_INTERVAL     = 8
const RECOVERED_CODE_LIMIT = 14000

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','fuer',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// ═══════════════════════════════════════════════════════
//  STATE STORES
// ═══════════════════════════════════════════════════════

const processingLock      = new Set()
const semanticTextMaps    = new Map()
const styleStore          = new Map()
const rawCodeStore        = new Map()
const codeSessionStore    = new Map()
const sessionSummaryStore = new Map()
const resumeBootstrapped  = new Set()
const capsuleMemory       = new Map()
const anchorMemory        = new Map()
const metricsStore        = new Map()
const _semanticState      = new Map()

// ═══════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════

const classifyDomain = _classifyDomain

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
    if (codeSignals.filter(p => p.test(text)).length >= 2 && text.length > 50) blocks.push(text)
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

// ═══════════════════════════════════════════════════════
//  CODE MANAGER
// ═══════════════════════════════════════════════════════

function storeCodeContext(sid, rawArr, tValue) {
  const contexts = rawCodeStore.get(sid) ?? []
  for (const raw of rawArr) {
    if (!raw || raw.length < 30) continue
    let cs = 2166136261
    for (let i = 0; i < raw.length; i++) { cs ^= raw.charCodeAt(i); cs = Math.imul(cs, 16777619) }
    const hash     = Math.abs(cs >>> 0).toString(16)
    const existing = contexts.find(c => c.hash === hash)
    if (existing) { existing.updatedAt = Date.now(); existing.msgIndex = tValue; continue }
    const symbols = extractSymbols(raw)
    const summary = `${classifyDomain(raw)} code: ${symbols.slice(0,6).join(', ') || 'general'}`
    contexts.push({ id: `ctx_${tValue}_${hash.slice(0,6)}`, raw, symbols, summary, domain: classifyDomain(raw), hash, createdAt: Date.now(), updatedAt: Date.now(), msgIndex: tValue })
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

// ═══════════════════════════════════════════════════════
//  MEMORY
// ═══════════════════════════════════════════════════════

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

async function generateSessionSummary(sid, history) {
  if (!history || history.length < 4) return null
  const recent    = history.slice(-16)
  const domain    = classifyDomain(recent.filter(h => h.role === 'user').map(h => h.content).join(' '))
  const symbols   = (recent.map(h => h.content).join(' ').match(/[a-zA-Z][a-zA-Z0-9]{2,}/g) ?? []).slice(0, 6).join(', ')
  const mainTopic = recent.filter(h => h.role === 'user')[0]?.content?.replace(/```[\s\S]*?```/g,'').trim().slice(0,80) ?? 'general'
  return { text: `${domain}: ${symbols || 'general'} - ${mainTopic}`.slice(0,200), generatedAt: Date.now() }
}

// ═══════════════════════════════════════════════════════
//  CONTEXT BUILDER
// ═══════════════════════════════════════════════════════

function buildHistoryLayer(history, continuity, sid, needsRawCode = false, currentDomain = 'general') {
  const filtered = filterStyleInstructions(history)
  const clean    = filtered.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.length > 0)
  if (clean.length <= 4) return clean.map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : h.content }))
  if (continuity >= 0.70) {
    return clean.slice(-4).map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : needsRawCode ? h.content : compressUserMessage(h.content) }))
  }
  if (continuity >= 0.40) {
    const msgs = clean.slice(-4).map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : needsRawCode ? h.content : compressUserMessage(h.content) }))
    return [...msgs, ...buildCapsuleContext(sid, currentDomain)]
  }
  if (continuity >= 0.20) return [...buildCapsuleContext(sid, currentDomain), ...buildAnchorContext(sid, currentDomain)]
  return clean.slice(-4).map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : compressUserMessage(h.content) }))
}

// ═══════════════════════════════════════════════════════
//  TOKEN BUDGET
// ═══════════════════════════════════════════════════════

function chooseMaxTokens(anchors, inputWords, hasCode, remaining) {
  const has = a => anchors.includes(a)
  const cap = Math.min(8000, Math.max(1000, Math.floor(remaining * 0.45)))
  if (has('@repair_intent') || has('@build_intent')) return Math.min(cap, 6000)
  if (has('@analysis_intent'))                        return cap
  if (has('@verify_intent'))                          return Math.min(cap, 4000)
  if (hasCode)                                        return Math.min(cap, 3000)
  if (inputWords <= 5)                                return 1000
  if (inputWords <= 15)                               return 2000
  return Math.min(cap, 2500)
}

// ═══════════════════════════════════════════════════════
//  LLM CALLER
// ═══════════════════════════════════════════════════════

function checkPayload(systemHint, messages) {
  const size = JSON.stringify({ system: systemHint, messages }).length
  if (size > 120000) throw new Error('prompt_too_large')
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

// ═══════════════════════════════════════════════════════
//  STYLE
// ═══════════════════════════════════════════════════════

function setStyle(sid, style, ttl) { styleStore.set(sid, { style, ttl }) }
function getAndTickStyle(sid) {
  const entry = styleStore.get(sid)
  if (!entry) return null
  if (entry.ttl <= 0) { styleStore.delete(sid); return null }
  entry.ttl--
  return entry.style
}

// ═══════════════════════════════════════════════════════
//  SEMANTIC STATE
// ═══════════════════════════════════════════════════════

function getSemanticState(sid) {
  if (!_semanticState.has(sid)) _semanticState.set(sid, { dominantDomain: 'general', driftCount: 0 })
  return _semanticState.get(sid)
}

function updateSemanticState(sid, detectedDomain) {
  const state = getSemanticState(sid)
  if (detectedDomain !== state.dominantDomain && detectedDomain !== 'general') {
    state.driftCount++
    if (state.driftCount >= 3) { state.dominantDomain = detectedDomain; state.driftCount = 0 }
  } else if (detectedDomain === state.dominantDomain) {
    state.driftCount = 0
  }
  return state
}

// ═══════════════════════════════════════════════════════
//  MAIN ROUTE
// ═══════════════════════════════════════════════════════

router.get('/process-text', (_req, res) => {
  res.json({ ok: true, status: 'online', engine: 'signal-engine', version: '12.0' })
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
    // -- INPUT
    const rawText     = hasText && text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) + '\n\n[truncated]' : text
    const cleanedText = hasText ? cleanInput(rawText) : rawText

    if (hasText) {
      const styleDetected = detectStyleInstruction(cleanedText)
      if (styleDetected) setStyle(sid, styleDetected.style, styleDetected.ttl)
    }
    const activeStyle  = getAndTickStyle(sid)
    const userIsArabic = /[\u0600-\u06FF]/.test(cleanedText || '')
    const wordCount    = cleanedText.trim().split(/\s+/).length
    const codeBlocks   = detectCodeBlocks(text || cleanedText)

    // -- CONTINUITY
    const tValue     = (history?.length ?? 0) + 1
    const continuity = Math.min(1, (history?.length ?? 0) / 10)

    storeSemanticEntry(sid, tValue, cleanedText.replace(/```[\s\S]*?```/g,'').replace(/\s{2,}/g,' ').trim())

    // -- CONCEPT ANCHOR
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
      .slice(0, 500) || cleanedText.slice(0, 200)

    const { anchors } = resolveConceptAnchors(questionOnly)

    // -- ACTIVE DOMAIN
    const _detectedDomain = classifyDomain(questionOnly)
    const activeDomain = _detectedDomain !== 'general'
      ? _detectedDomain
      : (getSemanticState(sid).dominantDomain ?? 'general')

    // -- CODE CONTEXT  ① التعديل الأول
    const HARD_BLOCK_DOMAINS = new Set(['science','math','humanities'])
    const codeRelated = /اصلح|أصلح|عدل|تعديل|حلل|analyze|fix|edit|refactor|review|debug|ثغرة|خطأ|مشكلة|improve|update|check|اختبر|وضح|explain/i.test(questionOnly)
    const hasStoredCode     = (rawCodeStore.get(sid) ?? []).length > 0
    const codeSessionActive = codeSessionStore.get(sid)?.active === true
    const hasCodeAnchor     = anchors.some(a => ['@repair_intent','@build_intent','@analysis_intent'].includes(a))
    const refRelated        = hasStoredCode && continuity > 0.20 && /هذا|هذه|ذلك|هنا|السابق|الكود|الملف|يعني|معنى|اشرح|وضح|this|that|previous|above/i.test(questionOnly)
    const generalAllowsCode = activeDomain === 'general' && (hasCodeAnchor || codeSessionActive || codeRelated || refRelated || codeBlocks.length > 0)
    const shouldBlockCode   = HARD_BLOCK_DOMAINS.has(activeDomain) || (activeDomain === 'general' && !generalAllowsCode)

    if (codeBlocks.length > 0) {
      storeCodeContext(sid, codeBlocks, tValue)
      codeSessionStore.set(sid, { active: true, ttl: 6 })
    } else {
      const cs = codeSessionStore.get(sid)
      if (cs?.active) { cs.ttl--; if (cs.ttl <= 0) cs.active = false }
    }

    if (!rawCodeStore.has(sid) && recoveredCode && typeof recoveredCode === 'string' && recoveredCode.length > 30
        && !shouldBlockCode) {  // ② التعديل الثاني (recCode)
      storeCodeContext(sid, [recoveredCode], tValue)
      codeSessionStore.set(sid, { active: true, ttl: 6 })
    }

    const hasCode       = codeBlocks.length > 0 ||
      (hasStoredCode && !shouldBlockCode)
    const effectiveMatch = hasCode && !shouldBlockCode
      ? retrieveRelevantCode(cleanedText, sid, tValue)
      : null
    const shouldAttachStoredCode =
      hasStoredCode &&
      !shouldBlockCode &&
      (codeBlocks.length > 0 || codeRelated || refRelated)
    const storedRaw = effectiveMatch?.raw ?? (shouldAttachStoredCode ? (rawCodeStore.get(sid) ?? []).at(-1)?.raw ?? null : null)

    // -- SEMANTIC SIGNAL ENGINE
    const { fieldSignals, systemHint: _systemHint, allowCodeSuggestion } =
      buildSignalEngine({
        sid,
        celfResult: { field: { continuity, noveltyPressure: 0, semanticCoherence: 0 } },
        questionOnly,
        codeBlocks,
        continuity,
        anchors,
        storedRaw,
        userIsArabic,
        semanticState: getSemanticState(sid)
      })
    updateSemanticState(sid, activeDomain)

    // -- SESSION SUMMARY
    if (!sessionSummaryStore.has(sid) && sessionSummary?.text) sessionSummaryStore.set(sid, sessionSummary)
    if (!resumeBootstrapped.has(sid) && sessionSummary?.text) resumeBootstrapped.add(sid)
    const activeSummary = sessionSummaryStore.get(sid) ?? null

    // -- SYSTEM PROMPT
    const styleMap  = { concise:'Be concise.', detailed:'Be detailed.', arabic:'Respond in Arabic.', english:'Reply in English.', german:'Antworte auf Deutsch.' }
    const styleHint = activeStyle && styleMap[activeStyle] ? styleMap[activeStyle] : null
    const systemParts = [_systemHint, styleHint].filter(Boolean)
    if (activeSummary?.text) systemParts.unshift(`[session] ${activeSummary.text}`)
    const systemHint = systemParts.join('\n') || null

    // -- MESSAGES
    const filteredHistory = filterStyleInstructions(history)
    const historyMessages = buildHistoryLayer(filteredHistory, continuity, sid, false, activeDomain)
    const recCode         = typeof recoveredCode === 'string' && recoveredCode.length > 30
      && !shouldBlockCode  // ② التعديل الثاني (recCode في messages)
      ? recoveredCode.slice(0, RECOVERED_CODE_LIMIT)
      : null
    const questionText    = storedRaw ? (questionOnly || 'تعامل مع الكود المرفق حسب طلب المستخدم.') : cleanedText
    const userContent     = hasImage
      ? [{ type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } }, ...(hasText ? [{ type: 'text', text: questionText }] : [])]
      : questionText

    const messages = [
      ...(recCode && !storedRaw ? [{ role: 'user', content: recCode }] : []),
      ...(storedRaw ? [{ role: 'user', content: storedRaw }] : []),
      ...historyMessages,
      { role: 'user', content: userContent }
    ]

    // -- LLM
    const inputEstimate = Math.ceil((systemHint?.length ?? 0) / 4 + JSON.stringify(messages).length / 4)
    const remaining     = Math.max(1000, 180000 - inputEstimate)
    const maxTokens     = chooseMaxTokens(anchors, wordCount, hasCode, remaining)
    const model         = 'claude-haiku-4-5-20251001'

    let payloadSize = 0
    try { payloadSize = checkPayload(systemHint, messages) } catch (e) { return res.status(413).json({ error: 'prompt_too_large' }) }

    console.log('=== TO LLM ===', JSON.stringify({ system: systemHint, msgCount: messages.length, maxTokens, model }, null, 2))

    let claudeData, reply = null, inputTokensTotal = 0, outputTokensTotal = 0

    try {
      const claudeBody     = buildClaudeBody(model, maxTokens, systemHint, messages)
      const claudeResponse = await fetchClaude(claudeBody)
      claudeData           = await claudeResponse.json()
      if (!claudeResponse.ok) throw new Error(`Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`)
      reply             = claudeData?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || null
      inputTokensTotal  = claudeData?.usage?.input_tokens  ?? 0
      outputTokensTotal = claudeData?.usage?.output_tokens ?? 0

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
    } catch (err) {
      if (err.name === 'AbortError') return res.status(504).json({ error: 'claude_timeout' })
      throw err
    }

    // -- POST PROCESSOR
    const currentDomain = classifyDomain(questionOnly || cleanedText)
    updateAnchors(sid, cleanedText.slice(0,80), 0.5, currentDomain)

    if (reply && fieldSignals?.includes('#full_file')) {
      const replyBlocks = detectCodeBlocks(reply)
      if (replyBlocks.length > 0 && replyBlocks[0].length > 200) {
        storeCodeContext(sid, replyBlocks, tValue + 0.9)
        codeSessionStore.set(sid, { active: true, ttl: 6 })
      }
    }

    const msgCountAfter = (history?.length ?? 0) + 1
    let newSummary = null
    if (msgCountAfter >= 4) {  // ③ التعديل الثالث
      try {
        newSummary = await generateSessionSummary(sid, [...(history ?? []), { role: 'assistant', content: reply ?? '' }])
        if (newSummary) sessionSummaryStore.set(sid, newSummary)
      } catch {}
    }

    const costUSD = parseFloat(((inputTokensTotal/1_000_000)*1.0 + (outputTokensTotal/1_000_000)*5.0).toFixed(6))
    metricsStore.set(sid, { sessionId: sid, inputTokens: inputTokensTotal, outputTokens: outputTokensTotal, costUSD, maxTokens, payloadSize, updatedAt: new Date().toISOString() })

    return res.json({
      reply,
      newSummary: newSummary ?? null,
      nextSuggestion: null,
      celfVault: [],
      observer: null,
      debug: { systemHint: systemHint ?? null, fieldSignals, anchors, continuity, allowCodeSuggestion, activeDomain, msgCount: messages.length, hasCode, storedCode: !!storedRaw, maxTokens, model },
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
  codeSessionStore.delete(id); resumeBootstrapped.delete(id); capsuleMemory.delete(id)
  anchorMemory.delete(id); sessionSummaryStore.delete(id)
  return res.json({ ok: true })
})

export default router
