import express from 'express'
import { resolveConceptAnchors }                                               from '../utils/concept-anchor.js'
import { CELF_Engine_AI_V5 }                                                   from '../engines/celf-engine-v5.js'
import { parse }                                                               from '../utils/lightweight-parser.js'
import { cleanInput, filterStyleInstructions, detectStyleInstruction }         from '../utils/context-builder.js'
import { observe }                                                             from '../utils/celf-observer.js'
import { getVectorSync, getVector }                                            from '../utils/vector-store.js'

const router = express.Router()

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MAX_SESSIONS       = 150
const MAX_INPUT_CHARS    = 40000
const MAX_TEXT_MAP       = 300
const SUMMARY_INTERVAL   = 8
const RECOVERED_CODE_LIMIT = 14000
const ENABLE_VORSCHLAG   = false

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// ═══════════════════════════════════════════════════════════════
//  STATE STORES
// ═══════════════════════════════════════════════════════════════

const sessions            = new Map()
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
const _entityTracker      = new Map()
const _fieldHistory       = new Map()

// ═══════════════════════════════════════════════════════════════
//  ENGINE
// ═══════════════════════════════════════════════════════════════

function getEngine(sid) {
  if (sessions.has(sid)) {
    const e = sessions.get(sid); sessions.delete(sid); sessions.set(sid, e); return e
  }
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    sessions.delete(oldest)
    processingLock.delete(oldest)
    semanticTextMaps.delete(oldest)
    styleStore.delete(oldest)
    rawCodeStore.delete(oldest)
    codeSessionStore.delete(oldest)
    sessionSummaryStore.delete(oldest)
    resumeBootstrapped.delete(oldest)
    capsuleMemory.delete(oldest)
    anchorMemory.delete(oldest)
    metricsStore.delete(oldest)
    _semanticState.delete(oldest)
    _entityTracker.delete(oldest)
    _fieldHistory.delete(oldest)
  }
  const engine = new CELF_Engine_AI_V5({
    resolution: 120, ringCount: 3, cycle: 360,
    diffusionRate: 0.08, constraintRate: 0.12,
    attractorLimit: 8, historyLimit: 128, archiveLimit: 128, semanticMemoryLimit: 96
  })
  sessions.set(sid, engine)
  return engine
}

function feed(sid, text) {
  const signals = parse(text)
  if (!signals.valid) return { ok: false, reason: signals.reason ?? 'invalid_signals' }
  const engine   = getEngine(sid)
  const snapshot = engine.process(text)
  const field    = snapshot.field        ?? {}
  const metrics  = snapshot.metrics      ?? {}
  const coherence  = Number(field.coherence        ?? 0)
  const resonance  = Number(field.resonance         ?? 0)
  const confidence = Number(field.semanticGrounding ?? 0)
  const intent     = snapshot.perturbation?.semantic?.question ? 'question' : 'statement'
  const passToLLM  = coherence > 0.15 || resonance > 0.20 || confidence < 0.4
  return { ok: true, passToLLM, signals, result: snapshot, celfResult: { phase: snapshot.phase, t: snapshot.t, field, metrics, perturbation: snapshot.perturbation ?? {}, attractors: snapshot.attractors ?? [] } }
}

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════

function engine_cosine(a, b) {
  if (!a?.length || !b?.length) return 0
  const n = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return (na > 0 && nb > 0) ? Math.max(0, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb)))) : 0
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

