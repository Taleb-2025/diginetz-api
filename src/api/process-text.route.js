// ═══════════════════════════════════════════════════════════════
//  process-text.route.js — v7.2
//  إصلاح: system لا يُرسل لـ Claude إذا كان null
// ═══════════════════════════════════════════════════════════════

import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse }             from '../utils/lightweight-parser.js'
import { build, cleanInput, filterStyleInstructions, detectStyleInstruction } from '../utils/context-builder.js'
import { observe }           from '../utils/celf-observer.js'
import { indexStore }        from './index-code.route.js'

const router = express.Router()

const MAX_SESSIONS    = 150
const MAX_INPUT_CHARS = 40000
const MAX_TEXT_MAP    = 300
const DEDUP_JACCARD_THRESHOLD = 0.72

const sessions         = new Map()
const metricsStore     = new Map()
const processingLock   = new Set()
const semanticTextMaps = new Map()
const styleStore       = new Map()

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

// ── Style TTL ────────────────────────────────────────────────────

function setStyle(sid, style, ttl) {
  styleStore.set(sid, { style, ttl })
}

function getAndTickStyle(sid) {
  const entry = styleStore.get(sid)
  if (!entry) return null
  if (entry.ttl <= 0) { styleStore.delete(sid); return null }
  entry.ttl--
  return entry.style
}

// ── أدوات مساعدة ────────────────────────────────────────────────

function semanticHash(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
  let h = 2166136261
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h  = Math.imul(h, 16777619)
  }
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
  return (setA.size + setB.size - overlap) > 0
    ? overlap / (setA.size + setB.size - overlap) : 0
}

