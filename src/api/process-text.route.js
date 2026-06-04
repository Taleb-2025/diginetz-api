import express from 'express'
import { resolveConceptAnchors } from '../utils/concept-anchor.js'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse }             from '../utils/lightweight-parser.js'
import { build, cleanInput, filterStyleInstructions, detectStyleInstruction } from '../utils/context-builder.js'
import { observe }           from '../utils/celf-observer.js'
import { indexStore }        from './index-code.route.js'
import { getVectorSync, getVector } from '../utils/vector-store.js'

const router = express.Router()

// ═══════════════════════════════════════════════════════════════
//  1. CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MAX_SESSIONS            = 150
const MAX_INPUT_CHARS         = 40000
const MAX_TEXT_MAP            = 300
const DEDUP_JACCARD_THRESHOLD = 0.72
const SUMMARY_INTERVAL        = 8
const RECOVERED_CODE_LIMIT    = 14000

// ── Feature Flags ────────────────────────────────────────────────
// أولوية التثبيت: input→domain→contract→context→LLM→code flow
// ثم نفعّل Vorschlag بعد تثبيت routeConf و Domain/Contract/Context
const ENABLE_VORSCHLAG = false

const TECH_KEYWORDS = {
  frameworks: ['fastapi','django','flask','express','nestjs','react','vue','spring'],
  databases:  ['redis','postgresql','postgres','mysql','mongodb','sqlite','elasticsearch'],
  infra:      ['docker','railway','nginx','kubernetes','aws','gcp','azure','vercel'],
  concepts:   ['caching','pooling','rate limiting','authentication','websocket',
               'async','optimization','deployment','monitoring','scaling','latency',
               'performance','connection','middleware','routing','security']
}

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

const ENTITY_PATTERNS_LIST = [
  [/(?:function|دالة)\s+(\w+)/gi,                       'function'],
  [/(?:class|كلاس)\s+(\w+)/gi,                          'class'],
  [/(?:router|route)\s*\.\s*\w+\(['"]([\/\w-]+)['"]/gi, 'route'],
  [/(?:const|let|var)\s+(\w+)\s*=/g,                    'variable'],
  [/(?:middleware|وسيط)\s+(\w+)/gi,                     'middleware'],
  [/(?:endpoint|api)\s*[:\s]+([/\w-]+)/gi,              'endpoint'],
]

const SMART_FLOWS = {
  fix_flow: [
    { goal: 'إصلاح الثغرات الأمنية',      instruction: 'Fix XSS: replace innerHTML with createElement/textContent. Sanitize all user inputs.' },
    { goal: 'إضافة التحقق من المدخلات',   instruction: 'Add input validation: reject negative values, empty required fields, invalid types.' },
    { goal: 'إضافة حفظ البيانات',         instruction: 'Add localStorage save/load with try/catch error handling and success feedback.' }
  ],
  refactor_flow: [
    { goal: 'تحسين البنية',  instruction: 'Refactor code structure for clarity, separation of concerns, and maintainability.' },
    { goal: 'تحسين الأداء', instruction: 'Optimize performance: reduce redundant DOM queries, debounce events, cache selectors.' }
  ],
  build_flow: [
    { goal: 'بناء الهيكل الأساسي', instruction: 'Build the core HTML/CSS structure with semantic markup and accessible layout.' },
    { goal: 'إضافة الوظائف',       instruction: 'Add main JavaScript functionality with event handling and data management.' }
  ]
}

// ═══════════════════════════════════════════════════════════════
//  2. STATE STORES
// ═══════════════════════════════════════════════════════════════

const sessions            = new Map()
const metricsStore        = new Map()
const processingLock      = new Set()
const semanticTextMaps    = new Map()
const styleStore          = new Map()
const rawCodeStore        = new Map()
const codeSessionStore    = new Map()
const sessionSummaryStore = new Map()
const resumeBootstrapped  = new Set()
const capsuleMemory       = new Map()
const anchorMemory        = new Map()
const _semanticState      = new Map()
const _entityTracker      = new Map()
const _fieldHistory       = new Map()

// ═══════════════════════════════════════════════════════════════
//  3. UTILITIES
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
    /function\s+(\w+)/g,
    /class\s+(\w+)/g,
    /const\s+(\w+)\s*=/g,
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

function compressCodeSemantics(raw, symbols) {
  const domain  = classifyDomain(raw)
  const topSyms = symbols.slice(0, 6).join(', ')
  const lines   = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).length
  return `${domain} code: ${topSyms || 'general'} (~${lines} lines)`
}

// ═══════════════════════════════════════════════════════════════
//  4. ENGINE LAYER
// ═══════════════════════════════════════════════════════════════

function getEngine(sessionId) {
  if (sessions.has(sessionId)) {
    const e = sessions.get(sessionId); sessions.delete(sessionId); sessions.set(sessionId, e); return e
  }
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    sessions.delete(oldest); semanticTextMaps.delete(oldest); styleStore.delete(oldest)
  }
  const engine = new CELF_Engine_AI_V5({
    resolution: 120, ringCount: 3, cycle: 360,
    diffusionRate: 0.08, constraintRate: 0.12,
    attractorLimit: 8, historyLimit: 128, archiveLimit: 128, semanticMemoryLimit: 96
  })
  sessions.set(sessionId, engine)
  return engine
}

function feed(sessionId, text) {
  const signals = parse(text)
  if (!signals.valid) return { ok: false, reason: signals.reason ?? 'invalid_signals' }
  const engine      = getEngine(sessionId)
  const snapshot    = engine.process(text)
  const field       = snapshot.field        ?? {}
  const metrics     = snapshot.metrics      ?? {}
  const control     = snapshot.control      ?? {}
  const perturbation= snapshot.perturbation ?? {}
  const attractors  = snapshot.attractors   ?? []
  const coherence   = Number(field.coherence        ?? 0)
  const resonance   = Number(field.resonance         ?? 0)
  const confidence  = Number(field.semanticGrounding ?? 0)
  const intent      = mapIntent(snapshot)
  const passToLLM   = coherence > 0.15 || resonance > 0.20 || intent === 'greeting' || intent === 'emotional' || confidence < 0.4
  return { ok: true, passToLLM, signals, result: snapshot, celfResult: { phase: snapshot.phase, t: snapshot.t, field, metrics, control, perturbation, attractors } }
}

function storeSemanticEntry(sid, t, text) {
  const map        = semanticTextMaps.get(sid) ?? new Map()
  const compressed = semanticCompress(text, 15)
  if (!compressed) return
  const hash = semanticHash(compressed)
  for (const [, entry] of map) {
    if (entry.hash === hash) return
    if (jaccardSimilarity(entry.text, compressed) >= DEDUP_JACCARD_THRESHOLD) return
  }
  map.set(t, { hash, text: compressed })
  if (map.size > MAX_TEXT_MAP) map.delete(map.keys().next().value)
  semanticTextMaps.set(sid, map)
}

function detectCodeBlocks(text) {
  const blocks = []
  const fenced = /```(?:[a-zA-Z0-9_+-]*)?(?: |\n)([\s\S]*?)```/gi
  let match
  while ((match = fenced.exec(text)) !== null) { const code = match[1].trim(); if (code.length > 30) blocks.push(code) }
  if (blocks.length === 0) {
    const codeSignals = [
      /^(import|export|const|let|var|function|class|async)\s/m,
      /=>\s*\{/, /\bthis\.\w+\s*=/, /^\s{2,}(const|let|var|return|if|for)\s/m,
      /<(!DOCTYPE|html|head|body|div|script)/i
    ]
    if (codeSignals.filter(p => p.test(text)).length >= 2 && text.length > 50 && text.length < MAX_INPUT_CHARS) blocks.push(text)
  }
  return blocks
}

// ═══════════════════════════════════════════════════════════════
//  5. DOMAIN & INTENT
// ═══════════════════════════════════════════════════════════════

function classifyDomain(text) {
  if (!text || typeof text !== 'string') return 'general'
  const t = text.toLowerCase()
  if (/فلسف|نفس|مشاع|emotion|feel|love|fear|anxiety|philosophy|psycho|spiritua/i.test(t))          return 'emotional'
  if (/error|bug|crash|exception|debug|fix|مشكلة|خطأ|لا يعمل|fail|broken/i.test(t))                return 'debugging'
  if (/backend|express|fastapi|django|flask|nestjs|server|api|route|endpoint|middleware/i.test(t))   return 'backend'
  if (/frontend|react|vue|angular|html|css|dom|component|jsx|tsx|ui|ux|style|tailwind/i.test(t))    return 'frontend'
  if (/database|redis|postgres|mysql|mongodb|sqlite|sql|query|schema|migration|orm/i.test(t))        return 'database'
  if (/auth|jwt|token|oauth|session|cookie|bcrypt|password|login|signup|permission/i.test(t))        return 'security'
  if (/docker|railway|nginx|kubernetes|deploy|cloud|aws|gcp|azure|vercel|ci|cd/i.test(t))           return 'devops'
  if (/algorithm|complexity|sort|search|graph|tree|binary|dynamic|recursion|data.?struct/i.test(t))  return 'algorithms'
  if (/test|jest|mocha|cypress|spec|unit|integration|mock|coverage/i.test(t))                        return 'testing'
  if (/const|let|var|function|class|import|export|async|await|promise|callback|=>/.test(t) && t.length > 80) return 'code'
  return 'general'
}

function mapIntent(snapshot) {
  const s = snapshot?.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question)        return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error)           return 'complaint'
  if (s.emotional)       return 'emotional'
  return 'statement'
}

function detectTechnicalIntent(text) {
  return /تعديل|إصلاح|حلل|تحليل|أصلح|عدّل|احذف|أضف|استبدل|حسّن|اكتب|أعد|debug|fix|edit|rewrite|refactor|analyze|update|improve|replace|add|remove|correct|review|check/i.test(text)
}

function isStandaloneQuestion(cleanedText, wordCount, noveltyPressure, codeBlocks) {
  if (codeBlocks.length > 0) return false
  if (wordCount > 6)          return false
  if (noveltyPressure < 0.65) return false
  const greetings = /^(salam|salem|hallo|hello|hi|hey|مرحبا|السلام|هاي|اهلا|guten|مرحبأ|مساء|صباح|كيف|wie geht|bonjour)$/i
  if (greetings.test(cleanedText.trim())) return true
  if (noveltyPressure > 0.80 && wordCount <= 4) return true
  return false
}

function detectExplanationDepth(text) {
  const q         = _extractRequestOnly(text).toLowerCase()
  const technical = /xss|csrf|injection|sql injection|security|vulnerability|audit|performance|latency|memory leak|runtime|syntax|bug|error|crash|sanitize|validation|auth|jwt|token|cors|ثغرة|ثغرات|أمني|حماية|اختراق|تدقيق|أداء|خطأ|قاتل|critical|نقاط ضعف/i
  const surface   = /حلل|اشرح|شرح|ما هذا|ما هو|ماهو|ماذا يفعل|فهمني|explain|what is|what does|analyze this|describe/i
  if (technical.test(q)) return { signal: '@depth.technical', label: 'technical', weight: 0.95 }
  if (surface.test(q))   return { signal: '@depth.surface',   label: 'surface',   weight: 0.88 }
  return null
}