function classifyDomain(text) {
  if (!text || typeof text !== 'string') return 'general'
  const t = text.toLowerCase()
  if (/error|bug|crash|exception|debug|fix|مشكلة|خطأ|لا يعمل|fail/i.test(t))              return 'debugging'
  if (/backend|express|fastapi|django|flask|server|api|route|endpoint/i.test(t))           return 'backend'
  if (/frontend|react|vue|angular|html|css|dom|component|ui/i.test(t))                     return 'frontend'
  if (/database|redis|postgres|mysql|mongodb|sql|query|schema/i.test(t))                   return 'database'
  if (/auth|jwt|token|oauth|session|login|password/i.test(t))                              return 'security'
  if (/docker|railway|nginx|kubernetes|deploy|cloud/i.test(t))                             return 'devops'
  if (/algorithm|sort|search|graph|tree|dynamic|recursion/i.test(t))                       return 'algorithms'
  if (/test|jest|mocha|cypress|spec|unit|mock|coverage/i.test(t))                          return 'testing'
  if (/const|let|var|function|class|import|export|async/.test(t) && t.length > 80)         return 'code'
  if (/فيزياء|physics|كيمياء|chemistry|بيولوجيا|biology|كوانتم|quantum|ذرة|atom|موجة|wave|تشابك|entanglement|نسبية|relativity|ميكانيكا|mechanics|طاقة|energy|جسيم|particle|نووي|nuclear/i.test(t)) return 'science'
  if (/رياضيات|math|جبر|algebra|هندسة|geometry|إحصاء|statistics|حساب|calculus|مبرهنة|theorem|معادلة|equation|دالة.*رياضي|تفاضل|differential|تكامل|integral/i.test(t))  return 'math'
  if (/تاريخ|history|جغرافيا|geography|فلسفة|philosophy|أدب|literature|لغة|language/i.test(t)) return 'humanities'
  return 'general'
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
    const textBefore  = content.slice(lastIndex, match.index)
    const lang        = match[1]?.trim() || 'code'
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

function compressReplyForFeedback(reply) {
  if (!reply || typeof reply !== 'string') return null
  return reply.replace(/```[\s\S]*?```/g, '[code]').replace(/\n{3,}/g, '\n\n').trim().slice(0, 400)
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

// ═══════════════════════════════════════════════════════════════
//  CODE MANAGER
// ═══════════════════════════════════════════════════════════════

function storeCodeContext(sid, rawArr, engine, tValue) {
  const contexts = rawCodeStore.get(sid) ?? []
  for (const raw of rawArr) {
    if (!raw || raw.length < 30) continue
    let cs = 2166136261
    for (let i = 0; i < raw.length; i++) { cs ^= raw.charCodeAt(i); cs = Math.imul(cs, 16777619) }
    const hash     = Math.abs(cs >>> 0).toString(16)
    const existing = contexts.find(c => c.hash === hash)
    if (existing) { existing.updatedAt = Date.now(); existing.msgIndex = tValue; continue }
    const symbols       = extractSymbols(raw)
    const summary       = `${classifyDomain(raw)} code: ${symbols.slice(0,6).join(', ') || 'general'}`
    const codeVector    = engine.semanticVector(raw.slice(0, 2000))
    const summaryVector = engine.semanticVector(summary)
    contexts.push({ id: `ctx_${tValue}_${hash.slice(0,6)}`, raw, codeVector, summaryVector, symbols, summary, domain: classifyDomain(raw), hash, createdAt: Date.now(), updatedAt: Date.now(), msgIndex: tValue })
  }
  if (contexts.length > 10) contexts.splice(0, contexts.length - 10)
  rawCodeStore.set(sid, contexts)
}

function retrieveRelevantCode(questionVector, questionText, sid, currentMsgIndex) {
  const contexts = rawCodeStore.get(sid) ?? []
  if (!contexts.length) return null
  let best = null, bestScore = 0
  const qLower = questionText.toLowerCase()
  for (const ctx of contexts) {
    const codeSim    = questionVector && ctx.codeVector    ? engine_cosine(questionVector, ctx.codeVector)    : 0
    const summarySim = questionVector && ctx.summaryVector ? engine_cosine(questionVector, ctx.summaryVector) : 0
    const symbolBoost = (ctx.symbols ?? []).filter(s => qLower.includes(s)).length * 0.12
    const msgAge      = Math.max(0, currentMsgIndex - ctx.msgIndex)
    const freshness   = Math.max(0, 1 - msgAge / 20)
    const finalScore  = (codeSim * 0.55 + summarySim * 0.30 + Math.min(0.30, symbolBoost) * 0.15) * 0.85 + freshness * 0.15
    if (finalScore > bestScore && finalScore > 0.25) { bestScore = finalScore; best = ctx }
  }
  return best
}

// ═══════════════════════════════════════════════════════════════
//  MEMORY
// ═══════════════════════════════════════════════════════════════

function storeCapsule(sid, observer, topicText, t, domain = 'general') {
  if (!observer?.diagnostics) return
  const d = observer.diagnostics
  if (d.confidence === 'unknown') return
  const sessionCaps = capsuleMemory.get(sid) ?? new Map()
  const store = sessionCaps.get(domain) ?? []
  store.push({ topic: topicText ?? 'general', covered: d.concepts?.filter(c => c.covered).map(c => c.label) ?? [], pending: d.concepts?.filter(c => !c.covered).map(c => c.label) ?? [], confidence: d.confidence, coverage: d.coverage, t })
  if (store.length > 8) store.shift()
  sessionCaps.set(domain, store)
  capsuleMemory.set(sid, sessionCaps)
}

function updateAnchors(sid, topicText, weight, domain = 'general') {
  if (!topicText || weight < 0.3) return
  const sessionAnchors = anchorMemory.get(sid) instanceof Map
    ? anchorMemory.get(sid)
    : new Map()
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
  // نجلب الـ domain الحالي + general كسياق إضافي
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
  // دعم Map بـ domain أو Array قديم
  const anchors = sessionAnchors instanceof Map
    ? [...(sessionAnchors.get(domain) ?? []), ...(domain !== 'general' ? (sessionAnchors.get('general') ?? []) : [])]
    : sessionAnchors
  if (!anchors.length) return []
  const top = anchors.slice(0, 3).map(a => `${a.concept}(${Math.round(a.weight*100)}%)`).join(', ')
  return [{ role: 'user', content: `[persistent topics: ${top}]` }]
}

function evaluateCapsuleContext(engine, questionVector, capsuleContext, questionText) {
  if (!capsuleContext || !questionVector?.length) return { score: 0, used: false }
  const capsuleVector = engine.semanticVector?.(capsuleContext)
  if (!capsuleVector?.length) return { score: 0, used: false }
  const sim   = engine.cosineSimilarity(questionVector, capsuleVector)
  const used  = sim >= 0.28
  return { score: Math.round(sim * 1000) / 1000, used }
}

async function generateSessionSummary(sid, history, engine) {
  if (!history || history.length < 4) return null
  const recent  = history.slice(-16)
  const domain  = classifyDomain(recent.filter(h => h.role === 'user').map(h => h.content).join(' '))
  const symbols = (recent.map(h => h.content).join(' ').match(/[a-zA-Z][a-zA-Z0-9]{2,}/g) ?? []).slice(0, 6).join(', ')
  const mainTopic = recent.filter(h => h.role === 'user')[0]?.content?.replace(/```[\s\S]*?```/g,'').trim().slice(0,80) ?? 'general'
  const decisions = recent.filter(h => h.role === 'user' && /قررنا|decided|we.ll use/i.test(h.content)).map(h => h.content.slice(0,80)).slice(0,3)
  return { text: `${domain}: ${symbols || 'general'} — ${mainTopic}`.slice(0,200), decisions, generatedAt: Date.now() }
}

// ═══════════════════════════════════════════════════════════════
//  CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
//  SEMANTIC PATTERN
// ═══════════════════════════════════════════════════════════════

function buildSemanticPattern(anchors) {
  if (!anchors?.length) return null
  const has = a => anchors.includes(a)

  if (has('@repair_intent') && has('@failure') && has('@identity_layer'))
    return '[pattern: diagnose_auth_failure] [step: identify_root_cause → locate_auth_flow → apply_fix → verify]'
  if (has('@repair_intent') && has('@failure') && has('@data_store'))
    return '[pattern: diagnose_db_failure] [step: check_query → check_connection → check_schema → fix]'
  if (has('@repair_intent') && has('@failure'))
    return '[pattern: diagnose_then_fix] [step: identify_root_cause → isolate_issue → apply_targeted_fix]'
  if (has('@repair_intent') && has('@identity_layer'))
    return '[pattern: fix_auth] [step: review_auth_flow → identify_gap → patch_securely]'
  if (has('@repair_intent') && has('@interface_layer'))
    return '[pattern: fix_api] [step: trace_route → check_handler → fix_response]'
  if (has('@analysis_intent') && has('@data_store'))
    return '[pattern: analyze_db] [step: inspect_schema → check_queries → identify_bottlenecks]'
  if (has('@analysis_intent') && has('@identity_layer'))
    return '[pattern: audit_auth] [step: review_flow → check_vulnerabilities → suggest_improvements]'
  if (has('@build_intent') && has('@interface_layer'))
    return '[pattern: build_api] [step: define_contract → implement_handler → validate_response]'
  if (has('@build_intent') && has('@identity_layer'))
    return '[pattern: build_auth] [step: define_flow → implement_securely → test_edge_cases]'
  if (has('@analysis_intent'))
    return '[pattern: code_analysis] [step: understand_purpose → identify_issues → suggest_next]'
  if (has('@repair_intent'))
    return '[pattern: generic_fix] [step: locate_issue → apply_fix → verify]'
  if (has('@build_intent'))
    return '[pattern: generic_build] [step: plan → implement → validate]'
  if (has('@verify_intent'))
    return '[pattern: verify] [step: define_cases → test → report_results]'
  return null
}


// ═══════════════════════════════════════════════════════════════
//  DIRECTIVES BUILDER
// ═══════════════════════════════════════════════════════════════

function buildRoutingConstraints(anchors, fieldSignals) {
  const fs  = String(fieldSignals || '')
  const has = a => anchors.includes(a)
  const constraints = []

  if (fs.includes('#code') || fs.includes('#code_recall'))
    constraints.push('If code is provided → analyze it directly without asking for it again.')

  if (has('@analysis_intent') && !has('@repair_intent'))
    constraints.push('Output: concise findings — overview, key issues, recommendations. No full rewrite.')

  if (has('@repair_intent') && !fs.includes('#full_file'))
    constraints.push('Output: targeted fix only. Do not rewrite unrelated parts.')

  if (fs.includes('#full_file'))
    constraints.push('Output: complete working file. Include all code. No truncation.')

  if (has('@build_intent'))
    constraints.push('Output: structured implementation. Define contracts before code.')

  if (fs.includes('#continuity') || fs.includes('#followup'))
    constraints.push('Build on prior context. Do not repeat what was already addressed.')

  if (has('@repair_intent') || has('@build_intent')) {
    constraints.push('Always wrap code in fenced blocks with language tag — e.g. ```html ... ``` or ```javascript ... ```.')
    constraints.push('Use textContent or createElement instead of innerHTML when inserting user data.')
    constraints.push('Only claim a fix is applied if the actual code change is present in your output.')
    constraints.push('Do not mention improvements that are not reflected in the code you return.')
  }

  return constraints.length > 0 ? '[Routing Constraints]\n' + constraints.join('\n') : null
}

function buildDirectives(anchors, userIsArabic, fieldSignals) {
  const lang        = userIsArabic ? '[lang: Arabic]' : '[lang: same_as_user]'
  const pattern     = buildSemanticPattern(anchors)
  const signals     = fieldSignals ?? null
  const constraints = buildRoutingConstraints(anchors, fieldSignals)
  const fs          = String(fieldSignals || '')

  const parts = []
  const directivesPart = [lang, pattern].filter(Boolean).join('\n')
  if (directivesPart) parts.push('[Routing Directives]\n' + directivesPart)
  if (signals)        parts.push('[Routing Signals]\n' + signals)
  if (constraints)    parts.push(constraints)
  if (fs.includes('@depth.surface')) parts.push('concise')
  return parts.join('\n') || null
}

// ═══════════════════════════════════════════════════════════════
//  FIELD SIGNALS
// ═══════════════════════════════════════════════════════════════

function buildFieldSignals(sid, celfResult, cleanedText, codeBlocks, continuity, anchors = [], hasStoredCode = false) {
  const field  = celfResult.field ?? {}
  const novel  = field.noveltyPressure   ?? 0
  const coher  = field.semanticCoherence ?? 0
  const ground = field.semanticGrounding ?? 0
  const exec   = field.executionReadiness ?? 0
  const intent = field.intentPressure    ?? 0

  const ANCHOR_TO_INTENT = {
    '@repair_intent':   '@intent.fix',
    '@analysis_intent': '@intent.analyze',
    '@build_intent':    '@intent.build',
    '@verify_intent':   '@intent.review',
  }
  const ANCHOR_TO_SCOPE = {
    '@identity_layer':     '::backend/auth',
    '@data_store':         '::database',
    '@memory_layer':       '::backend/cache',
    '@interface_layer':    '::api/gateway',
    '@infra_layer':        '::infra',
    '@realtime_transport': '::backend/realtime',
  }
  const ANCHOR_TO_STATE = { '@failure': '?failure' }

  const INTENT_PRIORITY = ['@repair_intent', '@analysis_intent', '@build_intent', '@verify_intent']

  const weighted = []
  const add = (sig, w) => weighted.push({ text: sig, w })

  const primaryIntent = INTENT_PRIORITY.find(a => anchors.includes(a))
  if (primaryIntent && ANCHOR_TO_INTENT[primaryIntent]) add(ANCHOR_TO_INTENT[primaryIntent], 0.90)

  for (const a of anchors) {
    if (ANCHOR_TO_SCOPE[a])  add(ANCHOR_TO_SCOPE[a],  0.85)
    if (ANCHOR_TO_STATE[a])  add(ANCHOR_TO_STATE[a],  0.95)
  }

  if (/critical|قاتل|خطير|urgent|عاجل/i.test(cleanedText))               add('!critical', 1.00)
  if (/موقوف|blocked|cannot proceed/i.test(cleanedText))                   add('!blocked',  0.98)
  if (/كان يعمل|used to work|regression/i.test(cleanedText))               add('?regression', 0.90)
  if (/بطيء|slow|latency|performance|memory leak/i.test(cleanedText))     add('?performance', 0.90)
  if (/ثغرة|vulnerability|injection|xss|csrf/i.test(cleanedText))         add('?security', 0.92)
  if (/لماذا|why|warum/i.test(cleanedText))                                add('?causal', 0.60)
  if (/غامض|unclear|ambiguous|لا أفهم/i.test(cleanedText))                add('?ambiguous', 0.60)
  if (/رسم|diagram|chart|visualize/i.test(cleanedText))                   add('#diagram', 0.75)
  if (/اكتب.*اختبار|write.*test|generate.*test|test cases|أضف.*اختبار/i.test(cleanedText)) add('#tests', 0.75)
  if (/توثيق|documentation|docs|readme/i.test(cleanedText))               add('#docs', 0.75)
  if (/هذا.*الكود|ذلك.*الملف|this.*code|that.*function/i.test(cleanedText) && continuity > 0.30) add('#resolved_ref', 0.65)
  if (/مشروع|project|continuation/i.test(cleanedText) && continuity>0.50) add('#project_continuation', 0.80)
  if (/بالتفصيل|detailed|full|شامل|in depth/i.test(cleanedText))         add('@depth.technical', 0.70)
  if (/باختصار|brief|concise|بإيجاز/i.test(cleanedText))                 add('@depth.surface', 0.70)
  if (/خطوة|step by step|بالترتيب/i.test(cleanedText))                    add('step-by-step', 0.70)
  if (/خوارزم|algorithm|sort|search|complexity/i.test(cleanedText))       add('::analysis/algo', 0.75)
  if (/debug|trace|تتبع|يعمل.*لكن/i.test(cleanedText))                   add('::debug', 0.75)
  if (codeBlocks.length > 0)                                               add('#code', 0.80)
  if (hasStoredCode)                                                        add('#code_recall', 0.75)
  if (/أنزله|أعطني.*كامل|الكود.*كامل|full.*file|complete.*code|اعطني الكود|كامل.*نهائي/i.test(cleanedText)) add('#full_file', 0.92)

  // domain signal — يُضاف دائماً إذا ليس general
  const _dom = classifyDomain(cleanedText)
  if (_dom !== 'general') add(`::${_dom}`, 0.72)

  const state = _semanticState.get(sid) ?? {}
  if ((state.driftCount ?? 0) >= 2)                                        add('::reset', 0.85)
  if (novel > 0.70)                                                         add('explore', novel)
  if (continuity > 0.35)                                                    add('#continuity', continuity + coher + 0.3)
  if (continuity > 0.20 && (state.driftCount ?? 0) === 0)                  add('#followup', 0.60)

  const MAX_SIGNALS = 7
  const top = weighted
    .filter((s, i, arr) => arr.findIndex(x => x.text === s.text) === i)
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_SIGNALS)
    .map(s => s.text)

  return top.length ? top.join(' ') : null
}

// ═══════════════════════════════════════════════════════════════
//  TOKEN BUDGET
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
//  LLM CALLER
// ═══════════════════════════════════════════════════════════════

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
    ? 'continue exactly from where you stopped — complete the open code block, do not repeat what was already written'
    : 'continue exactly from where you stopped — do not repeat what was already written'
  const body     = buildClaudeBody(model, 4096, systemHint, [
    { role: 'user', content: currentText },
    { role: 'assistant', content: partialReply },
    { role: 'user', content: continuePrompt }
  ])
  const response = await fetchClaude(body, 30000)
  return await response.json()
}

