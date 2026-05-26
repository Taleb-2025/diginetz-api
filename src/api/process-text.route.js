import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse } from '../utils/lightweight-parser.js'
import { build, cleanInput, filterStyleInstructions, detectStyleInstruction } from '../utils/context-builder.js'
import { observe } from '../utils/celf-observer.js'
import { indexStore } from './index-code.route.js'

const router = express.Router()

const MAX_SESSIONS = 150
const SESSION_TTL_MS = 1000 * 60 * 60 * 6
const MAX_INPUT_CHARS = 40000
const MAX_TEXT_MAP = 300
const MAX_VECTOR_CACHE = 500
const MAX_METRICS = 500
const MAX_CAPSULES = 20
const MAX_PROMPT_BYTES = 120000
const DEDUP_JACCARD_THRESHOLD = 0.72
const LOCK_TTL_MS = 150000
const CLEANUP_INTERVAL_MS = 60000
const MAX_CONTINUATIONS = 1

const sessions = new Map()
const sessionAccess = new Map()
const metricsStore = new Map()
const processingLock = new Map()
const semanticTextMaps = new Map()
const styleStore = new Map()
const capsuleMemory = new Map()
const anchorMemory = new Map()
const vectorCache = new Map()

const TECH_KEYWORDS = {
  frameworks: ['fastapi','django','flask','express','nestjs','react','vue','spring'],
  databases: ['redis','postgresql','postgres','mysql','mongodb','sqlite','elasticsearch'],
  infra: ['docker','railway','nginx','kubernetes','aws','gcp','azure','vercel'],
  concepts: [
    'caching','pooling','rate limiting','authentication','websocket',
    'async','optimization','deployment','monitoring','scaling','latency',
    'performance','connection','middleware','routing','security'
  ]
}

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

function nowMs() {
  return Date.now()
}

function touchSession(sid) {
  sessionAccess.set(sid, nowMs())
}

function cleanupStores() {
  const now = nowMs()

  for (const [sid, startedAt] of processingLock) {
    if (now - startedAt > LOCK_TTL_MS) processingLock.delete(sid)
  }

  for (const [sid, last] of sessionAccess) {
    if (now - last > SESSION_TTL_MS) {
      sessions.delete(sid)
      sessionAccess.delete(sid)
      semanticTextMaps.delete(sid)
      styleStore.delete(sid)
      capsuleMemory.delete(sid)
      anchorMemory.delete(sid)
      for (const key of vectorCache.keys()) {
        if (key.startsWith(sid + ':')) vectorCache.delete(key)
      }
    }
  }

  while (metricsStore.size > MAX_METRICS) {
    metricsStore.delete(metricsStore.keys().next().value)
  }

  for (const [sid, map] of semanticTextMaps) {
    if (!sessions.has(sid)) semanticTextMaps.delete(sid)
    else while (map.size > MAX_TEXT_MAP) map.delete(map.keys().next().value)
  }

  while (vectorCache.size > MAX_VECTOR_CACHE) {
    vectorCache.delete(vectorCache.keys().next().value)
  }
}

setInterval(cleanupStores, CLEANUP_INTERVAL_MS).unref?.()

function setStyle(sid, style, ttl) {
  styleStore.set(sid, { style, ttl })
}

function getAndTickStyle(sid) {
  const entry = styleStore.get(sid)
  if (!entry) return null
  if (entry.ttl <= 0) {
    styleStore.delete(sid)
    return null
  }
  entry.ttl--
  return entry.style
}

function semanticHash(text) {
  return cryptoHash(text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500))
}

function cryptoHash(text) {
  let h1 = 2166136261
  let h2 = 16777619
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
  }
  return `${Math.abs(h1 >>> 0).toString(36)}${Math.abs(h2 >>> 0).toString(36)}`
}

function semanticCompress(text, maxWords = 12) {
  const cleaned = String(text ?? '').replace(/```[\s\S]*?```/g, '').trim()
  const words = cleaned.split(/\s+/).filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))
  return words.slice(0, maxWords).join(' ')
}

function jaccardSimilarity(textA, textB) {
  const setA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const setB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  if (!setA.size || !setB.size) return 0
  let overlap = 0
  for (const w of setA) if (setB.has(w)) overlap++
  const denom = setA.size + setB.size - overlap
  return denom > 0 ? overlap / denom : 0
}