function _extractRequestOnly(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter(line => {
      const l = line.trim()
      if (!l) return false
      if (/^\s*(import|export|const|let|var|function|class|async|await|return|if|for|while|try|catch|router\.|app\.|<\/?|{|}|\)|;)/i.test(l)) return false
      if (/[{}<>;]/.test(l) && !/[\u0600-\u06FF]|what|why|how|explain|analy/i.test(l)) return false
      return true
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

// ═══════════════════════════════════════════════════════════════
//  6. SEMANTIC STATE
// ═══════════════════════════════════════════════════════════════

function getSemanticState(sid) {
  if (!_semanticState.has(sid)) {
    _semanticState.set(sid, { dominantDomain: 'general', candidateDomain: 'general', candidateCount: 0, driftCount: 0, domainWeights: {} })
  }
  return _semanticState.get(sid)
}

function updateSemanticState(sid, detectedDomain) {
  const state   = getSemanticState(sid)
  const DECAY   = 0.92
  const BOOST   = 0.28
  const weights = state.domainWeights
  for (const d of Object.keys(weights)) { weights[d] *= DECAY; if (weights[d] < 0.05) delete weights[d] }
  weights[detectedDomain] = Math.min(1.0, (weights[detectedDomain] ?? 0) + BOOST)
  if (detectedDomain !== state.dominantDomain && detectedDomain !== 'general') {
    state.driftCount++
    if (detectedDomain === state.candidateDomain) {
      state.candidateCount++
      if (state.candidateCount >= 3) { state.dominantDomain = detectedDomain; state.candidateCount = 0; state.driftCount = 0 }
    } else { state.candidateDomain = detectedDomain; state.candidateCount = 1 }
  } else if (detectedDomain === state.dominantDomain) {
    state.candidateCount = 0; state.driftCount = 0
  } else if (detectedDomain === 'general') {
    state.driftCount = Math.max(0, state.driftCount - 1)
  }
  return state
}

function extractEntities(text) {
  const found = []
  for (const [pat, type] of ENTITY_PATTERNS_LIST) {
    pat.lastIndex = 0
    let m
    while ((m = pat.exec(text)) !== null) { if (m[1] && m[1].length > 1) found.push({ name: m[1], type }) }
  }
  return found
}

function updateEntityTracker(sid, text, codeBlocks) {
  const store       = _entityTracker.get(sid) ?? { entities: [], primaryEntity: null }
  const now         = Date.now()
  const MAX_ENTITIES = 8
  const sources     = [text, ...codeBlocks]
  for (const src of sources) {
    for (const { name, type } of extractEntities(src)) {
      const existing = store.entities.find(e => e.name === name)
      if (existing) { existing.t = now; existing.count = (existing.count ?? 1) + 1 }
      else store.entities.push({ name, type, t: now, count: 1 })
    }
  }
  store.entities.sort((a, b) => b.t - a.t || b.count - a.count)
  if (store.entities.length > MAX_ENTITIES) store.entities = store.entities.slice(0, MAX_ENTITIES)
  store.primaryEntity = store.entities[0] ?? null
  _entityTracker.set(sid, store)
  return store
}

function resolveAmbiguity(cleanedText, sid) {
  const PRONOUN_PATTERN = /(?:^|[\s،.!?])(هو|هي|هذا|ذلك|it|this|that|he|she|they)(?:[\s،.!?]|$)/i
  if (!PRONOUN_PATTERN.test(cleanedText)) return cleanedText
  const store = _entityTracker.get(sid)
  if (!store?.primaryEntity) return cleanedText
  const age = (Date.now() - store.primaryEntity.t) / 1000 / 60
  if (age > 30) return cleanedText
  const refs = store.entities.slice(0, 3).map(e => `${e.name}(${e.type})`).join(', ')
  return cleanedText + ` [ref: ${refs}]`
}

function detectFieldShift(sid, currentVector, currentSnap, engine, continuity) {
  const prev = _fieldHistory.get(sid)
  if (!prev) { _fieldHistory.set(sid, { vector: currentVector, snap: currentSnap, t: Date.now() }); return false }
  const sim = prev.snap && currentSnap
    ? engine.fieldSimilarity(prev.snap, currentSnap)
    : engine.cosineSimilarity(prev.vector, currentVector)
  _fieldHistory.set(sid, { vector: currentVector, snap: currentSnap, t: Date.now() })
  if (sim < 0.22 && continuity > 0.45) return true
  return false
}

// ═══════════════════════════════════════════════════════════════
//  7. SIGNAL BUILDER
// ═══════════════════════════════════════════════════════════════

function resolveSemanticContext(cleanedText, anchors) {
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
  const ANCHOR_TO_STATE = {
    '@failure': '?failure',
  }
  const ANCHOR_TO_DOMAIN = {
    '@identity_layer':     'security',
    '@data_store':         'database',
    '@infra_layer':        'devops',
    '@realtime_transport': 'backend',
    '@interface_layer':    'backend',
    '@memory_layer':       'backend',
    '@failure':            'debugging',
    '@repair_intent':      'debugging',
    '@analysis_intent':    'code',
    '@build_intent':       'code',
    '@verify_intent':      'testing',
  }

  let intentSignal = null
  let scopeSignal  = null
  let stateSignal  = null
  let domain       = 'general'

  for (const a of anchors) {
    if (!intentSignal && ANCHOR_TO_INTENT[a]) intentSignal = ANCHOR_TO_INTENT[a]
    if (!scopeSignal  && ANCHOR_TO_SCOPE[a])  scopeSignal  = ANCHOR_TO_SCOPE[a]
    if (!stateSignal  && ANCHOR_TO_STATE[a])  stateSignal  = ANCHOR_TO_STATE[a]
    if (domain === 'general' && ANCHOR_TO_DOMAIN[a]) domain = ANCHOR_TO_DOMAIN[a]
  }

  const hasCausal      = /لماذا|why|warum|pourquoi/i.test(cleanedText)
  const hasDeepIntent  = /بالتفصيل|detailed|full|complete|شامل|in depth/i.test(cleanedText)
  const hasCritical    = /critical|قاتل|خطير|urgent|عاجل|production down/i.test(cleanedText)
  const hasBlocked     = /موقوف|blocked|cannot proceed|يمنعني|stuck/i.test(cleanedText)
  const hasRegression  = /كان يعمل|used to work|worked before|regression|توقف فجأة/i.test(cleanedText)
  const hasPerformance = /بطيء|slow|latency|timeout|performance|memory leak/i.test(cleanedText)
  const hasSecurity    = /ثغرة|vulnerability|exploit|injection|xss|csrf|insecure/i.test(cleanedText)
  const hasConcise     = /باختصار|brief|short|concise|بإيجاز/i.test(cleanedText)
  const hasStepByStep  = /خطوة|step by step|بالترتيب|sequentially/i.test(cleanedText)
  const hasDiagram     = /رسم|diagram|chart|visualize|خريطة/i.test(cleanedText)
  const hasTests       = /اختبار|test cases|spec|unit test/i.test(cleanedText)
  const hasDocs        = /توثيق|documentation|docs|readme/i.test(cleanedText)

  if (hasRegression  && !stateSignal) stateSignal = '?regression'
  if (hasPerformance && !stateSignal) stateSignal = '?performance'
  if (hasSecurity    && !stateSignal) stateSignal = '?security'

  const prioritySignal   = hasCritical ? '!critical' : hasBlocked ? '!blocked' : null
  const behaviorModifier = hasDeepIntent  ? 'depth'
    : hasConcise    ? 'concise'
    : hasStepByStep ? 'step-by-step'
    : null
  const contentSignal = hasDiagram ? '#diagram' : hasTests ? '#tests' : hasDocs ? '#docs' : null

  return {
    intentSignal,
    scopeSignal,
    stateSignal,
    prioritySignal,
    behaviorModifier,
    contentSignal,
    hasCausal,
    hasDeepIntent,
    domain,
  }
}

function _buildContextPath(domain, cleanedText) {
  const CONTEXT_MAP = {
    backend:    ['backend', null], frontend: ['frontend', null], database: ['database', null],
    security:   ['backend', 'auth'], devops: ['infra', null],   debugging: ['debug', null],
    algorithms: ['analysis', 'algo'], testing: ['debug', 'test'], code: ['code', null]
  }
  const [layer, sub] = CONTEXT_MAP[domain] ?? [null, null]
  if (!layer) return null
  let refined = sub
  if (/auth|jwt|token|oauth|session|login/i.test(cleanedText))           refined = 'auth'
  if (/cache|redis|buffer|queue/i.test(cleanedText))                      refined = 'cache'
  if (/websocket|socket|ws|realtime/i.test(cleanedText))                 refined = 'realtime'
  if (/performance|latency|timeout|slow|memory leak/i.test(cleanedText)) refined = 'performance'
  if (/flow|pipeline|middleware|handler/i.test(cleanedText))              refined = 'flow'
  return refined ? `::${layer}/${refined}` : `::${layer}`
}

function _buildIntentSignal(cleanedText, exec, intent) {
  if (/اصلح|fix|debug|أصلح|repair/i.test(cleanedText))                                         return '@intent.fix'
  if (/عدل|refactor|تعديل|improve|حسّن/i.test(cleanedText))                                    return '@intent.refactor'
  if (/حلل|analyze|review|audit|تحليل|weakness|issues|problems/i.test(cleanedText))            return '@intent.analyze'
  if (/أنشئ|أضف|create|build|generate|add|اكتب|write/i.test(cleanedText))                      return '@intent.build'
  if (/اشرح|explain|what is|ما هو|كيف يعمل/i.test(cleanedText))                                return '@intent.explain'
  if (exec > 0.65)                                                                               return '@intent.execute'
  if (intent > 0.60)                                                                             return '@intent.analyze'
  return null
}

function buildFieldSignals(sid, celfResult, cleanedText, codeBlocks, continuity, prevItem, resolvedEntity, editorMode = false, activeSummary = null, anchors = []) {
  const field  = celfResult.field ?? {}
  const exec   = field.executionReadiness ?? 0
  const intent = field.intentPressure    ?? 0
  const novel  = field.noveltyPressure   ?? 0
  const coher  = field.semanticCoherence ?? 0
  const ground = field.semanticGrounding ?? 0

  const semCtx       = anchors.length > 0 ? resolveSemanticContext(cleanedText, anchors) : null
  const detected     = semCtx?.domain ?? classifyDomain(cleanedText)
  const state        = updateSemanticState(sid, detected)
  const domainStable = state.driftCount === 0 && detected !== 'general'
  const hasFollowup  = (continuity > 0.42 || (prevItem?.score ?? 0) > 0.35) && (prevItem?.score ?? 0) > 0.26
  const _q           = cleanedText.replace(/```[\s\S]*?```/g,'').replace(/<[^>]{1,200}>/g,'').trim().slice(0,300)

  const intentSignal   = semCtx?.intentSignal    ?? _buildIntentSignal(_q || cleanedText, exec, intent)
  const scopeSignal    = semCtx?.scopeSignal      ?? (domainStable ? _buildContextPath(detected, cleanedText) : null)
  const stateSignal    = semCtx?.stateSignal      ?? (/خطأ|error|fail|crash|مشكلة|bug/i.test(cleanedText) ? '?failure' : null)
  const prioritySignal = semCtx?.prioritySignal   ?? (/critical|قاتل|خطير|urgent|عاجل/i.test(cleanedText) ? '!critical' : null)
  const behaviorMod    = semCtx?.behaviorModifier ?? null
  const contentSignal  = semCtx?.contentSignal    ?? null
  const hasCausal      = semCtx?.hasCausal        ?? /لماذا|why|warum/i.test(cleanedText)
  const hasDeepIntent  = semCtx?.hasDeepIntent    ?? /بالتفصيل|detailed|full|شامل/i.test(cleanedText)

  const weighted = []
  const add = (sig, w) => weighted.push({ text: sig, w })

  if (prioritySignal)                                                     add(prioritySignal, 1.00)
  if (stateSignal)                                                        add(stateSignal, 0.95)
  if (editorMode)                                                         add('#code_recall', 0.92)
  if (activeSummary?.decisions?.length > 0 && continuity > 0.30)        add('#project_continuation', 0.92)
  if (resolvedEntity)                                                     add('#resolved_ref', 0.88)
  if (scopeSignal)                                                        add(scopeSignal, domainStable ? 0.85 : 0.55)
  if (intentSignal)                                                       add(intentSignal, 0.80)
  if (continuity > 0.35 || (prevItem && continuity > 0.20))              add('#continuity', continuity + coher + 0.3)
  if (hasFollowup && prevItem?.score > 0.30)                             add('#followup', prevItem.score + 0.3)
  if (contentSignal)                                                      add(contentSignal, 0.75)
  if (codeBlocks.length > 0)                                             add('#code', 0.70)
  if (behaviorMod)                                                        add(behaviorMod, 0.70)
  if (hasCausal)                                                          add('?causal', 0.60)
  const depthSignal = detectExplanationDepth(_q || cleanedText)
  if (depthSignal?.signal && intentSignal !== '@intent.fix' && intentSignal !== '@intent.refactor' && intentSignal !== '@intent.build')
                                                                         add(depthSignal.signal, depthSignal.weight)
  if (hasDeepIntent)                                                      add('depth', intent + 0.2)
  if (novel > 0.70 && !hasFollowup)                                      add('explore', novel)
  if (state.driftCount >= 2)                                             add('::reset', 0.85)
  if (state.candidateCount < 1 && ground < 0.25 && continuity < 0.20)  add('?ambiguous', 0.40)

  const MAX_SIGNALS = 7
  const top = weighted.sort((a, b) => b.w - a.w).slice(0, MAX_SIGNALS).map(s => s.text)
  return { text: top.length ? top.join(' ') : null, state, domain: detected, anchors }
}

// ═══════════════════════════════════════════════════════════════
//  8. CODE MANAGER
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
    const summary       = compressCodeSemantics(raw, symbols)
    const codeVector    = engine.semanticVector(raw.slice(0, 2000))
    const summaryVector = engine.semanticVector(summary)
    contexts.push({
      id: `ctx_${tValue}_${hash.slice(0,6)}`, raw,
      codeVector, summaryVector, symbols, summary,
      domain: classifyDomain(raw), hash,
      createdAt: Date.now(), updatedAt: Date.now(), msgIndex: tValue
    })
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
    const codeSim     = questionVector && ctx.codeVector    ? engine_cosine(questionVector, ctx.codeVector)    : 0
    const summarySim  = questionVector && ctx.summaryVector ? engine_cosine(questionVector, ctx.summaryVector) : 0
    const symbolBoost = (ctx.symbols ?? []).filter(s => qLower.includes(s)).length * 0.12
    const msgAge      = Math.max(0, currentMsgIndex - ctx.msgIndex)
    const freshness   = Math.max(0, 1 - msgAge / 20)
    const rawScore    = codeSim * 0.55 + summarySim * 0.30 + Math.min(0.30, symbolBoost) * 0.15
    const finalScore  = rawScore * 0.85 + freshness * 0.15
    if (finalScore > bestScore) { bestScore = finalScore; best = { ctx, score: finalScore, symbolBoost } }
  }
  if (!best) return null
  const hasEditIntent = /اصلح|عدل|نقاط ضعف|review|fix|edit|refactor|analyze|debug|improve|حسّن/i.test(questionText)
  let threshold = 0.30
  if (best.symbolBoost > 0) threshold = 0.20
  if (hasEditIntent)        threshold -= 0.05
  return best.score >= threshold ? best.ctx : null
}