// ═══════════════════════════════════════════════════════════════
//  STYLE
// ═══════════════════════════════════════════════════════════════

function setStyle(sid, style, ttl) { styleStore.set(sid, { style, ttl }) }
function getAndTickStyle(sid) {
  const entry = styleStore.get(sid)
  if (!entry) return null
  if (entry.ttl <= 0) { styleStore.delete(sid); return null }
  entry.ttl--
  return entry.style
}

// ═══════════════════════════════════════════════════════════════
//  SEMANTIC STATE
// ═══════════════════════════════════════════════════════════════

function getSemanticState(sid) {
  if (!_semanticState.has(sid)) {
    _semanticState.set(sid, { dominantDomain: 'general', driftCount: 0 })
  }
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

// ═══════════════════════════════════════════════════════════════
//  MAIN ROUTE
// ═══════════════════════════════════════════════════════════════

router.get('/process-text', (_req, res) => {
  res.json({ ok: true, status: 'online', engine: 'CELF_Engine_AI_V5', version: '11.0' })
})

router.post('/process-text', async (req, res) => {
  const {
    text = '', sessionId, history = [], image = null, imageMimeType = 'image/jpeg',
    capsuleContext = null, recoveredCode = null, sessionSummary = null,
  } = req.body

  const hasText  = typeof text  === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) return res.status(400).json({ error: 'missing_input' })
  if (!sessionId)            return res.status(400).json({ error: 'missing_session_id' })
  if (processingLock.has(sessionId)) return res.status(429).json({ error: 'request_in_progress', retry: true })
  processingLock.add(sessionId)

  const sid = sessionId

  try {
    // ── ① INPUT ─────────────────────────────────────────────────
    const rawText    = hasText && text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) + '\n\n[truncated]' : text
    const cleanedText = hasText ? cleanInput(rawText) : rawText
    const inputText   = cleanedText || '(image)'

    if (hasText) {
      const styleDetected = detectStyleInstruction(cleanedText)
      if (styleDetected) setStyle(sid, styleDetected.style, styleDetected.ttl)
    }
    const activeStyle  = getAndTickStyle(sid)
    const userIsArabic = /[\u0600-\u06FF]/.test(cleanedText || '')
    const wordCount    = cleanedText.trim().split(/\s+/).length
    const codeBlocks   = detectCodeBlocks(text || cleanedText)

    // ── ② VECTOR STORE ──────────────────────────────────────────
    const _storedVec = getVectorSync(inputText.toLowerCase().trim().slice(0, 100))
    if (!_storedVec) getVector(inputText.toLowerCase().trim().slice(0, 100)).catch(() => null)

    // ── ③ CELF ENGINE ────────────────────────────────────────────
    const processed = feed(sid, inputText)
    if (!processed.ok) return res.status(422).json({ error: processed.reason || 'processing_failed' })

    const engine         = getEngine(sid)
    const tValue         = processed.result.t
    const field          = processed.celfResult.field ?? {}
    const continuity     = field.continuity  ?? 0
    const questionVector = engine.semanticVector?.(cleanedText) ?? null

    storeSemanticEntry(sid, tValue, cleanedText.replace(/```[\s\S]*?```/g,'').replace(/\s{2,}/g,' ').trim())

    // ── ④ CONCEPT ANCHOR ─────────────────────────────────────────
    // نفصل سؤال المستخدم عن الكود قبل resolveConceptAnchors
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

    // ── ⑥ CODE CONTEXT ───────────────────────────────────────────
    if (codeBlocks.length > 0) {
      storeCodeContext(sid, codeBlocks, engine, tValue)
      codeSessionStore.set(sid, { active: true, ttl: 6 })
    } else {
      const cs = codeSessionStore.get(sid)
      if (cs?.active) { cs.ttl--; if (cs.ttl <= 0) cs.active = false }
    }

    if (!rawCodeStore.has(sid) && recoveredCode && typeof recoveredCode === 'string' && recoveredCode.length > 30) {
      storeCodeContext(sid, [recoveredCode], engine, tValue)
      codeSessionStore.set(sid, { active: true, ttl: 6 })
    }

    const hasStoredCode  = (rawCodeStore.get(sid) ?? []).length > 0
    const hasCode        = codeBlocks.length > 0 || hasStoredCode
    // إذا كود مخزن → أرسله دائماً بدون اعتماد على similarity
    const effectiveMatch = hasCode && questionVector
      ? retrieveRelevantCode(questionVector, cleanedText, sid, tValue)
      : null
    const codeRelated =
      /اصلح|أصلح|عدل|تعديل|حلل|تحليل|analyze|fix|edit|refactor|review|debug|ثغرة|خطأ|مشكلة|improve|update|check|اختبر|وضح|explain/i.test(questionOnly)
    const refRelated =
      hasStoredCode &&
      continuity > 0.20 &&
      /هذا|هذه|ذلك|هنا|السابق|الكود|الملف|يعني|معنى|اشرح|وضح|this|that|previous|above/i.test(questionOnly)
    const shouldAttachStoredCode =
      hasStoredCode && (codeBlocks.length > 0 || codeRelated || refRelated)
    const storedRaw = effectiveMatch?.raw
      ?? (shouldAttachStoredCode ? (rawCodeStore.get(sid) ?? []).at(-1)?.raw ?? null : null)

    // ── ⑤ FIELD SIGNALS ──────────────────────────────────────────
    const fieldSignals = buildFieldSignals(sid, processed.celfResult, questionOnly, codeBlocks, continuity, anchors, !!storedRaw)
    updateSemanticState(sid, classifyDomain(questionOnly || cleanedText))

    // ── ⑤.⑤ ALLOW CODE SUGGESTION ────────────────────────────────
    const activeDomainEarly = classifyDomain(questionOnly || cleanedText)
    const NON_CODE_DOMAINS  = new Set(['science','math','humanities','general'])
    const fs_sig            = String(fieldSignals || '')
    const hasCodeIntent     =
      anchors.some(a => ['@repair_intent','@build_intent'].includes(a)) ||
      /(@intent\.fix|@intent\.build|#code|#code_recall)/.test(fs_sig)
    const allowCodeSuggestion =
      !!storedRaw &&
      !NON_CODE_DOMAINS.has(activeDomainEarly) &&
      hasCodeIntent

    // ── ⑦ SESSION SUMMARY ────────────────────────────────────────
    if (!sessionSummaryStore.has(sid) && sessionSummary?.text) {
      sessionSummaryStore.set(sid, sessionSummary)
    }
    if (!resumeBootstrapped.has(sid) && (sessionSummary?.text || recoveredCode)) {
      const resumeText = [
        sessionSummary?.text ? `[session resumed] ${sessionSummary.text}` : null,
        recoveredCode ? `[code resumed] ${classifyDomain(recoveredCode)} code` : null
      ].filter(Boolean).join('\n')
      if (resumeText.trim()) { try { engine.process(resumeText, { sourceWeight: 0.65 }) } catch {} }
      resumeBootstrapped.add(sid)
    }
    const activeSummary = sessionSummaryStore.get(sid) ?? null

    // ── ⑧ CAPSULE CONTEXT ────────────────────────────────────────
    // ── ⑨ SYSTEM PROMPT ──────────────────────────────────────────
    const directives  = buildDirectives(anchors, userIsArabic, fieldSignals)
    const styleMap    = { concise:'Be concise.', detailed:'Be detailed.', arabic:'Respond in Arabic.', english:'Reply in English.', german:'Antworte auf Deutsch.' }
    const styleHint   = activeStyle && styleMap[activeStyle] ? styleMap[activeStyle] : null

    const systemParts = [directives, styleHint].filter(Boolean)
    if (activeSummary?.text) systemParts.unshift(`[session] ${activeSummary.text}`)

    const systemHint = systemParts.join('\n') || null

    // ── ⑩ MESSAGES ───────────────────────────────────────────────
    const filteredHistory = filterStyleInstructions(history)
    const activeDomain    = classifyDomain(questionOnly || cleanedText)
    const historyMessages = buildHistoryLayer(filteredHistory, continuity, sid, false, activeDomain)
    const recCode         = typeof recoveredCode === 'string' && recoveredCode.length > 30 ? recoveredCode.slice(0, RECOVERED_CODE_LIMIT) : null

    const questionText = storedRaw
      ? (questionOnly || 'تعامل مع الكود المرفق حسب طلب المستخدم.')
      : cleanedText

    const userContent = hasImage
      ? [{ type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } }, ...(hasText ? [{ type: 'text', text: questionText }] : [])]
      : questionText

    const messages = [
      ...(recCode && !storedRaw ? [{ role: 'user', content: recCode }] : []),
      ...(storedRaw ? [{ role: 'user', content: storedRaw }] : []),
      ...historyMessages,
      { role: 'user', content: userContent }
    ]

    // ── ⑪ LLM ────────────────────────────────────────────────────
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

    // ── ⑫ POST PROCESSOR ─────────────────────────────────────────
    let observerBox = null
    if (reply && !hasImage && tValue > 1 && wordCount > 2 && questionVector?.length) {
      try {
        observerBox = observe({ engine, questionText: cleanedText, questionVector, replyText: reply, noiseRemoved: false, lang: 'ar' })
        const currentDomain = classifyDomain(questionOnly || cleanedText)
        if (observerBox) { storeCapsule(sid, observerBox, cleanedText.slice(0,80), tValue, currentDomain); updateAnchors(sid, cleanedText.slice(0,80), 0.5, currentDomain) }
      } catch {}
    }

    // خزّن كود LLM فقط إذا كان full_file (كود كامل مولّد بطلب صريح)
    if (reply && fieldSignals?.includes('#full_file')) {
      const replyBlocks = detectCodeBlocks(reply)
      if (replyBlocks.length > 0 && replyBlocks[0].length > 200) {
        storeCodeContext(sid, replyBlocks, engine, tValue + 0.9)
        codeSessionStore.set(sid, { active: true, ttl: 6 })
      }
    }

    if (reply) {
      const replyCompressed = compressReplyForFeedback(reply)
      if (replyCompressed) { try { engine.process(replyCompressed, { sourceWeight: 0.25 }) } catch {} }
    }

    const msgCountAfter = (history?.length ?? 0) + 1
    let newSummary = null
    if (msgCountAfter % SUMMARY_INTERVAL === 0) {
      try {
        newSummary = await generateSessionSummary(sid, [...(history ?? []), { role: 'assistant', content: reply ?? '' }], engine)
        if (newSummary) sessionSummaryStore.set(sid, newSummary)
      } catch {}
    }

    const costUSD = parseFloat(((inputTokensTotal/1_000_000)*1.0 + (outputTokensTotal/1_000_000)*5.0).toFixed(6))
    metricsStore.set(sid, { sessionId: sid, inputTokens: inputTokensTotal, outputTokens: outputTokensTotal, costUSD, maxTokens, payloadSize, updatedAt: new Date().toISOString() })

    const vaultToSave = [...getEngine(sid).vault.values()].slice(-20).map(c => ({
      id: c.id, vector: Array.from(c.vector ?? []), text: c.text?.slice(0,200) ?? '', phase: c.phase ?? 'warmup', error: c.error ?? 0, theta: c.theta ?? 0, reinforcement: c.reinforcement ?? 0
    }))

    return res.json({
      reply,
      newSummary: newSummary ?? null,
      nextSuggestion: allowCodeSuggestion ? null : null,
      celfVault: vaultToSave,
      observer: observerBox,
      debug: {
        systemHint: systemHint ?? null,
        fieldSignals,
        anchors,
        continuity,
        allowCodeSuggestion,
        activeDomain: activeDomain ?? activeDomainEarly,
        phase: processed.celfResult.phase,
        msgCount: messages.length,
        hasCode,
        storedCode: !!storedRaw,
        maxTokens,
        model
      },
      metrics: {
        inputTokens: inputTokensTotal,
        outputTokens: outputTokensTotal,
        costUSD,
        maxTokens,
        model,
        payloadSize
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
  return res.json({ ok: true, sessionId: req.params.id, summary: sessions.get(req.params.id).getSummary?.() ?? {} })
})

router.get('/metrics/:id', (req, res) => {
  const m = metricsStore.get(req.params.id)
  if (!m) return res.status(404).json({ error: 'metrics_not_found' })
  return res.json(m)
})

router.delete('/session/:id', (req, res) => {
  const id = req.params.id
  sessions.delete(id); metricsStore.delete(id); semanticTextMaps.delete(id)
  styleStore.delete(id); processingLock.delete(id); _semanticState.delete(id)
  _fieldHistory.delete(id); _entityTracker.delete(id); rawCodeStore.delete(id)
  codeSessionStore.delete(id); resumeBootstrapped.delete(id); capsuleMemory.delete(id)
  anchorMemory.delete(id); sessionSummaryStore.delete(id)
  return res.json({ ok: true })
})

export { getEngine }
export default router