function detectCodeBlocks(text) {
  const blocks = []
  const fenced = /```(?:js|javascript|ts|typescript|jsx|tsx|python|py|html|css|json)?\s*\n([\s\S]*?)```/gi
  let match

  while ((match = fenced.exec(text)) !== null) {
    const code = match[1].trim()
    if (code.length > 30) blocks.push(code)
  }

  if (blocks.length === 0) {
    const codeSignals = [
      /^(import|export|const|let|var|function|class|async)\s/m,
      /=>\s*\{/,
      /\bthis\.\w+\s*=/,
      /^\s{2,}(const|let|var|return|if|for|while|try|catch)\s/m,
      /^\s*(def|class)\s+\w+/m,
      /\bfrom\s+\w+\s+import\s+/,
      /\bconsole\.log\s*\(/,
      /\bprint\s*\(/
    ]
    if (codeSignals.filter(p => p.test(text)).length >= 2 && text.length > 50 && text.length < 30000) {
      blocks.push(text)
    }
  }

  return blocks
}

function getEngine(sessionId) {
  cleanupStores()
  if (sessions.has(sessionId)) {
    const e = sessions.get(sessionId)
    sessions.delete(sessionId)
    sessions.set(sessionId, e)
    touchSession(sessionId)
    return e
  }

  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessionAccess.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? sessions.keys().next().value
    sessions.delete(oldest)
    sessionAccess.delete(oldest)
    semanticTextMaps.delete(oldest)
    styleStore.delete(oldest)
    capsuleMemory.delete(oldest)
    anchorMemory.delete(oldest)
  }

  const engine = new CELF_Engine_AI_V5({
    resolution: 120,
    ringCount: 3,
    cycle: 360,
    diffusionRate: 0.08,
    constraintRate: 0.12,
    attractorLimit: 8,
    historyLimit: 128,
    archiveLimit: 128,
    semanticMemoryLimit: 96
  })

  sessions.set(sessionId, engine)
  touchSession(sessionId)
  return engine
}

function cachedVector(sid, engine, text) {
  const key = `${sid}:${semanticHash(String(text ?? '').slice(0, 1000))}`
  const cached = vectorCache.get(key)
  if (cached) {
    vectorCache.delete(key)
    vectorCache.set(key, cached)
    return cached
  }
  const vector = engine.semanticVector(text)
  vectorCache.set(key, vector)
  while (vectorCache.size > MAX_VECTOR_CACHE) vectorCache.delete(vectorCache.keys().next().value)
  return vector
}

function mapIntent(snapshot) {
  const s = snapshot?.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question) return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error) return 'complaint'
  if (s.emotional) return 'emotional'
  return 'statement'
}

function feed(sessionId, text) {
  const signals = parse(text)
  if (!signals.valid) return { ok: false, reason: signals.reason ?? 'invalid_signals' }

  const engine = getEngine(sessionId)
  const snapshot = engine.process(text)
  const field = snapshot.field ?? {}
  const metrics = snapshot.metrics ?? {}
  const control = snapshot.control ?? {}
  const perturbation = snapshot.perturbation ?? {}
  const attractors = snapshot.attractors ?? []

  const coherence = Number(field.coherence ?? 0)
  const resonance = Number(field.resonance ?? 0)
  const confidence = Number(field.semanticGrounding ?? 0)
  const intent = mapIntent(snapshot)

  const passToLLM = coherence > 0.15 || resonance > 0.20 || intent === 'greeting' || intent === 'emotional' || confidence < 0.4

  return {
    ok: true,
    passToLLM,
    signals,
    result: snapshot,
    celfResult: {
      phase: snapshot.phase,
      t: snapshot.t,
      field,
      metrics,
      control,
      perturbation,
      attractors
    }
  }
}

function storeSemanticEntry(sid, t, text) {
  const map = semanticTextMaps.get(sid) ?? new Map()
  const compressed = semanticCompress(text, 15)
  if (!compressed) return

  const hash = semanticHash(compressed)

  for (const [, entry] of map) {
    if (entry.hash === hash) return
    if (jaccardSimilarity(entry.text, compressed) >= DEDUP_JACCARD_THRESHOLD) return
  }

  map.set(t, { hash, text: compressed, at: nowMs() })

  while (map.size > MAX_TEXT_MAP) map.delete(map.keys().next().value)
  semanticTextMaps.set(sid, map)
}

function enrichRouteContext(rawRoute, sid) {
  const map = semanticTextMaps.get(sid) ?? new Map()
  return rawRoute.map(item => ({ ...item, text: map.get(item.t)?.text ?? '' }))
}

function calcRouteConfidence(routedContext) {
  if (!routedContext?.length) return 0
  const valid = routedContext.filter(i => i.score > 0.25 && i.text?.trim().length > 3)
  if (!valid.length) return 0
  const avg = valid.reduce((s, i) => s + i.score, 0) / valid.length
  const density = Math.min(1, valid.length / Math.max(1, routedContext.length))
  return avg * 0.8 + density * 0.2
}

function decayChangedCapsules(engine, changedNodeIds, structIndex) {
  if (!engine || !changedNodeIds?.length || !structIndex) return

  for (const nodeId of changedNodeIds) {
    const node = structIndex.nodes.get(nodeId)
    if (!node?.vaultCapsuleId) continue

    const capsule = engine.vault?.get?.(node.vaultCapsuleId) ?? engine.getActiveCapsules?.().find(c => c.id === node.vaultCapsuleId)
    if (capsule && typeof capsule.reinforcement === 'number') capsule.reinforcement = Math.max(0, capsule.reinforcement * 0.25)
    if (capsule && typeof capsule.weight === 'number') capsule.weight = Math.max(0, capsule.weight * 0.25)

    node.vaultCapsuleId = null
    structIndex.capsuleLinks.delete(nodeId)
  }
}

function getChangedNodeIds(structIndex, path) {
  const changedIds = []
  for (const [id, node] of structIndex.nodes.entries()) {
    if (!id.startsWith(path + '::')) continue
    if (node.vaultCapsuleId) changedIds.push(id)
  }
  return changedIds
}

function buildCodeHint(structIndex) {
  if (!structIndex) return null

  const nodes = [...structIndex.nodes.values()]
  if (!nodes.length) return null

  const classes = nodes.filter(n => n.type === 'class').map(n => n.symbol)
  const methods = nodes
    .filter(n => n.type === 'method' || n.type === 'function')
    .sort((a, b) => (b.usedBy?.length ?? 0) - (a.usedBy?.length ?? 0))
    .slice(0, 6)
    .map(n => n.symbol)

  const extDeps = [...new Set(nodes.flatMap(n => n.imports ?? []).filter(i => !i.startsWith('.')))].slice(0, 4)

  const callChain = nodes
    .filter(n => n.calls?.length > 0)
    .sort((a, b) => (b.usedBy?.length ?? 0) - (a.usedBy?.length ?? 0))
    .slice(0, 3)
    .map(n => `${n.symbol} → ${n.calls.slice(0, 2).join(', ')}`)

  return [
    '[code structure]',
    classes.length ? `class: ${classes.join(', ')}` : null,
    methods.length ? `methods: ${methods.join(', ')}` : null,
    extDeps.length ? `external: ${extDeps.join(', ')}` : null,
    callChain.length ? `flow: ${callChain.join(' | ')}` : null,
    'analyze: practical usage and risks — not philosophy'
  ].filter(Boolean).join('\n')
}