function decayChangedCapsules(engine, changedNodeIds, structIndex) {
  if (!engine || !changedNodeIds?.length || !structIndex) return
  for (const nodeId of changedNodeIds) {
    const node = structIndex.nodes.get(nodeId)
    if (!node?.vaultCapsuleId) continue
    const capsule = engine.vault?.get?.(node.vaultCapsuleId) ?? engine.getActiveCapsules?.().find(c => c.id === node.vaultCapsuleId)
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
  const classes   = nodes.filter(n => n.type === 'class').map(n => n.symbol)
  const methods   = nodes.filter(n => n.type === 'method' || n.type === 'function').sort((a, b) => (b.usedBy?.length ?? 0) - (a.usedBy?.length ?? 0)).slice(0, 6).map(n => n.symbol)
  const extDeps   = [...new Set(nodes.flatMap(n => n.imports ?? []).filter(i => !i.startsWith('.')))].slice(0, 4)
  const callChain = nodes.filter(n => n.calls?.length > 0).sort((a, b) => (b.usedBy?.length ?? 0) - (a.usedBy?.length ?? 0)).slice(0, 3).map(n => `${n.symbol} → ${n.calls.slice(0,2).join(', ')}`)
  return ['[code structure]',
    classes.length   ? `class: ${classes.join(', ')}`     : null,
    methods.length   ? `methods: ${methods.join(', ')}`   : null,
    extDeps.length   ? `external: ${extDeps.join(', ')}`  : null,
    callChain.length ? `flow: ${callChain.join(' | ')}`   : null,
    'analyze: practical usage and risks — not philosophy'
  ].filter(Boolean).join('\n')
}

// ═══════════════════════════════════════════════════════════════
//  9. COMPRESSION HELPERS
// ═══════════════════════════════════════════════════════════════

function extractCodePurpose(lang, surroundingText, codeContent) {
  const combined     = (surroundingText + ' ' + codeContent.slice(0, 300)).toLowerCase()
  const allTech      = [...TECH_KEYWORDS.frameworks, ...TECH_KEYWORDS.databases, ...TECH_KEYWORDS.infra]
  const foundTech    = allTech.filter(k => combined.includes(k)).slice(0, 2)
  const foundConcept = TECH_KEYWORDS.concepts.find(k => combined.includes(k))
  const declarations = codeContent.match(/(?:def|function|class|async def)\s+(\w+)/g) ?? []
  const funcNames    = declarations.slice(0, 2).map(d => d.split(/\s+/).at(-1))
  const parts = []
  if (lang && lang !== 'code') parts.push(lang)
  if (foundTech.length)        parts.push(foundTech.join('+'))
  if (foundConcept)            parts.push(foundConcept)
  if (funcNames.length && !foundTech.length) parts.push(funcNames.join(','))
  return parts.length > 1 ? `[${parts.join(': ')}]` : `[${lang || 'code'} implementation]`
}

function compressAssistantMessage(content) {
  if (typeof content !== 'string') return content
  const codeBlockPattern = /```(\w*)\n?([\s\S]*?)```/g
  const parts = []; let lastIndex = 0; let match
  codeBlockPattern.lastIndex = 0
  while ((match = codeBlockPattern.exec(content)) !== null) {
    const textBefore  = content.slice(lastIndex, match.index)
    const lang        = match[1]?.trim() || 'code'
    const codeContent = match[2] ?? ''
    if (textBefore.trim()) parts.push({ type: 'text', content: textBefore.trim() })
    parts.push({ type: 'label', content: extractCodePurpose(lang, textBefore, codeContent) })
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
  const hasCode = /```[\s\S]*?```/.test(content) || /export\s+class\s+\w+/.test(content) || /function\s+\w+\s*\(/.test(content)
  if (!hasCode) return content.slice(0, 400)
  const withoutCode = content.replace(/```[\s\S]*?```/g, '[code attached]').replace(/export\s+(class|function|const|default)\s+[\s\S]{0,50}/g, '[code attached]').replace(/\s{2,}/g, ' ').trim()
  return withoutCode.slice(0, 300) || '[code message]'
}

function compressReplyForFeedback(reply) {
  if (!reply || typeof reply !== 'string') return null
  return reply.replace(/```[\s\S]*?```/g, '[code]').replace(/\n{3,}/g, '\n\n').trim().slice(0, 400)
}

// ═══════════════════════════════════════════════════════════════
//  10. MEMORY LAYER
// ═══════════════════════════════════════════════════════════════

function storeCapsule(sid, observer, topicText, t) {
  if (!observer?.diagnostics) return
  const d = observer.diagnostics
  if (d.confidence === 'unknown') return
  const store = capsuleMemory.get(sid) ?? []
  store.push({ topic: topicText ?? 'general', covered: d.concepts?.filter(c => c.covered).map(c => c.label) ?? [], pending: d.concepts?.filter(c => !c.covered).map(c => c.label) ?? [], confidence: d.confidence, coverage: d.coverage, source: 'observer', lang: d.lang ?? 'en', t })
  if (store.length > 10) store.shift()
  capsuleMemory.set(sid, store)
}

function updateAnchors(sid, topicText, weight) {
  if (!topicText || weight < 0.3) return
  const store    = anchorMemory.get(sid) ?? []
  const existing = store.find(a => a.concept === topicText)
  if (existing) { existing.weight = Math.min(1, existing.weight * 0.9 + weight * 0.1) }
  else { store.push({ concept: topicText, weight, t: Date.now() }) }
  store.sort((a, b) => b.weight - a.weight)
  if (store.length > 5) store.pop()
  anchorMemory.set(sid, store)
}

async function generateSessionSummary(sid, history, engine) {
  if (!history || history.length < 4) return null
  const recent          = history.slice(-16)
  const assistantReplies = recent.filter(h => h.role === 'assistant').map(h => h.content.replace(/```[\s\S]*?```/g,'').replace(/\s{2,}/g,' ').trim().slice(0,120)).filter(Boolean)
  const userTopics      = recent.filter(h => h.role === 'user').map(h => h.content.replace(/```[\s\S]*?```/g,'').trim()).filter(Boolean)
  const domain          = classifyDomain(userTopics.join(' '))
  const codeWork        = recent.some(h => h.role === 'user' && /```|function|class|const|let|var/.test(h.content))
  const symbols         = (userTopics.join(' ') + ' ' + assistantReplies.join(' ')).match(/[a-zA-Z][a-zA-Z0-9]{2,}/g) ?? []
  const topSyms         = [...new Set(symbols)].slice(0, 6).join(', ')
  const mainTopic       = assistantReplies[0]?.slice(0, 100) ?? userTopics[0]?.slice(0, 80) ?? 'general conversation'
  const codeNote        = codeWork ? ' (with code)' : ''
  const text            = `${domain}${codeNote}: ${topSyms || 'general'} — ${mainTopic}`
  const DECISION_PATTERNS = [/قررنا|اخترنا|سنستخدم|decided|we.ll use|using/i, /لا نريد|لن نستخدم|avoid|don.t use|instead of/i]
  const decisions       = recent.filter(h => h.role === 'user' && DECISION_PATTERNS.some(p => p.test(h.content))).map(h => h.content.replace(/```[\s\S]*?```/g,'').trim().slice(0,80)).slice(0, 3)
  return { text: text.slice(0, 200), decisions, generatedAt: Date.now() }
}

// ═══════════════════════════════════════════════════════════════
//  11. CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════

function buildHistoryLayer(history, continuity, sid, needsRawCode = false, currentDomain = 'general') {
  const filtered = filterStyleInstructions(history)
  const clean    = filtered.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.length > 0)
  if (clean.length <= 4) return clean.map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : h.content }))
  const PASS_ALWAYS    = new Set(['general','emotional'])
  const domainFiltered = currentDomain === 'general' ? clean : clean.filter(h => { const d = classifyDomain(h.content); return PASS_ALWAYS.has(d) || d === currentDomain })
  const withFallback   = (f, minCount, fallback) => { if (f.length >= minCount) return f; const extra = fallback.filter(h => !f.includes(h)); return [...f, ...extra.slice(-(minCount - f.length))] }
  if (continuity >= 0.70) {
    const msgs = withFallback(domainFiltered.slice(-4), 2, clean.slice(-4))
    if (msgs.length < 1) return []
    return msgs.map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : needsRawCode ? h.content : compressUserMessage(h.content) }))
  }
  if (continuity >= 0.40) {
    const msgs      = withFallback(domainFiltered.slice(-4), 4, clean.slice(-6))
    const compressed = msgs.length >= 1 ? msgs.map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : needsRawCode ? h.content : compressUserMessage(h.content) })) : []
    return [...compressed, ...buildCapsuleContext(sid)]
  }
  if (continuity >= 0.20) return [...buildCapsuleContext(sid), ...buildAnchorContext(sid)]
  const fallbackMsgs = clean.slice(-4)
  if (fallbackMsgs.length >= 1) return fallbackMsgs.map(h => ({ role: h.role, content: h.role === 'assistant' ? compressAssistantMessage(h.content) : compressUserMessage(h.content) }))
  return buildFragmentContext(sid, history)
}

function buildCapsuleContext(sid) {
  const caps = capsuleMemory.get(sid) ?? []
  if (!caps.length) return []
  const lines = caps.slice(-3).map(c => { const parts = [`topic:${c.topic}`]; if (c.covered?.length) parts.push(`covered:${c.covered.slice(0,3).join(',')}`); if (c.pending?.length) parts.push(`pending:${c.pending.slice(0,2).join(',')}`); if (c.confidence) parts.push(`conf:${c.confidence}`); return parts.join(' | ') })
  return [{ role: 'user', content: `[memory]\n${lines.join('\n')}` }]
}

function buildAnchorContext(sid) {
  const anchors = anchorMemory.get(sid) ?? []
  if (!anchors.length) return []
  const top = anchors.slice(0, 3).map(a => `${a.concept}(${Math.round(a.weight*100)}%)`).join(', ')
  return [{ role: 'user', content: `[persistent topics: ${top}]` }]
}

function buildFragmentContext(sid, history) {
  const lastAssistant = [...history].reverse().find(h => h.role === 'assistant')
  if (!lastAssistant) return buildAnchorContext(sid)
  const fragment = compressAssistantMessage(lastAssistant.content).slice(0, 200)
  return [...buildAnchorContext(sid), { role: 'assistant', content: `[fragment] ${fragment}` }]
}

function evaluateCapsuleContext(engine, questionVector, capsuleContext, questionText) {
  if (!capsuleContext || !questionVector?.length) return { score: 0, used: false, reason: 'no_context' }
  const capsuleVector = engine.semanticVector?.(capsuleContext)
  if (!capsuleVector?.length) return { score: 0, used: false, reason: 'no_vector' }
  const semanticScore   = engine.cosineSimilarity(questionVector, capsuleVector)
  const fieldScore      = engine.fieldSimilarity({ vector: questionVector, attractors: engine.state.attractors, field: engine.field }, { vector: capsuleVector, attractors: [], field: { signature: 0 } })
  const blendedScore    = semanticScore * 0.70 + fieldScore * 0.30
  const tokenize        = t => t.toLowerCase().replace(/[،,.:;!?()[\]{}<>"']/g, ' ').split(/\s+/).filter(w => w.length > 3)
  const qTokens         = new Set(tokenize(questionText))
  const lexicalMatch    = tokenize(capsuleContext).filter(w => qTokens.has(w)).length
  const lexicalBonus    = Math.min(0.20, lexicalMatch * 0.07)
  const questionHasCode = /كود|error|function|class|fix|bug|خطأ|برمج|api|express|react|vue|angular|javascript|typescript/i.test(questionText)
  const capsuleHasCode  = /function|class|error|const|let|var|=>|import|export|express|react|vue|angular|app\.|get\(|post\(/i.test(capsuleContext)
  const codeBonus       = (questionHasCode && capsuleHasCode) ? 0.20 : 0
  const hasAnySignal    = lexicalMatch > 0 || codeBonus > 0 || blendedScore >= 0.40
  if (!hasAnySignal) return { score: semanticScore, used: false, reason: 'no_signal' }
  const finalScore = Math.min(1, blendedScore + codeBonus + lexicalBonus)
  const threshold  = questionHasCode ? 0.18 : 0.28
  const used       = finalScore >= threshold
  return { score: Math.round(finalScore * 1000) / 1000, semanticScore: Math.round(semanticScore * 1000) / 1000, codeBonus, lexicalBonus: Math.round(lexicalBonus * 1000) / 1000, used, threshold, reason: used ? 'relevant' : `below_threshold_${threshold}` }
}

function buildStateHint(phase, continuity) {
  if (!phase || phase === 'warmup') return null
  if (phase === 'drift' || continuity < 0.20) return '[mode: ground — answer directly, ignore prior context]'
  if (phase === 'turbulent')                  return '[mode: clarify — stay focused on current question]'
  if (phase === 'locked' && continuity > 0.70) return '[mode: continue — build on previous answers]'
  if (phase === 'emergent')                   return '[mode: explore — be comprehensive]'
  return null
}

function findPrevAnswer(filteredHistory, prevItem, lastTopicText) {
  const key = (prevItem?.text ?? lastTopicText ?? '').trim()
  if (!key || key.length < 5) return null
  const idx = filteredHistory.findIndex(h => h.role === 'user' && h.content.includes(key.slice(0, 40)))
  const ans = idx >= 0 ? filteredHistory[idx + 1] : null
  return ans?.role === 'assistant' ? ans.content.replace(/```[\s\S]*?```/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 120) : null
}

function buildMiniContext({ engine, frontendContext, capsuleEvalResult, vaultHit, codeHint, builtSystemHint, activeStyle, continuity, phase, fieldSignals, prevItem, lastTopicText, sessionSummary, filteredHistory, editorMode, wantsFullFile, userIsArabic = false, hasFixContract = false, hasCodeContext = false, fieldShifted = false, anchors = [] }) {
  const parts = []
  if (sessionSummary?.text && !fieldShifted) {
    const decStr = sessionSummary.decisions?.length ? '\n[decisions] ' + sessionSummary.decisions.slice(0,3).map(d=>d.slice(0,60)).join(' | ') : ''
    parts.push('[summary] ' + sessionSummary.text + decStr)
  }
  if (sessionSummary?.text && !wantsFullFile && !fieldShifted) parts.push('[session resumed]')
  if (editorMode && wantsFullFile) parts.push('[output: full_file] Return the complete modified file only. No explanations before or after.')
  const contract = hasFixContract ? null : buildAnalysisContract(fieldSignals, userIsArabic, { wantsFullFile, hasCodeContext }, anchors)
  if (contract) parts.push(contract)
  if (userIsArabic && !contract && !hasFixContract) parts.push('Respond in Arabic.')
  if (fieldSignals) parts.push(fieldSignals)
  const stateHint = buildStateHint(phase, continuity)
  if (stateHint) parts.push(stateHint)
  if (codeHint)   parts.push(codeHint)
  if (frontendContext && capsuleEvalResult?.score >= 0.50 && !fieldShifted) parts.push(`[memory]\n${frontendContext.slice(0, 300)}`)
  const prevAnswerText = findPrevAnswer(filteredHistory ?? [], prevItem, lastTopicText)
  const previousText   = prevAnswerText ? prevAnswerText.replace(/```[\s\S]*?```/g,'').replace(/<[^>]{1,200}>/g,'').replace(/#{1,6}\s*/g,'').replace(/\*{1,3}([^*]+)\*{1,3}/g,'$1').replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]|[0-9]\u{FE0F}\u{20E3}/gu,'').replace(/^[-•*]\s+/gm,'').replace(/\s{2,}/g,' ').trim().slice(0,120) : null
  const systemHasPrev  = (builtSystemHint ?? '').includes('[previously]')
  if (previousText && !systemHasPrev && !fieldShifted) parts.push(`[previously] ${previousText}`)
  if (vaultHit?.compressed && vaultHit?.score >= 0.55 && !systemHasPrev) {
    const vComp = vaultHit.compressed.slice(0, 50); const pText = previousText?.slice(0, 50) ?? ''
    if (vComp !== pText) parts.push(`[recall] ${vaultHit.compressed}`)
  }
  if (builtSystemHint) parts.push(builtSystemHint)
  const styleMap  = { concise:'أجب بإيجاز.', detailed:'أجب بتفصيل كامل.', arabic:'أجب باللغة العربية.', english:'Reply in English.', german:'Antworte auf Deutsch.' }
  const styleHint = activeStyle && styleMap[activeStyle] ? styleMap[activeStyle] : null
  const miniSoFar = parts.join('\n')
  if (styleHint && !miniSoFar.includes(styleHint)) parts.push(styleHint)
  const miniContext = parts.filter(Boolean).join('\n').trim() || null
  return { miniContext, tokenEstimate: Math.ceil((miniContext?.length ?? 0) / 4), layers: { state: !!stateHint, code: !!codeHint, memory: !!(frontendContext && capsuleEvalResult?.score >= 0.35), vault: !!(vaultHit?.score >= 0.45), context: !!builtSystemHint, style: !!activeStyle } }
}

// ═══════════════════════════════════════════════════════════════
//  12. CONTRACT BUILDER
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

function buildAnalysisContract(fieldSignals, userIsArabic, opts, anchors = []) {
  const fs = String(fieldSignals || '')

  if (opts?.wantsFullFile) return null

  const lang    = userIsArabic ? '[lang: Arabic]' : '[lang: same_as_user]'
  const pattern = buildSemanticPattern(anchors)

  const hasDeep    = fs.includes('depth')
  const hasConcise = fs.includes('concise')
  const hasFix     = fs.includes('@intent.fix') || fs.includes('@intent.refactor') || fs.includes('@intent.build')
  const hasExplain = fs.includes('@intent.explain') || fs.includes('@intent.review')
  const hasAnalyze = fs.includes('@intent.analyze')

  if (!opts?.hasCodeContext) {
    if (!hasExplain && !hasAnalyze) return null
    return [
      lang,
      pattern,
      '[task: knowledge_answer]',
      hasConcise ? '[depth: surface]' : '[depth: surface]',
      '[goal: direct useful answer]',
      '[avoid: unnecessary details, repetition]',
      '[shape: definition→brief_explanation]'
    ].filter(Boolean).join('\n')
  }

  if (hasDeep) return null
  if (!hasFix && !hasExplain && !hasAnalyze) return null

  if (hasFix)
    return [
      lang,
      pattern,
      '[task: code_modify][depth: technical]',
      '[goal: safe focused change]',
      '[avoid: unrelated redesign]',
      '[shape: change→reason→code]'
    ].filter(Boolean).join('\n')

  if (hasExplain)
    return [
      lang,
      pattern,
      '[task: explain_code][depth: surface]',
      '[goal: explain visible behavior and limits]',
      '[avoid: function walkthrough]',
      '[shape: what_it_does→how_it_works→practical_note]'
    ].filter(Boolean).join('\n')

  return [
    lang,
    pattern,
    '[task: code_analysis][depth: surface]',
    '[goal: explain purpose, risks, next action]',
    '[avoid: fixing code unless asked]',
    '[shape: purpose→issues→next_step]'
  ].filter(Boolean).join('\n')
}

function buildFixContract({ fieldSignals, userIsArabic, anchors = [] }) {
  const fs = String(fieldSignals || '')
  if (!fs.includes('@intent.fix')) return null
  const lang    = userIsArabic ? '[lang: Arabic]' : '[lang: same_as_user]'
  const pattern = buildSemanticPattern(anchors)
  return [lang, pattern, '[task: code_audit_then_fix][depth: technical][audience: developer]','[source: raw_code]','[goal: inspect current raw code, identify and fix concrete issues]','[avoid: previous analysis, old issues, redesign, unrelated changes]','[output: complete fixed and verified code]'].filter(Boolean).join('\n')
}

function computeHybridTokens({ surface, technical, modify, codeSize, inputWords, continuity, remaining, ceiling }) {
  const base     = modify ? 2000 : technical ? 1600 : surface ? 900 : 1200
  const codeMod  = codeSize < 2000 ? 0.8 : codeSize > 6000 ? 1.2 : 1.0
  const wordMod  = inputWords <= 5 ? 0.7 : inputWords > 15 ? 1.15 : 1.0
  const contMod  = continuity > 0.7 ? 0.9 : continuity < 0.3 ? 1.1 : 1.0
  const raw      = Math.round(base * codeMod * wordMod * contMod)
  const cap      = ceiling ?? Math.min(8000, Math.max(1000, Math.floor(remaining * 0.4)))
  return Math.min(cap, Math.max(800, raw))
}

// ═══════════════════════════════════════════════════════════════
//  13. VORSCHLAG ENGINE
// ═══════════════════════════════════════════════════════════════

function buildSuggestionLabel(mode, cleanedText, userIsArabic) {
  const q  = String(cleanedText || '').replace(/```[\s\S]*?```/g,' ').replace(/ما هو|ما هي|ما معنى|اشرح|شرح|حلل|تحليل|فسر|وضح|explain|what is|what are|analyze|describe/gi,'').replace(/[?؟!،,]/g,'').replace(/\s+/g,' ').trim().slice(0,36)
  if (!q) return null
  const ar  = userIsArabic
  const map = {
    technical_audit:   ar ? 'تدقيق تقني للكود'           : 'Technical code audit',
    fix_issues:        ar ? 'إصلاح المشاكل المكتشفة'      : 'Fix discovered issues',
    verify_fix:        ar ? 'التحقق من اكتمال الإصلاح'    : 'Verify the fix is complete',
    continue:          ar ? `تعمّق في: ${q}`               : `Go deeper: ${q}`,
    practical_example: ar ? `مثال على: ${q}`               : `Example: ${q}`,
    deepen_concept:    ar ? `أعمق في: ${q}`                : `Deeper on: ${q}`,
    apply_knowledge:   ar ? `تطبيق: ${q}`                  : `Apply: ${q}`,
  }
  return map[mode] || null
}

function buildQuestionSP({ fieldSignals, routeConf, continuity, reply, cleanedText, questionSimilarity, userIsArabic }) {
  const fs       = String(fieldSignals || '')
  const baseConf = Math.max(Number(routeConf || 0), Number(questionSimilarity || 0))
  if (baseConf < 0.55) return null
  const normalize = w => String(w).replace(/[\u064B-\u065F\u0670]/g,'').replace(/^ال/,'').replace(/[.,،;:!?؟]/g,'').toLowerCase()
  const stopWords = new Set('هذا هذه ذلك هو هي يعني بمعنى شرح اشرح ما ماذا كيف لماذا why what how the this that is are explain يستخدم يمكن في من على إلى عن أن مع أو also and or of to a an'.split(' '))
  const text      = String(reply || '').replace(/```[\s\S]*?```/g,' ').trim()
  const qWords    = new Set(String(cleanedText||'').replace(/[?؟!،.]/g,' ').split(/\s+/).map(normalize).filter(w=>w.length>2&&!stopWords.has(w)))
  const normWords = text.split(/\s+/).filter(w=>{const n=normalize(w);return n.length>3&&!qWords.has(n)&&!stopWords.has(n)&&!/^\d/.test(n)})
  const freq = {}; normWords.forEach(w=>{const k=normalize(w);freq[k]=(freq[k]||0)+1})
  const scored   = Object.entries(freq).map(([k,f])=>({k,score:f*k.length})).sort((a,b)=>b.score-a.score)
  const topSet   = new Set(scored.slice(0,5).map(x=>x.k))
  let topic = ''
  const sents = text.split(/[.؟!\n،]/).map(s=>s.trim()).filter(s=>s.length>8)
  for (const s of sents) { const found=s.split(/\s+/).filter(w=>topSet.has(normalize(w))); if(found.length>=2){topic=found.slice(0,2).join(' ').replace(/[.,،;:!?؟]/g,'').slice(0,30);break} }
  if (!topic && scored[0]) topic = scored[0].k.slice(0,30)
  if (!topic) topic = userIsArabic ? 'هذه النقطة' : 'this point'
  return { type:'normal_question', intent:fs.includes('@intent.explain')?'explain':fs.includes('@intent.analyze')?'analyze':'general', topic, depth:fs.includes('@depth.technical')?'technical':'surface', continuity:continuity>0.60?'high':continuity>0.35?'medium':'low', confidence:baseConf, replyLong:text.length>300, lang:userIsArabic?'Arabic':'other' }
}

function selectSuggestionFromSP(sp) {
  if (!sp || sp.confidence < 0.60) return null
  const ar = sp.lang === 'Arabic', t = sp.topic
  let s = null
  if (sp.intent==='explain' && sp.continuity==='low')  s={mode:'next_concept',   label:ar?`تابع: ${t}`:`Next: ${t}`,       text:ar?`ما هو ${t}؟`:`What is ${t}?`,                     confidence:sp.confidence}
  else if (sp.intent==='explain')                       s={mode:'deepen_concept', label:ar?`تعمّق في: ${t}`:`Deeper: ${t}`, text:ar?`اشرح ${t} بشكل أعمق`:`Explain ${t} in more depth`, confidence:sp.confidence*0.90}
  else if (sp.intent==='analyze')                       s={mode:'deepen_concept', label:ar?`تحليل: ${t}`:`Analyze: ${t}`,   text:ar?`حلّل ${t} بشكل أعمق`:`Analyze ${t} in more depth`,  confidence:sp.confidence*0.90}
  else if (sp.continuity==='high')                      s={mode:'apply_knowledge',label:ar?`تطبيق: ${t}`:`Apply: ${t}`,     text:ar?`كيف يُطبَّق ${t} عملياً؟`:`How is ${t} applied?`,   confidence:sp.confidence*0.85}
  else if (sp.intent==='general' && sp.continuity==='low') s={mode:'next_concept',label:ar?`تابع: ${t}`:`Next: ${t}`,      text:ar?`ما هو ${t}؟`:`What is ${t}?`,                     confidence:sp.confidence}
  else if (sp.replyLong)                                s={mode:'rephrase',       label:ar?`تبسيط: ${t}`:`Simplify: ${t}`,  text:ar?`اشرح ${t} بطريقة أبسط`:`Explain ${t} more simply`,  confidence:sp.confidence*0.80}
  if (!s || s.confidence < 0.60) return null
  s.strength = s.confidence >= 0.75 ? 'strong' : 'soft'
  return s
}

function buildNextSuggestion({ fieldSignals, routeConf, continuity, reply, questionSimilarity, userIsArabic, cleanedText }) {
  const fs      = String(fieldSignals || '')
  const text    = String(reply || '').replace(/```[\s\S]*?```/g,' ').trim()
  if (!text || text.length < 80) return null
  if (fs.includes('?ambiguous') || fs.includes('::reset') || fs.includes('?failure')) return null
  const baseConf = Math.max(Number(routeConf||0), Number(questionSimilarity||0))
  if (baseConf < 0.60) return null
  const isAr      = !!userIsArabic
  const hasCode   = fs.includes('#code') || fs.includes('#code_recall') || /function|class|const|let|var|import|export|<\/html>|<script/i.test(text)
  const isAnalyze = fs.includes('@intent.analyze')
  const isSurface = fs.includes('@depth.surface')
  const isTech    = fs.includes('@depth.technical')
  const isFix     = fs.includes('@intent.fix')
  const conf      = baseConf
  if (hasCode) {
    let s = null
    if (isAnalyze && isSurface)  s={mode:'technical_audit',label:isAr?'تدقيق تقني للكود':'Technical code audit',  text:isAr?'افحص الكود من ناحية الأمان والأداء':'Review this code for security and performance',confidence:conf}
    else if (isAnalyze||isTech)  s={mode:'fix_issues',      label:isAr?'إصلاح مشاكل الكود':'Fix code issues',      text:isAr?'أصلح هذه المشاكل في الكود':'Fix the issues in this code',                          confidence:conf}
    else if (isFix)              s={mode:'verify_fix',      label:isAr?'تحقق من الإصلاح':'Verify the fix',         text:isAr?'حلّل الكود مجدداً وتحقق من اكتمال الإصلاحات':'Analyze the code again and verify all fixes',confidence:conf*0.90}
    if (!s||s.confidence<0.60) return null
    s.strength=s.confidence>=0.75?'strong':'soft'
    return s
  }
  const sp = buildQuestionSP({ fieldSignals, routeConf, continuity, reply, cleanedText, questionSimilarity, userIsArabic })
  return selectSuggestionFromSP(sp)
}

// ═══════════════════════════════════════════════════════════════
//  14. LLM CALLER
// ═══════════════════════════════════════════════════════════════

function checkPayload(systemHint, messages) {
  const size = JSON.stringify({ system: systemHint, messages }).length
  if (size > 120000) throw new Error('prompt_too_large')
  return size
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

function buildClaudeBody(model, maxTokens, systemHint, messages) {
  const body = { model, max_tokens: maxTokens, messages }
  if (systemHint && String(systemHint).trim()) body.system = String(systemHint).trim()
  return body
}

function isTruncated(claudeData) { return claudeData?.stop_reason === 'max_tokens' }

function detectOpenCodeBlock(text) { return (text.match(/```/g) ?? []).length % 2 !== 0 }

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

async function continuationCall(currentText, partialReply, systemHint, timeoutMs = 30000, model = 'claude-haiku-4-5-20251001') {
  const hasOpenCode    = detectOpenCodeBlock(partialReply)
  const continuePrompt = hasOpenCode ? 'continue exactly from where you stopped — complete the open code block, do not repeat what was already written' : 'continue exactly from where you stopped — do not repeat what was already written'
  const body           = buildClaudeBody(model, 4096, systemHint, [{ role:'user', content:currentText }, { role:'assistant', content:partialReply }, { role:'user', content:continuePrompt }])
  const response       = await fetchClaude(body, timeoutMs)
  return await response.json()
}

// ═══════════════════════════════════════════════════════════════
//  15. SMART FLOW
// ═══════════════════════════════════════════════════════════════

function chooseSmartFlow(fieldSignals) {
  if ((fieldSignals||'').includes('@intent.refactor')) return 'refactor_flow'
  if ((fieldSignals||'').includes('@intent.build'))    return 'build_flow'
  return 'fix_flow'
}

function calcPhaseConfidence(reply, observerBox) {
  const obsConf = observerBox?.diagnostics?.confidence
  if (obsConf === 'high')   return 0.88
  if (obsConf === 'medium') return 0.72
  if (obsConf === 'low')    return 0.42
  if (!reply)               return 0.30
  const hasCode    = /```[\s\S]{100,}```/.test(reply) || /<!DOCTYPE|<html/i.test(reply)
  const hasUnclear = /unclear|unable|cannot|لا أستطيع|غير واضح/i.test(reply)
  return hasUnclear ? 0.40 : hasCode ? 0.78 : 0.62
}

// ═══════════════════════════════════════════════════════════════
//  16. ROUTES
// ═══════════════════════════════════════════════════════════════

function setStyle(sid, style, ttl) { styleStore.set(sid, { style, ttl }) }
function getAndTickStyle(sid) {
  const entry = styleStore.get(sid)
  if (!entry) return null
  if (entry.ttl <= 0) { styleStore.delete(sid); return null }
  entry.ttl--
  return entry.style
}
function calcRouteConfidence(routedContext) {
  if (!routedContext?.length) return 0
  const valid = routedContext.filter(i => i.score > 0.25 && i.text?.trim().length > 3)
  if (!valid.length) return 0
  return valid.reduce((s, i) => s + i.score, 0) / valid.length
}

router.get('/process-text', (_req, res) => {
  res.json({ ok: true, status: 'online', engine: 'CELF_Engine_AI_V5', llm: 'Claude Haiku 4.5', version: '10.9' })
})

router.post('/process-text', async (req, res) => {
  const {
    text = '', sessionId, history = [], image = null, imageMimeType = 'image/jpeg',
    savedCode = null, capsuleContext = null, recoveredCode = null, sessionSummary = null,
    sfPhase = null, sfFlowType = null, sfPrevCode = null, sfMaxPhases = 3,
    sfSingleCall = false, sfTargetedIssues = []
  } = req.body

  const hasText  = typeof text  === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) return res.status(400).json({ error: 'missing_input' })
  if (hasImage && image.length > 5_000_000) return res.status(413).json({ error: 'image_too_large' })
  if (!sessionId) return res.status(400).json({ error: 'missing_session_id' })

  const sid = sessionId
  if (processingLock.has(sid)) return res.status(429).json({ error: 'request_in_progress', retry: true })
  processingLock.add(sid)

  try {

    // ── sfSingleCall branch ──────────────────────────────────────
    if (sfSingleCall) {
      const _rawCode = sfPrevCode || recoveredCode || null
      if (!_rawCode) return res.status(400).json({ error: 'missing_code' })
      const _ft = sfFlowType || 'fix_flow'

      const SMART_FLOW_INPUT_LIMIT = 14000
      if (_rawCode.length > SMART_FLOW_INPUT_LIMIT && _ft !== 'targeted_fix') {
        return res.status(413).json({ error: 'code_too_large_for_smart_flow', message: 'الكود كبير جداً. استخدم Targeted Fix وحدد المشكلة المحددة.' })
      }

      if (_ft === 'targeted_fix' && Array.isArray(sfTargetedIssues) && sfTargetedIssues.length > 0) {
        const _issuesList = sfTargetedIssues.join('\n')
        const _tPrompt    = `Fix ONLY these specific issues in the code below. Do NOT change anything else. Return ONLY the complete fixed file.\n\nIssues to fix:\n${_issuesList}\n\nCode:\n${_rawCode.slice(0,14000)}`
        let tfCode = ''
        try {
          const _tfRes  = await fetchClaude(buildClaudeBody('claude-haiku-4-5-20251001', 7000, 'Return ONLY the complete modified file. No explanation.', [{ role:'user', content:_tPrompt }]))
          const _tfData = await _tfRes.json()
          tfCode = _tfData?.content?.[0]?.text?.trim() || ''
        } catch {}
        if (tfCode.length > 100) { try { storeCodeContext(sid, [tfCode], getEngine(sid), Date.now()) } catch {} }
        return res.json({ sfFinalCode: tfCode || null, sfTargetedFix: true, isSingleCall: true })
      }

      const FLOWS = {
        fix_flow: [
          { goal: 'إصلاح الثغرات الأمنية',      instruction: 'Fix XSS: replace innerHTML with createElement/textContent. Sanitize all user inputs.' },
          { goal: 'إضافة التحقق من المدخلات',    instruction: 'Add input validation: reject negative values, empty required fields, invalid types.' },
          { goal: 'إضافة حفظ البيانات',          instruction: 'Add localStorage save/load with try/catch error handling and success feedback.' }
        ],
        refactor_flow: [
          { goal: 'تحسين البنية',  instruction: 'Refactor code structure for clarity, separation of concerns, and maintainability.' },
          { goal: 'تحسين الأداء', instruction: 'Optimize performance: reduce redundant DOM queries, debounce events, cache selectors.' }
        ],
        build_flow: [
          { goal: 'بناء الهيكل الأساسي', instruction: 'Build the core HTML/CSS structure with semantic markup and accessible layout.' },
          { goal: 'إضافة الوظائف',       instruction: 'Add main JavaScript functionality with event handling and data management.' }
        ]
      }
      const phases      = FLOWS[_ft] || FLOWS.fix_flow
      const pTemplate   = phases.map(p => `{"goal":"${p.goal}","summary":"brief summary","confidence":0.85,"decision":"continue"}`).join(',')
      const pInstructions = phases.map((p,i) => `${i+1}. ${p.goal}: ${p.instruction}`).join('\n')
      const prompt = `Apply ALL improvements below to the code. Return your response in EXACTLY this format:\n---ANALYSIS---\n{"phases":[${pTemplate}]}\n---CODE---\n[complete modified file here, no markdown, no backticks]\n\nInstructions:\n${pInstructions}\n\nSet confidence 0.70–0.95 per phase. The ---CODE--- section must be the complete working file.\n\nCode to improve:\n${_rawCode.slice(0, 14000)}`
      const sfRes  = await fetchClaude(buildClaudeBody('claude-haiku-4-5-20251001', 8000, 'Follow the format exactly: ---ANALYSIS--- then JSON then ---CODE--- then the complete file.', [{ role:'user', content:prompt }]))
      const sfData = await sfRes.json()
      const rawTxt = sfData?.content?.[0]?.text?.trim() || ''

      let parsed = null
      const _delimCode = rawTxt.indexOf('---CODE---')
      const _delimAnal = rawTxt.indexOf('---ANALYSIS---')
      if (_delimCode > -1) {
        const _analysisSection = _delimAnal > -1 ? rawTxt.slice(_delimAnal + 14, _delimCode) : rawTxt.slice(0, _delimCode)
        const _codeSection     = rawTxt.slice(_delimCode + 10).trim()
        try {
          const _jsonMatch = _analysisSection.match(/\{[\s\S]*\}/)
          const _phases    = _jsonMatch ? JSON.parse(_jsonMatch[0]) : null
          if (_phases?.phases && _codeSection.length > 100) parsed = { phases: _phases.phases, finalCode: _codeSection }
        } catch {}
      }
      if (!parsed) {
        try { const _j=JSON.parse(rawTxt); if(_j?.phases&&_j?.finalCode) parsed=_j } catch {
          const m=rawTxt.match(/\{[\s\S]*\}/); if(m) try{ const _j=JSON.parse(m[0]); if(_j?.phases&&_j?.finalCode) parsed=_j }catch{}
        }
      }
      if (!parsed?.phases || !parsed?.finalCode) return res.status(500).json({ error: 'parse_failed' })

      const _isTruncated = code => { const t=code.trim(); if(/<!DOCTYPE|<html/i.test(t)) return !/<\/html>\s*$/i.test(t); return !(/[}>;]\s*$/.test(t)) }
      if (_isTruncated(parsed.finalCode)) {
        try {
          const _tail       = parsed.finalCode.slice(-1500)
          const _compPrompt = `You were generating a complete modified HTML file. The output was cut off mid-code.\n\nThe file ended at:\n...${_tail}\n\nContinue EXACTLY from where it was cut. Do NOT repeat any previous code.\nThe completed file must end with: </script>\n</body>\n</html>`
          const _cRes  = await fetchClaude(buildClaudeBody('claude-haiku-4-5-20251001', 5000, 'Continue the truncated code exactly. End with </script></body></html>.', [{ role:'user', content:_compPrompt }]))
          const _cData = await _cRes.json()
          const _cont  = _cData?.content?.[0]?.text?.trim() || ''
          if (_cont.length > 20) {
            parsed.finalCode = parsed.finalCode + '\n' + _cont
            if (_isTruncated(parsed.finalCode) && !parsed.finalCode.trim().endsWith('</html>')) parsed.finalCode += '\n</script>\n</body>\n</html>'
          }
        } catch {}
      }

      const _goals       = parsed.phases.map((p,i) => `${i+1}. ${p.goal||''}`)
      const _verifyPrompt = `You are verifying the final code after an automated fix flow.\nOriginal issues to verify:\n${_goals.join('\n')}\nCheck only:\n1. Are the original critical issues fixed?\n2. Is there any syntax/runtime-breaking error?\n3. Did the fix introduce a new major issue?\nReturn JSON only:\n{"verdict":"ok"|"minor_fix"|"major_issue"|"low_confidence","remaining":["..."],"confidence":0.0,"reason":"short reason"}`
      let sfVerify = { verdict:'low_confidence', remaining:[], confidence:0.5, reason:'verification unavailable' }
      try {
        const _vRes  = await fetchClaude(buildClaudeBody('claude-haiku-4-5-20251001', 800, 'Return ONLY valid JSON. No markdown. No preamble.', [{ role:'user', content:_verifyPrompt + '\n\nCode to verify (first 6000 chars):\n' + parsed.finalCode.slice(0,6000) }]))
        const _vData = await _vRes.json()
        const _vText = _vData?.content?.[0]?.text?.trim() || ''
        try { sfVerify = JSON.parse(_vText) } catch { const _m=_vText.match(/\{[\s\S]*\}/); if(_m) try{sfVerify=JSON.parse(_m[0])}catch{} }
      } catch {}

      if (sfVerify.verdict === 'ok') { try { storeCodeContext(sid, [parsed.finalCode], getEngine(sid), Date.now()) } catch {} }
      return res.json({ sfPhases: parsed.phases, sfFinalCode: parsed.finalCode, sfVerify, isSingleCall: true })
    }

    // ── Main branch ──────────────────────────────────────────────
    const rawText     = hasText && text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated ...]' : text
    const cleanedText  = hasText ? cleanInput(rawText) : rawText
    const noiseRemoved = hasText && cleanedText !== rawText
    const inputText    = cleanedText || '(image)'

    if (hasText) { const styleDetected = detectStyleInstruction(cleanedText); if (styleDetected) setStyle(sid, styleDetected.style, styleDetected.ttl) }
    const activeStyle = getAndTickStyle(sid)

    const savedVault = req.body.celfVault ?? []
    if (savedVault.length > 0) {
      const engine0 = getEngine(sid)
      for (const cap of savedVault) {
        if (cap.id && !engine0.vault.has(cap.id)) engine0.vault.set(cap.id, { ...cap, vector: cap.vector ? new Float32Array(cap.vector) : new Float32Array(64) })
      }
    }

    const _storedVec = getVectorSync(inputText.toLowerCase().trim().slice(0, 100))
    if (_storedVec) {
      try { getEngine(sid)._lastExternalVector = _storedVec } catch {}
    } else {
      getVector(inputText.toLowerCase().trim().slice(0, 100)).catch(() => null)
    }

    const processed = feed(sid, inputText)
    if (!processed.ok) return res.status(422).json({ error: processed.reason || 'processing_failed' })

    const tValue = processed.result.t
    const textForMemory = cleanedText.replace(/```[\s\S]*?```/g,'').replace(/^\s*export\s+class\s+\w+[\s\S]*$/m,'').replace(/^\s*function\s+\w+[\s\S]*$/m,'').replace(/\s{2,}/g,' ').trim()
    storeSemanticEntry(sid, tValue, textForMemory || inputText)

    const engine         = getEngine(sid)
    const questionVector = engine.semanticVector?.(cleanedText) ?? null
    console.log('CELF vector length:', questionVector?.length ?? 'NULL')

    const semanticMemory     = engine.field?.semanticMemory ?? []
    const prevVector         = semanticMemory.length >= 2 ? semanticMemory.at(-2)?.vector : null
    const questionSimilarity = (questionVector && prevVector) ? engine.cosineSimilarity(questionVector, prevVector) : null

    const textMap       = semanticTextMaps.get(sid)
    const userMsgs      = (history ?? []).filter(h => h.role === 'user')
    const prevUserMsg   = userMsgs.length >= 2 ? userMsgs[userMsgs.length - 2] : null
    const lastTopicText = textMap?.get(tValue - 1)?.text ?? prevUserMsg?.content?.split(/\s+/).slice(0,8).join(' ') ?? null

    const structIndex = indexStore?.get(sid) ?? null
    const codeBlocks  = detectCodeBlocks(text || cleanedText)
    let   codeHint    = null

    if (codeBlocks.length > 0 && structIndex) {
      const tempPath       = `session_inline/${sid}/msg_${tValue}.js`
      const changedNodeIds = getChangedNodeIds(structIndex, tempPath)
      const updateResult   = structIndex.updateFile(tempPath, codeBlocks.join('\n\n'))
      if (updateResult?.changed && changedNodeIds.length > 0) decayChangedCapsules(engine, changedNodeIds, structIndex)
      structIndex.injectSemanticVectors(engine)
      structIndex.injectIntoVault(engine)
      codeHint = buildCodeHint(structIndex)
      if (codeHint) {
        const codeMemory = codeHint.replace('[code structure]','').replace('analyze: practical usage and risks — not philosophy','').trim()
        if (codeMemory) storeSemanticEntry(sid, tValue + 0.5, codeMemory)
      }
    }

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

    if (!sessionSummaryStore.has(sid) && sessionSummary?.text) {
      sessionSummaryStore.set(sid, { text: sessionSummary.text, decisions: sessionSummary.decisions ?? [], generatedAt: sessionSummary.generatedAt ?? Date.now() })
    }
    if (!resumeBootstrapped.has(sid) && (sessionSummary?.text || recoveredCode)) {
      const resumeText = [
        sessionSummary?.text ? `[session resumed summary] ${sessionSummary.text}` : null,
        recoveredCode && typeof recoveredCode === 'string' && recoveredCode.length > 30 ? `[session resumed code] ${compressCodeSemantics(recoveredCode, extractSymbols(recoveredCode))}` : null
      ].filter(Boolean).join('\n')
      if (resumeText.trim()) { try { engine.process(resumeText, { sourceWeight: 0.65 }) } catch {} }
      resumeBootstrapped.add(sid)
    }

    const wordCount       = cleanedText.trim().split(/\s+/).length
    const entityRef       = updateEntityTracker(sid, cleanedText, codeBlocks)
    const noveltyPressure = processed.celfResult.field?.noveltyPressure ?? 0

    const historyHasCode    = (history ?? []).some(h => h.role === 'user' && detectCodeBlocks(h.content).length > 0)
    const hasCodeContext     = codeBlocks.length > 0 || historyHasCode
    const codeSession        = codeSessionStore.get(sid)
    const sessionActive      = codeSession?.active && codeSession?.ttl > 0
    const hasStoredContexts  = (rawCodeStore.get(sid) ?? []).length > 0
    if (hasStoredContexts && !codeSessionStore.has(sid)) codeSessionStore.set(sid, { active: true, ttl: 6 })

    const EDITOR_INTENT  = /اصلح|أصلح|اصلحه|أصلحه|عدل|عدله|أضف|أنشئ|اعطني|أعطني|اعرض|أعرض|أرني|حسّن|اكتب|تعديل|لديك|عندك|الأصلي|السابق|القديم|debug|improve|add|write|create|update|generate|show|give|fix|edit|refactor|original|previous/i
    const isEditorIntent = EDITOR_INTENT.test(cleanedText)
    const _stateForForce = _semanticState.get(sid)
    const forceEditor    = hasStoredContexts && isEditorIntent && (_stateForForce?.driftCount ?? 0) < 2
    const _codeReference = /كود|code|الكود|script|html|function|السابق|الأخير|برنامج/i.test(cleanedText)

    const matchedCode    = hasStoredContexts && questionVector && (isEditorIntent || _codeReference)
      ? retrieveRelevantCode(questionVector, cleanedText, sid, tValue) : null
    const effectiveMatch = matchedCode ?? (forceEditor ? (rawCodeStore.get(sid) ?? []).at(-1) ?? null : null)
    const needsRawCode   = !!effectiveMatch
    const _codeOnlyMsg   = codeBlocks.length > 0 && wordCount <= 4 ? 'Analyze this code: identify its purpose, structure, and any issues.' : null

    const rawRoute      = engine.routeContext(cleanedText, 5)
    const routeItems    = rawRoute?.items ?? []
    const vaultHit      = rawRoute?.vaultHit ?? null
    const routeConf     = calcRouteConfidence(routeItems)

    const built = build({ ok: true, signals: processed.signals, celfResult: processed.celfResult, passToLLM: processed.passToLLM, routedContext: vaultHit ? { items: routeItems, vaultHit } : routeItems, questionText: cleanedText, questionSimilarity, lastTopicText, activeStyle })
    if (built.blocked) return res.status(422).json({ blocked: true, reason: 'semantic_constraint' })
    if (!built.passToLLM && !hasImage) return res.json({ reply: null, skippedLLM: true, reason: 'weak_semantic_field' })

    const standalone = isStandaloneQuestion(cleanedText, wordCount, noveltyPressure, codeBlocks)

    let frontendContext   = null
    let capsuleEvalResult = { score: 0, used: false, reason: 'skipped' }
    if (!standalone && typeof capsuleContext === 'string' && capsuleContext.length > 0 && questionVector) {
      capsuleEvalResult = evaluateCapsuleContext(engine, questionVector, capsuleContext, cleanedText)
      if (capsuleEvalResult.used) frontendContext = capsuleContext
    }

    const continuity = standalone ? 0 : (built.context?.continuity ?? 0)

    const _prevForSig   = routeItems[0] ?? null
    const _resolvedEnt  = resolveAmbiguity(cleanedText, sid) !== cleanedText
    const editorMode    = !!effectiveMatch
    const storedSummaryCtx = sessionSummaryStore.get(sid) ?? null
    const activeSummary    = storedSummaryCtx ?? (sessionSummary ? { text: sessionSummary.text, decisions: sessionSummary.decisions ?? [] } : null)

    const { anchors: _anchors } = resolveConceptAnchors(cleanedText)
    const _fsResult     = buildFieldSignals(sid, processed.celfResult, cleanedText, codeBlocks, continuity, _prevForSig, _resolvedEnt, editorMode, activeSummary, _anchors)
    const fieldSignals  = _fsResult.text
    const semanticState = _fsResult.state
    const fieldShifted  = !standalone && questionVector ? detectFieldShift(sid, questionVector, processed.result, engine, continuity) : false
    const hardDrift          = semanticState?.driftCount >= 3
    const effectiveContinuity = (fieldShifted || hardDrift) ? 0 : continuity

    const _inputWords  = wordCount
    const _noMarkdown  = codeBlocks.length === 0 ? ' No markdown unless necessary. No bullet points. No bold text.' : ''
    const prevCodeFailed = hasCodeContext && (history ?? []).some(h => h.role === 'user' && /لا يعمل|لا يشتغل|not working|doesn't work|broken|crash|gives error/i.test(h.content))
    const _reflective  = prevCodeFailed ? 'Previous attempt had issues. Identify the root cause first, then provide a corrected solution.' : null

    const userContent  = hasImage ? [{ type:'image', source:{ type:'base64', media_type:imageMimeType, data:image } }, ...(hasText ? [{ type:'text', text:cleanedText }] : [])] : cleanedText
    const storedRaw    = effectiveMatch?.raw ?? null

    const _sfPhase      = Number.isInteger(sfPhase) && sfPhase >= 0 && sfPhase < 10 ? sfPhase : null
    const _sfDef        = _sfPhase !== null ? (SMART_FLOWS[sfFlowType ?? chooseSmartFlow(fieldSignals ?? '')] ?? SMART_FLOWS.fix_flow)[_sfPhase] : null
    const _isSfPhase    = _sfPhase !== null && !!_sfDef
    const _sfActiveCode = sfPrevCode || (recoveredCode && typeof recoveredCode === 'string' && recoveredCode.length > 30 ? recoveredCode : null) || storedRaw || null
    if (_isSfPhase && !_sfActiveCode) return res.status(400).json({ error: 'missing_code_for_smart_flow', phase: _sfPhase })

    const _prevItem       = routeItems[0] ?? null
    const _routedVault    = (editorMode || fieldShifted) ? null : vaultHit
    const _wantsFullFile  = /(ملف|الكود|html|الصفحة).*(كامل|نهائي)|اعطني الكود الكامل|أعطني الكود الكامل|أعد كتابة الملف|complete file|full html/i.test(cleanedText)
    const _hasAnalysisSignal = (fieldSignals||'').includes('@intent.analyze') || (fieldSignals||'').includes('@intent.explain') || (fieldSignals||'').includes('@depth.surface') || (fieldSignals||'').includes('@depth.technical')
    const _questionOnlyText  = cleanedText.replace(/```[\s\S]*?```/g,'').trim().slice(0,400)
    const _hasModifyIntent   = /اصلح|أصلح|عدل|عدّل|حسّن|اكتب|أعد كتابة|fix|edit|refactor|rewrite|modify|update/i.test(_questionOnlyText)
    const _analysisOnly      = _hasAnalysisSignal && !_hasModifyIntent && !_wantsFullFile
    const _briefAnalysis     = !_isSfPhase && _analysisOnly && !(fieldSignals||'').includes('>>depth')
    const _surfaceDepthHint  = (fieldSignals||'').includes('@depth.surface')
    const _technicalDepthHint= (fieldSignals||'').includes('@depth.technical')

    const conciseHint = _briefAnalysis ? 'Follow the contract. Be concise.'
      : codeBlocks.length > 0 ? 'Be thorough with code examples.'
      : _inputWords <= 5  ? 'Be concise and complete.' + _noMarkdown
      : _inputWords <= 15 ? 'Answer fully but without repetition.' + _noMarkdown
      : 'Be clear and complete.' + _noMarkdown

    const filteredHistory    = filterStyleInstructions(history)
    const _cleanedBuiltHint  = (built.systemHint ?? '').replace(/\[previously\][^\n]*/g,'').replace(/\n{2,}/g,'\n').trim() || null
    const userIsArabic       = /[\u0600-\u06FF]/.test(cleanedText || '')
    const promptEditorMode   = editorMode
    const spCodeContext      = codeBlocks.length > 0 || !!effectiveMatch || (fieldSignals||'').includes('#code') || (fieldSignals||'').includes('#code_recall')
    const fixContract        = spCodeContext ? buildFixContract({ fieldSignals, userIsArabic, anchors: _anchors }) : null

    const miniCtxResult = buildMiniContext({ engine, frontendContext: promptEditorMode ? null : frontendContext, capsuleEvalResult, vaultHit: _routedVault, codeHint, builtSystemHint: _cleanedBuiltHint, activeStyle, continuity: effectiveContinuity, phase: processed.celfResult.phase ?? 'warmup', fieldSignals, prevItem: _prevItem, lastTopicText: lastTopicText ?? null, sessionSummary: activeSummary, filteredHistory: filteredHistory ?? [], editorMode: promptEditorMode, wantsFullFile: _wantsFullFile, userIsArabic, hasFixContract: !!fixContract, hasCodeContext: spCodeContext, fieldShifted, anchors: _anchors })

    if (needsRawCode && !storedRaw && !codeBlocks.length) {
      return res.json({ reply:'أحتاج الكود الخام مرة أخرى — المتاح الآن ملخص فقط. أرسل الكود مجدداً.', codeRequired:true, celfVault:[], metrics:{ inputTokens:0, outputTokens:0, costUSD:0, maxTokens:0, model:'none' } })
    }

    const currentDomain = semanticState?.dominantDomain ?? classifyDomain(cleanedText)

    let historyMessages
    if (_isSfPhase && _sfActiveCode) {
      historyMessages = [{ role:'user', content:_sfActiveCode }]
    } else if (editorMode) {
      const lastAssistantPatch = [...filteredHistory].reverse().find(h => h.role==='assistant' && detectCodeBlocks(h.content).length>0)
      const rawMsg    = storedRaw ? { role:'user', content:storedRaw } : null
      const patchMsg  = lastAssistantPatch ? { role:'assistant', content:lastAssistantPatch.content.slice(0,1200) } : null
      historyMessages = [rawMsg, patchMsg].filter(Boolean)
    } else if (hasImage || standalone) {
      historyMessages = []
    } else {
      historyMessages = buildHistoryLayer(filteredHistory, effectiveContinuity, sid, false, currentDomain)
    }

    const recCode  = !_isSfPhase && typeof recoveredCode === 'string' && recoveredCode.length > 30 ? recoveredCode.slice(0, RECOVERED_CODE_LIMIT) : null
    const resolvedText = hasImage ? cleanedText : resolveAmbiguity(cleanedText, sid)

    const messages = [
      ...(recCode && !editorMode ? [{ role:'user', content:recCode }] : []),
      ...historyMessages,
      { role:'user', content: hasImage ? userContent : resolvedText }
    ]

    const _tldr = messages.length > 6 ? 'Be direct. Avoid restating context already known.' : null
    const _sfInstruction = _isSfPhase ? `[smart_flow phase ${_sfPhase+1}/${sfMaxPhases}] Goal: ${_sfDef.goal}\n${_sfDef.instruction}` : null
    const systemHint = _sfInstruction
      ? [_sfInstruction, conciseHint].filter(Boolean).join('\n')
      : [fixContract, miniCtxResult.miniContext, _codeOnlyMsg, _reflective, _tldr, conciseHint].filter(Boolean).join('\n') || null

    const inputEstimate = Math.ceil((systemHint?.length ?? 0) / 4 + JSON.stringify(messages).length / 4)
    const remaining     = Math.max(1000, 180000 - inputEstimate)
    const _fullFileRequest = editorMode && _wantsFullFile
    const _codeSize     = (storedRaw?.length ?? codeBlocks.join('').length)
    const maxTokens     = _isSfPhase
      ? ([5000,6000,7000][_sfPhase] ?? 7000)
      : _briefAnalysis
        ? computeHybridTokens({ surface:_surfaceDepthHint, technical:_technicalDepthHint, modify:false, codeSize:_codeSize, inputWords:_inputWords, continuity:effectiveContinuity, remaining, ceiling:_technicalDepthHint?2500:1400 })
        : fixContract ? Math.min(6000, Math.max(3000, Math.floor(remaining*0.45)))
        : _fullFileRequest ? Math.min(8000, Math.max(3000, Math.floor(remaining*0.50)))
        : codeBlocks.length > 0 ? Math.min(4000, Math.max(1000, Math.floor(remaining*0.4)))
        : _inputWords <= 5 ? 1000 : _inputWords <= 15 ? 1800 : 2500

    let payloadSize = 0
    try { payloadSize = checkPayload(systemHint, messages) } catch (e) { return res.status(413).json({ error:'prompt_too_large', detail:e.message }) }

    const model = 'claude-haiku-4-5-20251001'
    let claudeData, reply = null, inputTokensTotal = 0, outputTokensTotal = 0

    try {
      const claudeBody     = buildClaudeBody(model, maxTokens, systemHint, messages)
      console.log('=== TO LLM ===', JSON.stringify({ system:systemHint, msgCount:messages.length, maxTokens, standalone, needsRawCode, model }, null, 2))
      const claudeResponse = await fetchClaude(claudeBody)
      claudeData           = await claudeResponse.json()
      if (!claudeResponse.ok) throw new Error(`Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`)
      reply             = claudeData?.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n').trim() || null
      inputTokensTotal  = claudeData?.usage?.input_tokens  ?? 0
      outputTokensTotal = claudeData?.usage?.output_tokens ?? 0
      const MAX_CONTINUATIONS = 2; let continuationCount = 0
      while (reply && !_briefAnalysis && !_isSfPhase && isTruncated(claudeData) && continuationCount < MAX_CONTINUATIONS) {
        continuationCount++
        if (outputTokensTotal >= 4096) break
        const contData = await continuationCall(cleanedText, reply, systemHint, 30000, model)
        if (!contData?.content?.[0]?.text) break
        reply             += removeOverlap(reply, contData.content[0].text)
        inputTokensTotal  += contData?.usage?.input_tokens  ?? 0
        outputTokensTotal += contData?.usage?.output_tokens ?? 0
        claudeData         = contData
      }
    } catch (err) {
      if (err.name === 'AbortError') return res.status(504).json({ error:'claude_timeout' })
      throw err
    }

    const isFirstMsg = (tValue <= 1)
    const isTooShort = (_inputWords <= 2)
    const isCodeOnly = (codeBlocks.length > 0 && _inputWords <= 8)

    let observerBox = null
    if (reply && !hasImage && !isFirstMsg && !isTooShort && !isCodeOnly && questionVector?.length) {
      observerBox = observe({ engine, questionText:cleanedText, questionVector, replyText:reply, noiseRemoved, lang:processed.signals?.lang ?? 'en' })
      if (observerBox) { storeCapsule(sid, observerBox, lastTopicText, tValue); updateAnchors(sid, lastTopicText, questionSimilarity ?? 0.5) }
    }

    const msgCountAfter = (history?.length ?? 0) + 1
    let newSummary = null
    if (msgCountAfter > 0 && msgCountAfter % SUMMARY_INTERVAL === 0) {
      try {
        newSummary = await generateSessionSummary(sid, [...(history??[]), { role:'assistant', content:reply??'' }], engine)
        if (newSummary) sessionSummaryStore.set(sid, newSummary)
      } catch {}
    }

    if (reply && (needsRawCode || _isSfPhase)) {
      const replyBlocks = detectCodeBlocks(reply)
      if (replyBlocks.length > 0 && replyBlocks[0].length > 200) {
        storeCodeContext(sid, replyBlocks, engine, tValue + 0.9)
        codeSessionStore.set(sid, { active:true, ttl:6 })
        if (matchedCode) matchedCode.updatedAt = Date.now()
      }
    }

    let feedbackApplied = false, feedbackCoherence = null
    if (reply) {
      const replyCompressed = compressReplyForFeedback(reply)
      if (replyCompressed) {
        try { engine.process(replyCompressed, { sourceWeight:0.25 }); feedbackApplied=true; feedbackCoherence=engine.field?.semanticCoherence ?? null }
        catch (feedbackErr) { console.warn('[CELF feedback]', feedbackErr.message) }
      }
    }

    const costUSD = parseFloat(((inputTokensTotal/1_000_000)*1.0 + (outputTokensTotal/1_000_000)*5.0).toFixed(6))
    metricsStore.set(sid, { sessionId:sid, inputTokens:inputTokensTotal, outputTokens:outputTokensTotal, totalTokens:inputTokensTotal+outputTokensTotal, costUSD, maxTokens, payloadSize, routeConfidence:Math.round(routeConf*1000)/1000, continuity, phase:processed.celfResult.phase??'warmup', questionSimilarity:questionSimilarity!==null?Math.round(questionSimilarity*100)/100:null, activeStyle, noiseRemoved, feedbackApplied, feedbackCoherence, updatedAt:new Date().toISOString() })

    const vaultToSave = [...getEngine(sid).vault.values()].slice(-20).map(c=>({ id:c.id, vector:Array.from(c.vector??[]), text:c.text?.slice(0,200)??'', phase:c.phase??'warmup', error:c.error??0, theta:c.theta??0, reinforcement:c.reinforcement??0 }))

    const _sfConf     = _isSfPhase ? calcPhaseConfidence(reply, observerBox) : null
    const _sfDecision = _sfConf !== null ? (_sfConf >= 0.70 ? 'continue' : _sfConf >= 0.50 ? 'review' : 'stop') : null
    const smartFlowMeta = _isSfPhase ? { phase:_sfPhase, goal:_sfDef?.goal??'', confidence:_sfConf, decision:_sfDecision, stopReason:_sfDecision==='stop'?'low_confidence':null, flowType:sfFlowType??chooseSmartFlow(fieldSignals??''), maxPhases:sfMaxPhases } : null
    const nextSuggestion = ENABLE_VORSCHLAG
      ? buildNextSuggestion({ fieldSignals, routeConf, continuity, reply, questionSimilarity, userIsArabic, cleanedText })
      : null

    return res.json({
      newSummary: newSummary ?? null,
      smartFlowMeta,
      reply,
      nextSuggestion: nextSuggestion ?? null,
      celfVault: vaultToSave,
      observer: observerBox,
      debug: { systemHint:systemHint??null, hasFixContract:!!fixContract, messageCount:messages.length, historyCount:historyMessages.length, continuityTier:continuity>=0.70?'T1-full':continuity>=0.40?'T2-compressed+capsules':continuity>=0.20?'T3-capsules+anchors':'T4-fragments', capsules:(capsuleMemory.get(sid)??[]).length, anchors:(anchorMemory.get(sid)??[]).length, questionSimilarity:questionSimilarity!==null?Math.round(questionSimilarity*100)/100:null, activeStyle, lastTopicText, vaultHitUsed:!!vaultHit?.compressed, hasCapsuleCtx:!!frontendContext, feedbackApplied, feedbackCoherence, standalone, needsRawCode, editorMode, sessionActive, hasStoredContexts, matchedCodeId:effectiveMatch?.id??null, forcedEditor:forceEditor, recoveredCodeInjected:!!recCode, entityRef:entityRef?.primaryEntity?.name??null, entityCount:(entityRef?.entities??[]).length, historyHasCode, currentDomain, fieldSignals, fieldShifted, dominantDomain:semanticState?.dominantDomain, candidateDomain:semanticState?.candidateDomain, candidateCount:semanticState?.candidateCount, driftCount:semanticState?.driftCount, capsuleEval:{ score:capsuleEvalResult.score, used:capsuleEvalResult.used, reason:capsuleEvalResult.reason }, miniContext:{ tokenEstimate:miniCtxResult.tokenEstimate, layers:miniCtxResult.layers } },
      metrics: { inputTokens:inputTokensTotal, outputTokens:outputTokensTotal, totalTokens:inputTokensTotal+outputTokensTotal, costUSD, maxTokens, routeConfidence:Math.round(routeConf*1000)/1000, vaultHit:vaultHit?{ score:vaultHit.score, compressed:vaultHit.compressed }:null, model, inlineCode:codeBlocks.length>0, payloadSize, questionSimilarity:questionSimilarity!==null?Math.round(questionSimilarity*100)/100:null, activeStyle, styleTtlRemaining:styleStore.get(sid)?.ttl??0, noiseRemoved, truncated:hasText&&text.length>MAX_INPUT_CHARS, feedbackApplied, feedbackCoherence }
    })

  } catch (err) {
    console.error('[process-text] error:', err.message)
    return res.status(500).json({ error:'llm_failed', detail:err.message })
  } finally {
    processingLock.delete(sid)
  }
})

router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) return res.status(404).json({ error:'session_not_found' })
  const summary = sessions.get(req.params.id).getSummary?.() ?? {}
  return res.json({ ok:true, sessionId:req.params.id, summary })
})

router.get('/metrics/:id', (req, res) => {
  const m = metricsStore.get(req.params.id)
  if (!m) return res.status(404).json({ error:'metrics_not_found' })
  return res.json(m)
})

router.delete('/session/:id', (req, res) => {
  const id = req.params.id
  sessions.delete(id);            metricsStore.delete(id)
  semanticTextMaps.delete(id);    styleStore.delete(id)
  processingLock.delete(id);      _semanticState.delete(id)
  _fieldHistory.delete(id);       _entityTracker.delete(id)
  rawCodeStore.delete(id);        codeSessionStore.delete(id)
  resumeBootstrapped.delete(id);  capsuleMemory.delete(id)
  anchorMemory.delete(id);        sessionSummaryStore.delete(id)
  return res.json({ ok:true })
})

export { getEngine }
export default router