function detectCodeBlocks(text) {
  const blocks = []
  const fenced = /```(?:js|javascript|ts|typescript|jsx|tsx)?\s*\n([\s\S]*?)```/gi
  let match
  while ((match = fenced.exec(text)) !== null) {
    const code = match[1].trim()
    if (code.length > 30) blocks.push(code)
  }
  if (blocks.length === 0) {
    const codeSignals = [
      /^(import|export|const|let|var|function|class|async)\s/m,
      /=>\s*\{/, /\bthis\.\w+\s*=/, /^\s{2,}(const|let|var|return|if|for)\s/m
    ]
    if (codeSignals.filter(p => p.test(text)).length >= 2 &&
        text.length > 50 && text.length < 20000)
      blocks.push(text)
  }
  return blocks
}

function getEngine(sessionId) {
  if (sessions.has(sessionId)) {
    const e = sessions.get(sessionId)
    sessions.delete(sessionId)
    sessions.set(sessionId, e)
    return e
  }
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    sessions.delete(oldest)
    semanticTextMaps.delete(oldest)
    styleStore.delete(oldest)
  }
  const engine = new CELF_Engine_AI_V5({
    resolution: 120, ringCount: 3, cycle: 360,
    diffusionRate: 0.08, constraintRate: 0.12,
    attractorLimit: 8, historyLimit: 128,
    archiveLimit: 128, semanticMemoryLimit: 96
  })
  sessions.set(sessionId, engine)
  return engine
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

function feed(sessionId, text) {
  const signals = parse(text)
  if (!signals.valid) return { ok: false, reason: signals.reason ?? 'invalid_signals' }

  const engine   = getEngine(sessionId)
  const snapshot = engine.process(text)

  const field        = snapshot.field        ?? {}
  const metrics      = snapshot.metrics      ?? {}
  const control      = snapshot.control      ?? {}
  const perturbation = snapshot.perturbation ?? {}
  const attractors   = snapshot.attractors   ?? []

  const coherence  = Number(field.coherence        ?? 0)
  const resonance  = Number(field.resonance         ?? 0)
  const confidence = Number(field.semanticGrounding ?? 0)
  const intent     = mapIntent(snapshot)

  const passToLLM =
    coherence  > 0.15 || resonance > 0.20 ||
    intent === 'greeting' || intent === 'emotional' ||
    confidence < 0.4

  return {
    ok: true, passToLLM, signals,
    result: snapshot,
    celfResult: { phase: snapshot.phase, t: snapshot.t, field, metrics, control, perturbation, attractors }
  }
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

function enrichRouteContext(rawRoute, sid) {
  const map = semanticTextMaps.get(sid) ?? new Map()
  return rawRoute.map(item => ({
    ...item,
    text: map.get(item.t)?.text ?? ''
  }))
}

function calcRouteConfidence(routedContext) {
  if (!routedContext?.length) return 0
  const valid = routedContext.filter(i => i.score > 0.25 && i.text?.trim().length > 3)
  if (!valid.length) return 0
  return valid.reduce((s, i) => s + i.score, 0) / valid.length
}

// ── نسيان الكبسولات المتغيرة ────────────────────────────────────
// عندما تتغير دالة → كبسولتها القديمة تتلاشى بسرعة
function decayChangedCapsules(engine, changedNodeIds, structIndex) {
  if (!engine || !changedNodeIds?.length || !structIndex) return

  for (const nodeId of changedNodeIds) {
    const node = structIndex.nodes.get(nodeId)
    if (!node?.vaultCapsuleId) continue

    // أوجد الكبسولة في الـ vault وخفّض وزنها
    const capsule = engine.vault?.get?.(node.vaultCapsuleId)
      ?? engine.getActiveCapsules?.().find(c => c.id === node.vaultCapsuleId)

    if (capsule && typeof capsule.weight === 'number') {
      capsule.weight = Math.max(0, capsule.weight * 0.25)  // نسيان سريع
    }

    // أزل الرابط لإجبار إعادة البناء
    node.vaultCapsuleId = null
    structIndex.capsuleLinks.delete(nodeId)
  }
}

// ── اكتشاف الـ nodes المتغيرة عند تحديث الكود ──────────────────
function getChangedNodeIds(structIndex, path) {
  const changedIds = []
  for (const [id, node] of structIndex.nodes.entries()) {
    if (!id.startsWith(path + '::')) continue
    // node موجود في المسار لكن وزن الكبسولة عالٍ → كان موجوداً قبل
    if (node.vaultCapsuleId) {
      changedIds.push(id)
    }
  }
  return changedIds
}

function buildCodeHint(structIndex) {
  if (!structIndex) return null
  const nodes = [...structIndex.nodes.values()]
  if (!nodes.length) return null

  const classes = nodes
    .filter(n => n.type === 'class')
    .map(n => n.symbol)

  const methods = nodes
    .filter(n => n.type === 'method' || n.type === 'function')
    .sort((a, b) => (b.usedBy?.length ?? 0) - (a.usedBy?.length ?? 0))
    .slice(0, 6)
    .map(n => n.symbol)

  const extDeps = [...new Set(
    nodes.flatMap(n => n.imports ?? [])
         .filter(i => !i.startsWith('.'))
  )].slice(0, 4)

  const callChain = nodes
    .filter(n => n.calls?.length > 0)
    .sort((a, b) => (b.usedBy?.length ?? 0) - (a.usedBy?.length ?? 0))
    .slice(0, 3)
    .map(n => `${n.symbol} → ${n.calls.slice(0,2).join(', ')}`)

  return [
    '[code structure]',
    classes.length   ? `class: ${classes.join(', ')}`         : null,
    methods.length   ? `methods: ${methods.join(', ')}`        : null,
    extDeps.length   ? `external: ${extDeps.join(', ')}`       : null,
    callChain.length ? `flow: ${callChain.join(' | ')}`        : null,
    'analyze: practical usage and risks — not philosophy'
  ].filter(Boolean).join('\n')
}

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
  const parts   = []
  let lastIndex = 0
  let match
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

// ══════════════════════════════════════════════════════════════
//  Soft Continuity Weighting — نظام ذاكرة متدرج
//
//  Tier 1  continuity >= 0.70  → تاريخ كامل (6 رسائل)
//  Tier 2  continuity 0.40-0.70 → مضغوط (3) + observer capsules
//  Tier 3  continuity 0.20-0.40 → capsules + persistent anchors
//  Tier 4  continuity < 0.20   → raw fragments + vault fallback
// ══════════════════════════════════════════════════════════════

// ── مخزن الكبسولات والـ anchors per session ──────────────────────
const capsuleMemory = new Map()  // sid → [{ topic, covered, missing, t }]
const anchorMemory  = new Map()  // sid → [{ concept, weight, t }]

// ── حفظ كبسولة من نتيجة Observer ─────────────────────────────────
function storeCapsule(sid, observer, topicText, t) {
  if (!observer?.diagnostics) return
  const d = observer.diagnostics
  if (d.confidence === 'unknown') return

  const store = capsuleMemory.get(sid) ?? []
  store.push({
    topic:   topicText ?? 'general',
    covered: observer.observations?.filter(o => o.includes('غطى') || o.includes('covered')) ?? [],
    missing: observer.nextQuestionHints?.map(h => h.replace(/.*"(.+)".*/,'$1')) ?? [],
    lang:    d.lang ?? 'en',
    t
  })
  if (store.length > 10) store.shift()
  capsuleMemory.set(sid, store)
}

// ── تحديث الـ Anchors من ECF أو CELF ─────────────────────────────
function updateAnchors(sid, topicText, weight) {
  if (!topicText || weight < 0.3) return
  const store = anchorMemory.get(sid) ?? []
  const existing = store.find(a => a.concept === topicText)
  if (existing) {
    existing.weight = Math.min(1, existing.weight * 0.9 + weight * 0.1)
  } else {
    store.push({ concept: topicText, weight, t: Date.now() })
  }
  store.sort((a, b) => b.weight - a.weight)
  if (store.length > 5) store.pop()
  anchorMemory.set(sid, store)
}

// ── بناء context message من الكبسولات ────────────────────────────
function buildCapsuleContext(sid) {
  const caps = capsuleMemory.get(sid) ?? []
  if (!caps.length) return []
  const recent = caps.slice(-3)
  const lines = recent.map(c => {
    const parts = [`[topic: ${c.topic}]`]
    if (c.covered?.length) parts.push(`covered: ${c.covered.slice(0,2).join(', ')}`)
    if (c.missing?.length) parts.push(`pending: ${c.missing.slice(0,2).join(', ')}`)
    return parts.join(' | ')
  })
  return [{ role: 'user', content: `[session context]\n${lines.join('\n')}` }]
}

// ── بناء context من الـ Anchors ───────────────────────────────────
function buildAnchorContext(sid) {
  const anchors = anchorMemory.get(sid) ?? []
  if (!anchors.length) return []
  const top = anchors.slice(0, 3).map(a => `${a.concept}(${Math.round(a.weight*100)}%)`).join(', ')
  return [{ role: 'user', content: `[persistent topics: ${top}]` }]
}

// ── raw fragments من آخر جواب ─────────────────────────────────────
function buildFragmentContext(sid, history) {
  const lastAssistant = [...history].reverse().find(h => h.role === 'assistant')
  if (!lastAssistant) return buildAnchorContext(sid)
  const fragment = compressAssistantMessage(lastAssistant.content).slice(0, 200)
  return [
    ...buildAnchorContext(sid),
    { role: 'assistant', content: `[fragment] ${fragment}` }
  ]
}

// ── buildHistoryLayer المتدرج ─────────────────────────────────────
function buildHistoryLayer(history, continuity, sid) {
  const filtered = filterStyleInstructions(history)
  const clean    = filtered.filter(h =>
    h && (h.role === 'user' || h.role === 'assistant') &&
    typeof h.content === 'string' && h.content.length > 0
  )

  // Tier 1: continuity عالٍ → تاريخ كامل
  if (continuity >= 0.70) {
    const msgs = clean.slice(-6)
    if (msgs.length < 2) return []
    return msgs.map(h => ({
      role:    h.role,
      content: h.role === 'assistant'
        ? compressAssistantMessage(h.content)
        : h.content.slice(0, 400)
    }))
  }

  // Tier 2: متوسط → مضغوط + capsules
  if (continuity >= 0.40) {
    const msgs = clean.slice(-3)
    const compressed = msgs.length >= 2 ? msgs.map(h => ({
      role:    h.role,
      content: h.role === 'assistant'
        ? compressAssistantMessage(h.content)
        : h.content.slice(0, 300)
    })) : []
    return [...compressed, ...buildCapsuleContext(sid)]
  }

  // Tier 3: منخفض → capsules + anchors
  if (continuity >= 0.20) {
    return [
      ...buildCapsuleContext(sid),
      ...buildAnchorContext(sid)
    ]
  }

  // Tier 4: منخفض جداً → fragments + vault fallback
  return buildFragmentContext(sid, history)
}

function checkPayload(systemHint, messages) {
  const size = JSON.stringify({ system: systemHint, messages }).length
  if (size > 80000) throw new Error('prompt_too_large')
  return size
}

// ✅ إصلاح: system لا يُرسل إذا كان null أو فارغ
async function fetchClaude(body, timeoutMs = 50000) {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body:   JSON.stringify(body),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

// ✅ بناء Claude body بدون system إذا كان null
function buildClaudeBody(model, maxTokens, systemHint, messages) {
  const body = { model, max_tokens: maxTokens, messages }
  if (systemHint && String(systemHint).trim()) {
    body.system = String(systemHint).trim()
  }
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
  const tail     = existing.slice(-checkLen * 2)
  const head     = continuation.slice(0, checkLen)
  for (let len = checkLen; len >= 20; len--) {
    const fragment = head.slice(0, len)
    if (tail.includes(fragment))
      return continuation.slice(continuation.indexOf(fragment) + fragment.length)
  }
  return continuation
}

async function continuationCall(currentText, partialReply, systemHint, timeoutMs = 30000, model = 'claude-haiku-4-5-20251001') {
  const hasOpenCode    = detectOpenCodeBlock(partialReply)
  const continuePrompt = hasOpenCode
    ? 'continue exactly from where you stopped — complete the open code block, do not repeat what was already written'
    : 'continue exactly from where you stopped — do not repeat what was already written'

  // ✅ إصلاح: system لا يُرسل إذا كان null
  const body = buildClaudeBody(model, 4096, systemHint, [
    { role: 'user',      content: currentText },
    { role: 'assistant', content: partialReply },
    { role: 'user',      content: continuePrompt }
  ])

  const response = await fetchClaude(body, timeoutMs)
  return await response.json()
}

// ── Routes ───────────────────────────────────────────────────────

router.get('/process-text', (_req, res) => {
  res.json({
    ok: true, status: 'online',
    engine: 'CELF_Engine_AI_V5',
    llm:    'Claude Haiku 4.5',
    version: '7.2'
  })
})

router.post('/process-text', async (req, res) => {
  const {
    text = '', sessionId, history = [],
    image = null, imageMimeType = 'image/jpeg'
  } = req.body

  const hasText  = typeof text  === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) return res.status(400).json({ error: 'missing_input' })
  if (hasImage && image.length > 5_000_000) return res.status(413).json({ error: 'image_too_large' })

  const sid = sessionId || 'default'
  if (processingLock.has(sid)) return res.status(429).json({ error: 'request_in_progress', retry: true })

  processingLock.add(sid)

  try {
    // ── تنظيف السؤال ─────────────────────────────────────────
    const rawText      = hasText && text.length > MAX_INPUT_CHARS
      ? text.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated ...]'
      : text
    const cleanedText  = hasText ? cleanInput(rawText) : rawText
    const noiseRemoved = hasText && cleanedText !== rawText
    const inputText    = cleanedText || '(image)'

    // ── Style TTL ─────────────────────────────────────────────
    if (hasText) {
      const styleDetected = detectStyleInstruction(cleanedText)
      if (styleDetected) setStyle(sid, styleDetected.style, styleDetected.ttl)
    }
    const activeStyle = getAndTickStyle(sid)

    // ── CELF ──────────────────────────────────────────────────
    const processed = feed(sid, inputText)
    if (!processed.ok) return res.status(422).json({ error: processed.reason || 'processing_failed' })

    const tValue = processed.result.t
    // ── تخزين ذكي: السؤال فقط بدون الكود الخام ─────────────────
    // الكود سيُخزَّن لاحقاً كـ codeHint بعد AST parsing
    const textForMemory = cleanedText
      .replace(/```[\s\S]*?```/g, '')     // احذف code blocks
      .replace(/^\s*export\s+class\s+\w+[\s\S]*$/m, '') // احذف inline class
      .replace(/^\s*function\s+\w+[\s\S]*$/m, '')        // احذف inline function
      .replace(/\s{2,}/g, ' ')
      .trim()
    storeSemanticEntry(sid, tValue, textForMemory || inputText)

    const engine      = getEngine(sid)
    const fieldPrompt = engine.buildFieldPrompt?.() ?? null

    // ── Similarity ────────────────────────────────────────────
    // engine.semanticVector() هو المسار الصحيح في CELF_Engine_AI_V5
    const questionVector = engine.semanticVector?.(cleanedText) ?? null
    console.log('CELF vector length:', questionVector?.length ?? 'NULL')
    const semanticMemory   = engine.field?.semanticMemory ?? []
    const prevVector       = semanticMemory.length >= 2 ? semanticMemory.at(-2)?.vector : null
    const questionSimilarity = (questionVector && prevVector)
      ? engine.cosineSimilarity(questionVector, prevVector)
      : null

    const textMap = semanticTextMaps.get(sid)

    // ── lastTopicText مع fallback من history ─────────────────
    // يستخدم السؤال السابق لا الحالي (الحالي آخر عنصر في history)
    const userMsgs    = (history ?? []).filter(h => h.role === 'user')
    const prevUserMsg = userMsgs.length >= 2
      ? userMsgs[userMsgs.length - 2]
      : null

    const lastTopicText =
      textMap?.get(tValue - 1)?.text
      ?? prevUserMsg?.content?.split(/\s+/).slice(0, 8).join(' ')
      ?? null

    // ── Inline Code ───────────────────────────────────────────
    const structIndex = indexStore?.get(sid) ?? null
    const codeBlocks  = detectCodeBlocks(cleanedText)
    let   codeHint    = null

    if (codeBlocks.length > 0 && structIndex) {
      const tempPath = `session_inline/${sid}/msg_${tValue}.js`

      // ── كشف النسخة السابقة قبل التحديث ──────────────────────
      const changedNodeIds = getChangedNodeIds(structIndex, tempPath)

      // ── تحديث AST بالكود الجديد ──────────────────────────────
      const updateResult = structIndex.updateFile(tempPath, codeBlocks.join('\n\n'))

      // ── نسيان الكبسولات المتغيرة ─────────────────────────────
      if (updateResult?.changed && changedNodeIds.length > 0) {
        decayChangedCapsules(engine, changedNodeIds, structIndex)
      }

      // ── بناء كبسولات جديدة من الكود المحدث ──────────────────
      structIndex.injectSemanticVectors(engine)
      structIndex.injectIntoVault(engine)

      // ── هيكل الكود للـ LLM ───────────────────────────────────
      codeHint = buildCodeHint(structIndex)

      // ── حدّث الذاكرة بالمعنى لا بالكود ──────────────────────
      // codeHint = وصف وظيفي → أفضل بكثير من الكود الخام
      if (codeHint) {
        const codeMemory = codeHint
          .replace('[code structure]', '')
          .replace('analyze: practical usage and risks — not philosophy', '')
          .trim()
        if (codeMemory) storeSemanticEntry(sid, tValue + 0.5, codeMemory)
      }
    }

    // ── Route Context ─────────────────────────────────────────
    const rawRoute      = engine.routeContext(cleanedText, 5)
    const routeItems    = Array.isArray(rawRoute) ? rawRoute : (rawRoute?.items ?? [])
    const vaultHit      = Array.isArray(rawRoute) ? null : (rawRoute?.vaultHit ?? null)
    const routedContext = enrichRouteContext(routeItems, sid)
    const routeConf     = calcRouteConfidence(routedContext)

    // ── Build Frame ───────────────────────────────────────────
    const built = build({
      ok:                true,
      signals:           processed.signals,
      celfResult:        processed.celfResult,
      passToLLM:         processed.passToLLM,
      routedContext:     vaultHit ? { items: routedContext, vaultHit } : routedContext,
      questionText:      cleanedText,    // ← للحكم على طول السؤال
      questionSimilarity,
      lastTopicText,
      activeStyle
    })

    if (built.blocked) return res.status(422).json({ blocked: true, reason: 'semantic_constraint' })
    if (!built.passToLLM && !hasImage) return res.json({ reply: null, skippedLLM: true, reason: 'weak_semantic_field' })

    // ── دمج codeHint مع systemHint ──────────────────────────
    const systemHint = [codeHint, built.systemHint]
      .filter(Boolean)
      .join('\n') || null
    const continuity = built.context?.continuity ?? 0
    const maxTokens  = 4096

    // ── Messages ──────────────────────────────────────────────
    const userContent     = hasImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } },
          ...(hasText ? [{ type: 'text', text: cleanedText }] : [])
        ]
      : cleanedText

    const filteredHistory = filterStyleInstructions(history)
    const historyMessages = hasImage ? [] : buildHistoryLayer(filteredHistory, continuity, sid)
    const messages        = [
      ...historyMessages,
      { role: 'user', content: hasImage ? userContent : cleanedText }
    ]

    let payloadSize = 0
    try {
      payloadSize = checkPayload(systemHint, messages)
    } catch (e) {
      return res.status(413).json({ error: 'prompt_too_large', detail: e.message })
    }

    const cogTarget = engine.buildCognitiveTarget?.(cleanedText, structIndex)
    const useDeep   = cogTarget?._meta?.deepAnalysis === true
    const model     = useDeep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'

    // ═══════════════════════════════════════════════════════════
    //  ✅ إصلاح: buildClaudeBody لا يُرسل system إذا كان null
    // ═══════════════════════════════════════════════════════════
    let claudeData
    let reply             = null
    let inputTokensTotal  = 0
    let outputTokensTotal = 0

    try {
      const claudeResponse = await fetchClaude(
        buildClaudeBody(model, maxTokens, systemHint, messages)
      )

      claudeData = await claudeResponse.json()

      if (!claudeResponse.ok)
        throw new Error(`Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`)

      reply             = claudeData?.content?.[0]?.text ?? null
      inputTokensTotal  = claudeData?.usage?.input_tokens  ?? 0
      outputTokensTotal = claudeData?.usage?.output_tokens ?? 0

      const MAX_CONTINUATIONS = 2
      let continuationCount   = 0
      while (reply && isTruncated(claudeData) && continuationCount < MAX_CONTINUATIONS) {
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
      if (err.name === 'AbortError') return res.status(504).json({ error: 'claude_timeout' })
      throw err
    }

    // ── Observer ──────────────────────────────────────────────
    let observerBox = null
    if (reply && !hasImage && questionVector?.length) {
      observerBox = observe({
        engine,
        questionText:   cleanedText,
        questionVector,
        replyText:      reply,
        noiseRemoved,
        lang:           processed.signals?.lang ?? 'en'
      })

      // ── تحويل Observer → Capsule + Anchor ────────────────────
      if (observerBox) {
        storeCapsule(sid, observerBox, lastTopicText, tValue)
        updateAnchors(sid, lastTopicText, questionSimilarity ?? 0.5)
      }
    }

    // ── Metrics ───────────────────────────────────────────────
    const costUSD = parseFloat(
      ((inputTokensTotal / 1_000_000) * 1.0 + (outputTokensTotal / 1_000_000) * 5.0).toFixed(6)
    )

    metricsStore.set(sid, {
      sessionId: sid,
      inputTokens: inputTokensTotal,
      outputTokens: outputTokensTotal,
      totalTokens: inputTokensTotal + outputTokensTotal,
      costUSD, maxTokens, payloadSize,
      routeConfidence:    Math.round(routeConf * 1000) / 1000,
      continuity,
      phase:              processed.celfResult.phase ?? 'warmup',
      questionSimilarity: questionSimilarity !== null ? Math.round(questionSimilarity * 100) / 100 : null,
      activeStyle,
      noiseRemoved,
      updatedAt:          new Date().toISOString()
    })

    return res.json({
      reply,
      observer: observerBox,

      debug: {
        systemHint,
        messageCount:       messages.length,
        historyCount:       historyMessages.length,
        continuityTier:     continuity >= 0.70 ? 'T1-full'
                          : continuity >= 0.40 ? 'T2-compressed+capsules'
                          : continuity >= 0.20 ? 'T3-capsules+anchors'
                          : 'T4-fragments',
        capsules:           (capsuleMemory.get(sid) ?? []).length,
        anchors:            (anchorMemory.get(sid)  ?? []).length,
        questionSimilarity: questionSimilarity !== null
          ? Math.round(questionSimilarity * 100) / 100
          : null,
        activeStyle,
        lastTopicText,
        vaultHitUsed:       !!vaultHit?.compressed
      },

      metrics: {
        inputTokens:        inputTokensTotal,
        outputTokens:       outputTokensTotal,
        totalTokens:        inputTokensTotal + outputTokensTotal,
        costUSD, maxTokens,
        routeConfidence:    Math.round(routeConf * 1000) / 1000,
        vaultHit:           vaultHit ? { score: vaultHit.score, compressed: vaultHit.compressed } : null,
        model,
        inlineCode:         codeBlocks.length > 0,
        payloadSize,
        questionSimilarity: questionSimilarity !== null ? Math.round(questionSimilarity * 100) / 100 : null,
        activeStyle,
        styleTtlRemaining:  styleStore.get(sid)?.ttl ?? 0,
        noiseRemoved,
        truncated:          hasText && text.length > MAX_INPUT_CHARS
      }
    })

  } catch (err) {
    console.error('[process-text] error:', err.message)
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  } finally {
    processingLock.delete(sid)
  }
})

// ── Session Endpoints ────────────────────────────────────────────

router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) return res.status(404).json({ error: 'session_not_found' })
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
  metricsStore.delete(req.params.id)
  semanticTextMaps.delete(req.params.id)
  styleStore.delete(req.params.id)
  processingLock.delete(req.params.id)
  return res.json({ ok: true })
})

export { getEngine }
export default router