function extractCodePurpose(lang, surroundingText, codeContent) {
  const combined = (surroundingText + ' ' + codeContent.slice(0, 300)).toLowerCase()
  const allTech = [...TECH_KEYWORDS.frameworks, ...TECH_KEYWORDS.databases, ...TECH_KEYWORDS.infra]
  const foundTech = allTech.filter(k => combined.includes(k)).slice(0, 2)
  const foundConcept = TECH_KEYWORDS.concepts.find(k => combined.includes(k))
  const declarations = codeContent.match(/(?:def|function|class|async def)\s+(\w+)/g) ?? []
  const funcNames = declarations.slice(0, 2).map(d => d.split(/\s+/).at(-1))
  const parts = []

  if (lang && lang !== 'code') parts.push(lang)
  if (foundTech.length) parts.push(foundTech.join('+'))
  if (foundConcept) parts.push(foundConcept)
  if (funcNames.length && !foundTech.length) parts.push(funcNames.join(','))

  return parts.length > 1 ? `[${parts.join(': ')}]` : `[${lang || 'code'} implementation]`
}

function compressAssistantMessage(content) {
  if (typeof content !== 'string') return content

  const codeBlockPattern = /```(\w*)\n?([\s\S]*?)```/g
  const parts = []
  let lastIndex = 0
  let match

  codeBlockPattern.lastIndex = 0

  while ((match = codeBlockPattern.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index)
    const lang = match[1]?.trim() || 'code'
    const codeContent = match[2] ?? ''

    if (textBefore.trim()) parts.push({ type: 'text', content: textBefore.trim() })
    parts.push({ type: 'label', content: extractCodePurpose(lang, textBefore, codeContent) })

    lastIndex = match.index + match[0].length
  }

  const textAfter = content.slice(lastIndex).trim()
  if (textAfter) parts.push({ type: 'text', content: textAfter })

  if (!parts.length) return '[response provided]'

  const textParts = parts.filter(p => p.type === 'text').map(p => p.content.slice(0, 240))
  const labelParts = parts.filter(p => p.type === 'label').map(p => p.content)

  return [textParts.join('\n').trim(), labelParts.join(', ')].filter(Boolean).join('\n') || '[response provided]'
}

function compressUserMessage(content) {
  if (typeof content !== 'string') return String(content ?? '').slice(0, 400)

  const hasCode =
    /```[\s\S]*?```/.test(content) ||
    /export\s+class\s+\w+/.test(content) ||
    /function\s+\w+\s*\(/.test(content) ||
    /^\s*(def|class)\s+\w+/m.test(content)

  if (!hasCode) return content.slice(0, 500)

  const withoutCode = content
    .replace(/```[\s\S]*?```/g, '[code attached]')
    .replace(/export\s+(class|function|const|default)\s+[\s\S]{0,80}/g, '[code attached]')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return withoutCode.slice(0, 350) || '[code message]'
}

function compressReplyForFeedback(reply) {
  if (!reply || typeof reply !== 'string') return null

  return reply
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 400)
}

function sanitizeExternalContext(text) {
  if (typeof text !== 'string') return null

  return text
    .replace(/```[\s\S]*?```/g, '[code omitted]')
    .replace(/system\s*:/gi, 'system_')
    .replace(/assistant\s*:/gi, 'assistant_')
    .replace(/developer\s*:/gi, 'developer_')
    .replace(/ignore previous/gi, 'ignore_previous')
    .replace(/disregard/gi, 'disregard_')
    .replace(/instructions/gi, 'notes')
    .replace(/[<>]/g, '')
    .slice(0, 1200)
    .trim()
}

function evaluateCapsuleContext(engine, questionVector, capsuleContext, questionText) {
  const safeContext = sanitizeExternalContext(capsuleContext)

  if (!safeContext || !questionVector?.length) return { score: 0, used: false, reason: 'no_context' }

  const capsuleVector = engine.semanticVector?.(safeContext)
  if (!capsuleVector?.length) return { score: 0, used: false, reason: 'no_vector' }

  const semanticScore = engine.cosineSimilarity(questionVector, capsuleVector)

  const tokenize = t => t.toLowerCase().replace(/[،,.:;!?()[\]{}<>"']/g, ' ').split(/\s+/).filter(w => w.length > 3)
  const qTokens = new Set(tokenize(questionText))
  const lexicalMatch = tokenize(safeContext).filter(w => qTokens.has(w)).length
  const lexicalBonus = Math.min(0.20, lexicalMatch * 0.07)

  const questionHasCode = /كود|error|function|class|fix|bug|خطأ|برمج|api|express|react|vue|angular|javascript|typescript|python/i.test(questionText)
  const capsuleHasCode = /function|class|error|const|let|var|=>|import|export|express|react|vue|angular|app\.|get\(|post\(|def\s+\w+/i.test(safeContext)
  const codeBonus = questionHasCode && capsuleHasCode ? 0.20 : 0
  const hasAnySignal = lexicalMatch > 0 || codeBonus > 0 || semanticScore >= 0.45

  if (!hasAnySignal) return { score: semanticScore, used: false, reason: 'no_signal' }

  const finalScore = Math.min(1, semanticScore + codeBonus + lexicalBonus)
  const threshold = questionHasCode ? 0.18 : 0.28
  const used = finalScore >= threshold

  return {
    score: Math.round(finalScore * 1000) / 1000,
    semanticScore: Math.round(semanticScore * 1000) / 1000,
    codeBonus,
    lexicalBonus: Math.round(lexicalBonus * 1000) / 1000,
    used,
    threshold,
    reason: used ? 'relevant' : `below_threshold_${threshold}`,
    safeContext
  }
}

function detectTechnicalIntent(text) {
  const intentPattern = /تعديل|إصلاح|حلل|تحليل|أصلح|عدّل|احذف|أضف|استبدل|حسّن|اكتب|أعد|صحح|راجع|اختبر|debug|fix|edit|rewrite|refactor|analyze|update|improve|replace|add|remove|correct|review|check|test/i
  return intentPattern.test(text)
}

function isStandaloneQuestion(cleanedText, wordCount, noveltyPressure, codeBlocks) {
  if (codeBlocks.length > 0) return false
  if (wordCount > 6) return false
  if (noveltyPressure < 0.65) return false

  const greetings = /^(salam|salem|hallo|hello|hi|hey|مرحبا|السلام|هاي|اهلا|guten|مرحبأ|مساء|صباح|كيف|wie geht|bonjour)$/i

  if (greetings.test(cleanedText.trim())) return true
  if (noveltyPressure > 0.80 && wordCount <= 4) return true

  return false
}

function buildStateHint(phase, continuity) {
  if (!phase || phase === 'warmup') return null
  if (phase === 'drift' || continuity < 0.20) return '[mode: ground — answer directly, ignore prior context]'
  if (phase === 'turbulent') return '[mode: clarify — stay focused on current question]'
  if (phase === 'locked' && continuity > 0.70) return '[mode: continue — build on previous answers]'
  if (phase === 'emergent') return '[mode: explore — be comprehensive]'
  return null
}

function uniqueLines(text) {
  if (!text) return null

  const seen = new Set()
  const lines = []

  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(trimmed)
  }

  return lines.join('\n').trim() || null
}

function buildMiniContext({ frontendContext, capsuleEvalResult, vaultHit, codeHint, builtSystemHint, activeStyle, continuity, phase }) {
  const parts = []
  const stateHint = buildStateHint(phase, continuity)

  if (stateHint) parts.push(stateHint)
  if (codeHint) parts.push(codeHint)

  if (frontendContext && capsuleEvalResult?.score >= 0.50) {
    const safe = sanitizeExternalContext(frontendContext)
    if (safe) parts.push(`[memory]\n${safe.slice(0, 300)}`)
  }

  if (vaultHit?.compressed && vaultHit?.score >= 0.55) {
    parts.push(`[recall] ${vaultHit.compressed}`)
  }

  if (builtSystemHint) parts.push(builtSystemHint)

  const styleMap = {
    concise: 'أجب بإيجاز.',
    detailed: 'أجب بتفصيل كامل.',
    arabic: 'أجب باللغة العربية.',
    english: 'Reply in English.',
    german: 'Antworte auf Deutsch.'
  }

  if (activeStyle && styleMap[activeStyle]) parts.push(styleMap[activeStyle])

  const miniContext = uniqueLines(parts.filter(Boolean).join('\n')) || null

  return {
    miniContext,
    tokenEstimate: estimateTokens(miniContext ?? ''),
    layers: {
      state: !!stateHint,
      code: !!codeHint,
      memory: !!(frontendContext && capsuleEvalResult?.score >= 0.50),
      vault: !!(vaultHit?.score >= 0.55),
      context: !!builtSystemHint,
      style: !!activeStyle
    }
  }
}

function storeCapsule(sid, observer, topicText, t) {
  if (!observer?.diagnostics) return

  const d = observer.diagnostics
  if (d.confidence === 'unknown') return

  const store = capsuleMemory.get(sid) ?? []

  store.push({
    topic: topicText ?? 'general',
    covered: d.concepts?.filter(c => c.covered).map(c => c.label) ?? [],
    pending: d.concepts?.filter(c => !c.covered).map(c => c.label) ?? [],
    confidence: d.confidence,
    coverage: d.coverage,
    source: 'observer',
    lang: d.lang ?? 'en',
    t,
    at: nowMs()
  })

  while (store.length > 10) store.shift()
  capsuleMemory.set(sid, store)
}

function updateAnchors(sid, topicText, weight) {
  if (!topicText || weight < 0.3) return

  const store = anchorMemory.get(sid) ?? []
  const existing = store.find(a => a.concept === topicText)

  if (existing) {
    existing.weight = Math.min(1, existing.weight * 0.9 + weight * 0.1)
    existing.t = nowMs()
  } else {
    store.push({ concept: topicText, weight, t: nowMs() })
  }

  store.sort((a, b) => b.weight - a.weight)
  while (store.length > 5) store.pop()

  anchorMemory.set(sid, store)
}

function buildCapsuleContext(sid) {
  const caps = capsuleMemory.get(sid) ?? []
  if (!caps.length) return []

  const lines = caps.slice(-3).map(c => {
    const parts = [`topic:${c.topic}`]
    if (c.covered?.length) parts.push(`covered:${c.covered.slice(0, 3).join(',')}`)
    if (c.pending?.length) parts.push(`pending:${c.pending.slice(0, 2).join(',')}`)
    if (c.confidence) parts.push(`conf:${c.confidence}`)
    return parts.join(' | ')
  })

  return [{ role: 'user', content: `[memory]\n${lines.join('\n')}` }]
}

function buildAnchorContext(sid) {
  const anchors = anchorMemory.get(sid) ?? []
  if (!anchors.length) return []

  const top = anchors.slice(0, 3).map(a => `${a.concept}(${Math.round(a.weight * 100)}%)`).join(', ')
  return [{ role: 'user', content: `[persistent topics: ${top}]` }]
}

function buildFragmentContext(sid, history) {
  const lastAssistant = [...history].reverse().find(h => h.role === 'assistant')
  if (!lastAssistant) return buildAnchorContext(sid)

  const fragment = compressAssistantMessage(lastAssistant.content).slice(0, 220)
  return [...buildAnchorContext(sid), { role: 'assistant', content: `[fragment] ${fragment}` }]
}

function buildHistoryLayer(history, continuity, sid, needsRawCode = false) {
  const filtered = filterStyleInstructions(history)
  const clean = filtered.filter(h =>
    h &&
    (h.role === 'user' || h.role === 'assistant') &&
    typeof h.content === 'string' &&
    h.content.length > 0
  )

  if (continuity >= 0.70) {
    const msgs = clean.slice(-4)
    if (msgs.length < 2) return []

    return msgs.map(h => ({
      role: h.role,
      content: h.role === 'assistant'
        ? compressAssistantMessage(h.content)
        : needsRawCode
          ? h.content
          : compressUserMessage(h.content)
    }))
  }

  if (continuity >= 0.40) {
    const msgs = clean.slice(-2)
    const compressed = msgs.length >= 2
      ? msgs.map(h => ({
          role: h.role,
          content: h.role === 'assistant'
            ? compressAssistantMessage(h.content)
            : needsRawCode
              ? h.content
              : compressUserMessage(h.content)
        }))
      : []

    return [...compressed, ...buildCapsuleContext(sid)]
  }

  if (continuity >= 0.20) return [...buildCapsuleContext(sid), ...buildAnchorContext(sid)]

  return buildFragmentContext(sid, history)
}

function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4)
}

function trimToTokens(text, maxTokens) {
  const s = String(text ?? '')
  if (estimateTokens(s) <= maxTokens) return s
  return s.slice(0, maxTokens * 4) + '\n[truncated]'
}

function trimMessagesToBudget(messages, maxTokens) {
  let current = messages.map(m => ({ ...m }))
  while (estimateTokens(JSON.stringify(current)) > maxTokens && current.length > 1) {
    const idx = current.findIndex(m => m.role === 'assistant')
    if (idx >= 0) current.splice(idx, 1)
    else current.splice(0, 1)
  }

  if (estimateTokens(JSON.stringify(current)) > maxTokens && current.length === 1 && typeof current[0].content === 'string') {
    current[0].content = trimToTokens(current[0].content, maxTokens)
  }

  return current
}

function checkPayload(systemHint, messages) {
  const size = JSON.stringify({ system: systemHint, messages }).length
  if (size > MAX_PROMPT_BYTES) throw new Error('prompt_too_large')
  return size
}

async function fetchClaude(body, timeoutMs = 120000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

function buildClaudeBody(model, maxTokens, systemHint, messages) {
  const body = { model, max_tokens: maxTokens, messages }
  if (systemHint && String(systemHint).trim()) body.system = String(systemHint).trim()
  return body
}

function isTruncated(claudeData) {
  return claudeData?.stop_reason === 'max_tokens'
}

function detectOpenCodeBlock(text) {
  return (text.match(/```/g) ?? []).length % 2 !== 0
}

function removeOverlap(existing, continuation) {
  const checkLen = Math.min(120, continuation.length)
  const tail = existing.slice(-checkLen * 2)
  const head = continuation.slice(0, checkLen)

  for (let len = checkLen; len >= 20; len--) {
    const fragment = head.slice(0, len)
    if (tail.includes(fragment)) return continuation.slice(continuation.indexOf(fragment) + fragment.length)
  }

  return continuation
}

async function continuationCall(currentText, partialReply, systemHint, timeoutMs = 30000, model = 'claude-haiku-4-5-20251001') {
  const hasOpenCode = detectOpenCodeBlock(partialReply)
  const continuePrompt = hasOpenCode
    ? 'continue exactly from where you stopped — complete the open code block, do not repeat what was already written'
    : 'continue exactly from where you stopped — do not repeat what was already written'

  const body = buildClaudeBody(model, 2048, systemHint, [
    { role: 'user', content: currentText },
    { role: 'assistant', content: partialReply.slice(-3000) },
    { role: 'user', content: continuePrompt }
  ])

  const response = await fetchClaude(body, timeoutMs)
  return await response.json()
}

function normalizeSavedVault(savedVault) {
  if (!Array.isArray(savedVault)) return []
  return savedVault.slice(-MAX_CAPSULES).filter(cap => cap && typeof cap.id === 'string')
}

router.get('/process-text', (_req, res) => {
  res.json({
    ok: true,
    status: 'online',
    engine: 'CELF_Engine_AI_V5',
    llm: 'Claude Haiku 4.5',
    version: '9.3'
  })
})

router.post('/process-text', async (req, res) => {
  const {
    text = '',
    sessionId,
    history = [],
    image = null,
    imageMimeType = 'image/jpeg',
    capsuleContext = null
  } = req.body

  const hasText = typeof text === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) return res.status(400).json({ error: 'missing_input' })
  if (hasImage && image.length > 5_000_000) return res.status(413).json({ error: 'image_too_large' })

  const sid = sessionId || 'default'
  cleanupStores()

  if (processingLock.has(sid)) {
    const startedAt = processingLock.get(sid)
    if (nowMs() - startedAt <= LOCK_TTL_MS) return res.status(429).json({ error: 'request_in_progress', retry: true })
    processingLock.delete(sid)
  }

  processingLock.set(sid, nowMs())
  touchSession(sid)

  try {
    const rawText = hasText && text.length > MAX_INPUT_CHARS
      ? text.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated ...]'
      : text

    const cleanedText = hasText ? cleanInput(rawText) : rawText
    const noiseRemoved = hasText && cleanedText !== rawText
    const inputText = cleanedText || '(image)'

    if (hasText) {
      const styleDetected = detectStyleInstruction(cleanedText)
      if (styleDetected) setStyle(sid, styleDetected.style, styleDetected.ttl)
    }

    const activeStyle = getAndTickStyle(sid)

    const savedVault = normalizeSavedVault(req.body.celfVault)
    if (savedVault.length > 0) {
      const engine0 = getEngine(sid)
      for (const cap of savedVault) {
        if (cap.id && !engine0.vault.has(cap.id)) {
          engine0.vault.set(cap.id, {
            ...cap,
            vector: cap.vector ? new Float32Array(cap.vector) : new Float32Array(64),
            continuity: cap.continuity ?? 0,
            novelty: cap.novelty ?? 0,
            coherence: cap.coherence ?? 0,
            resonance: cap.resonance ?? 0
          })
        }
      }
    }

    const processed = feed(sid, inputText)
    if (!processed.ok) return res.status(422).json({ error: processed.reason || 'processing_failed' })

    const tValue = processed.result.t

    const textForMemory = cleanedText
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\s*export\s+class\s+\w+[\s\S]*$/m, '')
      .replace(/^\s*function\s+\w+[\s\S]*$/m, '')
      .replace(/^\s*(def|class)\s+\w+[\s\S]*$/m, '')
      .replace(/\s{2,}/g, ' ')
      .trim()

    storeSemanticEntry(sid, tValue, textForMemory || inputText)

    const engine = getEngine(sid)
    const questionVector = cachedVector(sid, engine, cleanedText)
    const semanticMemory = engine.field?.semanticMemory ?? []
    const prevVector = semanticMemory.length >= 2 ? semanticMemory.at(-2)?.vector : null
    const questionSimilarity = questionVector && prevVector ? engine.cosineSimilarity(questionVector, prevVector) : null

    const textMap = semanticTextMaps.get(sid)
    const userMsgs = (history ?? []).filter(h => h.role === 'user')
    const prevUserMsg = userMsgs.length >= 2 ? userMsgs[userMsgs.length - 2] : null
    const lastTopicText = textMap?.get(tValue - 1)?.text ?? prevUserMsg?.content?.split(/\s+/).slice(0, 8).join(' ') ?? null

    const structIndex = indexStore?.get(sid) ?? null
    const codeBlocks = detectCodeBlocks(cleanedText)
    let codeHint = null

    if (codeBlocks.length > 0 && structIndex) {
      const tempPath = `session_inline/${sid}/msg_${tValue}.js`
      const changedNodeIds = getChangedNodeIds(structIndex, tempPath)
      const updateResult = structIndex.updateFile(tempPath, codeBlocks.join('\n\n'))

      if (updateResult?.changed && changedNodeIds.length > 0) {
        decayChangedCapsules(engine, changedNodeIds, structIndex)
      }

      structIndex.injectSemanticVectors(engine)
      structIndex.injectIntoVault(engine)
      codeHint = buildCodeHint(structIndex)

      if (codeHint) {
        const codeMemory = codeHint
          .replace('[code structure]', '')
          .replace('analyze: practical usage and risks — not philosophy', '')
          .trim()

        if (codeMemory) storeSemanticEntry(sid, tValue + 0.5, codeMemory)
      }
    }

    const wordCount = cleanedText.trim().split(/\s+/).filter(Boolean).length
    const noveltyPressure = processed.celfResult.field?.noveltyPressure ?? 0

    const historyHasCode = (history ?? []).some(h => h.role === 'user' && detectCodeBlocks(h.content).length > 0)
    const hasCodeContext = codeBlocks.length > 0 || historyHasCode
    const needsRawCode = hasCodeContext && detectTechnicalIntent(cleanedText)

    const codeOnlyMsg = codeBlocks.length > 0 && wordCount <= 4
      ? 'Analyze this code: identify its purpose, structure, and any issues.'
      : null

    const rawRoute = engine.routeContext(cleanedText, 5)
    const routeItems = Array.isArray(rawRoute) ? rawRoute : (rawRoute?.items ?? [])
    const vaultHit = Array.isArray(rawRoute) ? null : (rawRoute?.vaultHit ?? null)
    const routedContext = enrichRouteContext(routeItems, sid)
    const routeConf = calcRouteConfidence(routedContext)

    const built = build({
      ok: true,
      signals: processed.signals,
      celfResult: processed.celfResult,
      passToLLM: processed.passToLLM,
      routedContext: vaultHit ? { items: routedContext, vaultHit } : routedContext,
      questionText: cleanedText,
      questionSimilarity,
      lastTopicText,
      activeStyle
    })

    if (built.blocked) return res.status(422).json({ blocked: true, reason: 'semantic_constraint' })
    if (!built.passToLLM && !hasImage) return res.json({ reply: null, skippedLLM: true, reason: 'weak_semantic_field' })

    const standalone = isStandaloneQuestion(cleanedText, wordCount, noveltyPressure, codeBlocks)

    let frontendContext = null
    let capsuleEvalResult = { score: 0, used: false, reason: 'skipped' }

    if (!standalone && typeof capsuleContext === 'string' && capsuleContext.length > 0 && questionVector) {
      capsuleEvalResult = evaluateCapsuleContext(engine, questionVector, capsuleContext, cleanedText)
      if (capsuleEvalResult.used) frontendContext = capsuleEvalResult.safeContext
    }

    const continuity = standalone ? 0 : (built.context?.continuity ?? 0)

    const miniCtxResult = buildMiniContext({
      frontendContext,
      capsuleEvalResult,
      vaultHit,
      codeHint,
      builtSystemHint: built.systemHint,
      activeStyle,
      continuity,
      phase: processed.celfResult.phase ?? 'warmup'
    })

    const noMarkdown = codeBlocks.length === 0 ? ' No markdown unless necessary. No bullet points. No bold text.' : ''
    const conciseHint = codeBlocks.length > 0
      ? 'Be thorough with code examples.'
      : wordCount <= 5
        ? 'Be concise and complete.' + noMarkdown
        : wordCount <= 15
          ? 'Answer fully but without repetition.' + noMarkdown
          : 'Be clear and complete.' + noMarkdown

    const prevCodeFailed = hasCodeContext && (history ?? []).some(h =>
      h.role === 'user' &&
      /لا يعمل|لا يشتغل|not working|doesn't work|broken|crash|يعطي خطأ|gives error/i.test(h.content)
    )

    const reflective = prevCodeFailed
      ? 'Previous attempt had issues. Identify the root cause first, then provide a corrected solution.'
      : null

    const userContent = hasImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } },
          ...(hasText ? [{ type: 'text', text: cleanedText }] : [])
        ]
      : cleanedText

    const filteredHistory = filterStyleInstructions(history)
    const historyMessagesRaw = hasImage || standalone
      ? []
      : buildHistoryLayer(filteredHistory, continuity, sid, needsRawCode)

    const historyMessages = trimMessagesToBudget(historyMessagesRaw, needsRawCode ? 18000 : 5000)
    let messages = [...historyMessages, { role: 'user', content: hasImage ? userContent : cleanedText }]

    const tldr = messages.length > 6 ? 'Be direct. Avoid restating context already known.' : null

    const systemHint = uniqueLines([
      miniCtxResult.miniContext,
      codeOnlyMsg,
      reflective,
      tldr,
      conciseHint
    ].filter(Boolean).join('\n')) || null

    messages = trimMessagesToBudget(messages, 26000)

    const inputEstimate = estimateTokens(systemHint ?? '') + estimateTokens(JSON.stringify(messages))
    const remaining = Math.max(1000, 180000 - inputEstimate)

    const maxTokens = codeBlocks.length > 0
      ? Math.min(4000, Math.max(1000, Math.floor(remaining * 0.4)))
      : wordCount <= 5
        ? 1000
        : wordCount <= 15
          ? 1800
          : 2500

    let payloadSize = 0

    try {
      payloadSize = checkPayload(systemHint, messages)
    } catch (e) {
      messages = trimMessagesToBudget(messages, 18000)
      payloadSize = checkPayload(systemHint, messages)
    }

    const model = 'claude-haiku-4-5-20251001'

    let claudeData
    let reply = null
    let inputTokensTotal = 0
    let outputTokensTotal = 0

    try {
      const claudeBody = buildClaudeBody(model, maxTokens, systemHint, messages)

      console.log('=== TO LLM ===', JSON.stringify({
        system: systemHint,
        msgCount: messages.length,
        maxTokens,
        standalone,
        needsRawCode,
        model
      }, null, 2))

      const claudeResponse = await fetchClaude(claudeBody)
      claudeData = await claudeResponse.json()

      if (!claudeResponse.ok) {
        throw new Error(`Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`)
      }

      reply = claudeData?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || null
      inputTokensTotal = claudeData?.usage?.input_tokens ?? 0
      outputTokensTotal = claudeData?.usage?.output_tokens ?? 0

      let continuationCount = 0
      let lastReplyHash = semanticHash(reply ?? '')

      while (reply && isTruncated(claudeData) && continuationCount < MAX_CONTINUATIONS) {
        continuationCount++
        if (outputTokensTotal >= 4096) break

        const contData = await continuationCall(cleanedText, reply, systemHint, 30000, model)
        if (!contData?.content?.[0]?.text) break

        const addition = removeOverlap(reply, contData.content[0].text)
        const nextHash = semanticHash(addition)

        if (nextHash === lastReplyHash || addition.trim().length < 20) break

        reply += addition
        lastReplyHash = nextHash
        inputTokensTotal += contData?.usage?.input_tokens ?? 0
        outputTokensTotal += contData?.usage?.output_tokens ?? 0
        claudeData = contData
      }
    } catch (err) {
      if (err.name === 'AbortError') return res.status(504).json({ error: 'claude_timeout' })
      throw err
    }

    const isFirstMsg = tValue <= 1
    const isTooShort = wordCount <= 2
    const isCodeOnly = codeBlocks.length > 0 && wordCount <= 8

    let observerBox = null

    if (reply && !hasImage && !isFirstMsg && !isTooShort && !isCodeOnly && questionVector?.length) {
      observerBox = observe({
        engine,
        questionText: cleanedText,
        questionVector,
        replyText: reply,
        noiseRemoved,
        lang: processed.signals?.lang ?? 'en'
      })

      if (observerBox && !detectTechnicalIntent(cleanedText)) {
        storeCapsule(sid, observerBox, lastTopicText, tValue)
        updateAnchors(sid, lastTopicText, questionSimilarity ?? 0.5)
      }
    }

    let feedbackApplied = false
    let feedbackCoherence = null

    if (reply && !detectTechnicalIntent(cleanedText)) {
      const replyCompressed = compressReplyForFeedback(reply)

      if (replyCompressed) {
        try {
          engine.process(replyCompressed, { sourceWeight: 0.15 })
          feedbackApplied = true
          feedbackCoherence = engine.field?.semanticCoherence ?? null
        } catch (feedbackErr) {
          console.warn('[CELF feedback]', feedbackErr.message)
        }
      }
    }

    const costUSD = parseFloat(((inputTokensTotal / 1_000_000) * 1.0 + (outputTokensTotal / 1_000_000) * 5.0).toFixed(6))

    metricsStore.set(sid, {
      sessionId: sid,
      inputTokens: inputTokensTotal,
      outputTokens: outputTokensTotal,
      totalTokens: inputTokensTotal + outputTokensTotal,
      costUSD,
      maxTokens,
      payloadSize,
      routeConfidence: Math.round(routeConf * 1000) / 1000,
      continuity,
      phase: processed.celfResult.phase ?? 'warmup',
      questionSimilarity: questionSimilarity !== null ? Math.round(questionSimilarity * 100) / 100 : null,
      activeStyle,
      noiseRemoved,
      feedbackApplied,
      feedbackCoherence,
      updatedAt: new Date().toISOString()
    })

    cleanupStores()

    const engineFinal = getEngine(sid)

    const vaultToSave = [...engineFinal.vault.values()].slice(-MAX_CAPSULES).map(c => ({
      id: c.id,
      vector: Array.from(c.vector ?? []),
      text: c.text?.slice(0, 200) ?? '',
      phase: c.phase ?? 'warmup',
      error: c.error ?? 0,
      theta: c.theta ?? 0,
      reinforcement: c.reinforcement ?? 0,
      continuity: c.continuity ?? 0,
      novelty: c.novelty ?? 0,
      coherence: c.coherence ?? 0,
      resonance: c.resonance ?? 0
    }))

    return res.json({
      reply,
      celfVault: vaultToSave,
      observer: observerBox,
      debug: {
        messageCount: messages.length,
        historyCount: historyMessages.length,
        continuityTier: continuity >= 0.70
          ? 'T1-full'
          : continuity >= 0.40
            ? 'T2-compressed+capsules'
            : continuity >= 0.20
              ? 'T3-capsules+anchors'
              : 'T4-fragments',
        capsules: (capsuleMemory.get(sid) ?? []).length,
        anchors: (anchorMemory.get(sid) ?? []).length,
        questionSimilarity: questionSimilarity !== null ? Math.round(questionSimilarity * 100) / 100 : null,
        activeStyle,
        lastTopicText,
        vaultHitUsed: !!vaultHit?.compressed,
        hasCapsuleCtx: !!frontendContext,
        feedbackApplied,
        feedbackCoherence,
        standalone,
        needsRawCode,
        historyHasCode,
        capsuleEval: {
          score: capsuleEvalResult.score,
          used: capsuleEvalResult.used,
          reason: capsuleEvalResult.reason
        },
        miniContext: {
          tokenEstimate: miniCtxResult.tokenEstimate,
          layers: miniCtxResult.layers
        }
      },
      metrics: {
        inputTokens: inputTokensTotal,
        outputTokens: outputTokensTotal,
        totalTokens: inputTokensTotal + outputTokensTotal,
        costUSD,
        maxTokens,
        routeConfidence: Math.round(routeConf * 1000) / 1000,
        vaultHit: vaultHit ? { score: vaultHit.score, compressed: vaultHit.compressed } : null,
        model,
        inlineCode: codeBlocks.length > 0,
        payloadSize,
        questionSimilarity: questionSimilarity !== null ? Math.round(questionSimilarity * 100) / 100 : null,
        activeStyle,
        styleTtlRemaining: styleStore.get(sid)?.ttl ?? 0,
        noiseRemoved,
        truncated: hasText && text.length > MAX_INPUT_CHARS,
        feedbackApplied,
        feedbackCoherence
      }
    })
  } catch (err) {
    console.error('[process-text] error:', err.message)
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  } finally {
    processingLock.delete(sid)
  }
})

router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) return res.status(404).json({ error: 'session_not_found' })
  touchSession(req.params.id)
  const summary = sessions.get(req.params.id).getSummary?.() ?? {}
  return res.json({ ok: true, sessionId: req.params.id, summary })
})

router.get('/metrics/:id', (req, res) => {
  const m = metricsStore.get(req.params.id)
  if (!m) return res.status(404).json({ error: 'metrics_not_found' })
  return res.json(m)
})

router.delete('/session/:id', (req, res) => {
  sessions.delete(req.params.id)
  sessionAccess.delete(req.params.id)
  metricsStore.delete(req.params.id)
  semanticTextMaps.delete(req.params.id)
  styleStore.delete(req.params.id)
  processingLock.delete(req.params.id)
  capsuleMemory.delete(req.params.id)
  anchorMemory.delete(req.params.id)

  for (const key of vectorCache.keys()) {
    if (key.startsWith(req.params.id + ':')) vectorCache.delete(key)
  }

  return res.json({ ok: true })
})

export { getEngine }
export default router
