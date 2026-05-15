import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse } from '../utils/lightweight-parser.js'
import { build } from '../utils/context-builder.js'
import { analyze } from '../utils/response-analyzer.js'
import { indexStore } from './index-code.route.js'

const router = express.Router()

const MAX_SESSIONS    = 150
const MAX_INPUT_CHARS = 40000
const MAX_TEXT_MAP    = 300
const ROUTE_CONFIDENCE_THRESHOLD = 0.35
const DEDUP_JACCARD_THRESHOLD    = 0.72

const sessions         = new Map()
const metricsStore     = new Map()
const analysisStore    = new Map()
const processingLock   = new Set()
const semanticTextMaps = new Map()

const TECH_KEYWORDS = {
  frameworks: ['fastapi', 'django', 'flask', 'express', 'nestjs', 'react', 'vue', 'spring'],
  databases:  ['redis', 'postgresql', 'postgres', 'mysql', 'mongodb', 'sqlite', 'elasticsearch'],
  infra:      ['docker', 'railway', 'nginx', 'kubernetes', 'aws', 'gcp', 'azure', 'vercel'],
  concepts:   ['caching', 'pooling', 'rate limiting', 'authentication', 'websocket',
               'async', 'optimization', 'deployment', 'monitoring', 'scaling', 'latency',
               'performance', 'connection', 'middleware', 'routing', 'security']
}

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

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
  const union = setA.size + setB.size - overlap
  return union > 0 ? overlap / union : 0
}

// ── Inline Code Detection ──────────────────────────────────────
// يكتشف كود JS/TS في الرسالة — من code blocks أو كود مباشر
function detectCodeBlocks(text) {
  const blocks = []

  // 1. ```js / ```javascript / ```ts / ```typescript
  const fenced = /```(?:js|javascript|ts|typescript|jsx|tsx)?\s*\n([\s\S]*?)```/gi
  let match
  while ((match = fenced.exec(text)) !== null) {
    const code = match[1].trim()
    if (code.length > 30) blocks.push(code)
  }

  // 2. إذا لا توجد code blocks — تحقق إذا النص نفسه يبدو كوداً
  if (blocks.length === 0) {
    const codeSignals = [
      /^(import|export|const|let|var|function|class|async)\s/m,
      /=>\s*\{/,
      /\bthis\.\w+\s*=/,
      /^\s{2,}(const|let|var|return|if|for)\s/m
    ]
    const looksLikeCode = codeSignals.filter(p => p.test(text)).length >= 2
    if (looksLikeCode && text.length > 50 && text.length < 20000) {
      blocks.push(text)
    }
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
  return engine
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

  const engine   = getEngine(sessionId)
  const snapshot = engine.process(text)

  const field        = snapshot.field        ?? {}
  const metrics      = snapshot.metrics      ?? {}
  const control      = snapshot.control      ?? {}
  const perturbation = snapshot.perturbation ?? {}
  const attractors   = snapshot.attractors   ?? []

  const coherence  = Number(field.coherence         ?? 0)
  const resonance  = Number(field.resonance          ?? 0)
  const confidence = Number(field.semanticGrounding  ?? 0)
  const intent     = mapIntent(snapshot)

  const passToLLM =
    coherence  > 0.15 || resonance > 0.20 ||
    intent === 'greeting' || intent === 'emotional' ||
    confidence < 0.4

  return {
    ok: true,
    passToLLM,
    signals,
    result: snapshot,
    celfResult: {
      phase: snapshot.phase, t: snapshot.t,
      field, metrics, control, perturbation, attractors
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

  map.set(t, { hash, text: compressed })

  if (map.size > MAX_TEXT_MAP) {
    map.delete(map.keys().next().value)
  }

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

function extractCodePurpose(lang, surroundingText, codeContent) {
  const combined = (surroundingText + ' ' + codeContent.slice(0, 300)).toLowerCase()

  const allTech = [
    ...TECH_KEYWORDS.frameworks,
    ...TECH_KEYWORDS.databases,
    ...TECH_KEYWORDS.infra
  ]
  const foundTech    = allTech.filter(k => combined.includes(k)).slice(0, 2)
  const foundConcept = TECH_KEYWORDS.concepts.find(k => combined.includes(k))

  const declarations = codeContent.match(/(?:def|function|class|async def)\s+(\w+)/g) ?? []
  const funcNames    = declarations.slice(0, 2).map(d => d.split(/\s+/).at(-1))

  const parts = []
  if (lang && lang !== 'code') parts.push(lang)
  if (foundTech.length)        parts.push(foundTech.join('+'))
  if (foundConcept)            parts.push(foundConcept)
  if (funcNames.length && !foundTech.length) parts.push(funcNames.join(','))

  return parts.length > 1
    ? `[${parts.join(': ')}]`
    : `[${lang || 'code'} implementation]`
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

    if (textBefore.trim()) {
      parts.push({ type: 'text', content: textBefore.trim() })
    }

    parts.push({
      type:    'label',
      content: extractCodePurpose(lang, textBefore, codeContent)
    })

    lastIndex = match.index + match[0].length
  }

  const textAfter = content.slice(lastIndex).trim()
  if (textAfter) parts.push({ type: 'text', content: textAfter })

  if (!parts.length) return '[response provided]'

  const textParts  = parts.filter(p => p.type === 'text').map(p => p.content.slice(0, 200))
  const labelParts = parts.filter(p => p.type === 'label').map(p => p.content)

  return [textParts.join('\n').trim(), labelParts.join(', ')]
    .filter(Boolean).join('\n') || '[response provided]'
}

function getLastExchange(history) {
  if (!Array.isArray(history) || history.length < 2) return null

  const clean = history.filter(h =>
    h && (h.role === 'user' || h.role === 'assistant') &&
    typeof h.content === 'string' && h.content.length > 0
  )

  const last = clean.slice(-2)
  if (last[0]?.role === 'user' && last[1]?.role === 'assistant') {
    return { userMsg: last[0].content, assistantMsg: last[1].content }
  }

  return null
}

function buildMessageContext(currentText, routedContext, lastExchange, continuity, intent) {
  if (intent === 'greeting' || intent === 'emotional') {
    return [{ role: 'user', content: currentText }]
  }

  const routeConf = calcRouteConfidence(routedContext)

  if (routeConf >= ROUTE_CONFIDENCE_THRESHOLD) {
    return [{ role: 'user', content: currentText }]
  }

  if (continuity > 0.65 && lastExchange) {
    const compressedAssistant = compressAssistantMessage(lastExchange.assistantMsg)
    return [
      { role: 'user',      content: lastExchange.userMsg.slice(0, 300) },
      { role: 'assistant', content: compressedAssistant },
      { role: 'user',      content: currentText }
    ]
  }

  return [{ role: 'user', content: currentText }]
}

function checkPayload(systemHint, messages) {
  const size = JSON.stringify({ system: systemHint, messages }).length
  if (size > 80000) throw new Error('prompt_too_large')
  return size
}

async function fetchClaude(body, timeoutMs = 30000) {
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

function isTruncated(claudeData) {
  return claudeData?.stop_reason === 'max_tokens'
}

function detectOpenCodeBlock(text) {
  const fences = (text.match(/```/g) ?? []).length
  return fences % 2 !== 0
}

function removeOverlap(existing, continuation) {
  const checkLen = Math.min(120, continuation.length)
  const tail     = existing.slice(-checkLen * 2)
  const head     = continuation.slice(0, checkLen)

  for (let len = checkLen; len >= 20; len--) {
    const fragment = head.slice(0, len)
    if (tail.includes(fragment)) {
      return continuation.slice(continuation.indexOf(fragment) + fragment.length)
    }
  }

  return continuation
}

async function continuationCall(currentText, partialReply, systemHint, timeoutMs = 30000, model = 'claude-haiku-4-5-20251001') {
  const hasOpenCode = detectOpenCodeBlock(partialReply)

  const continuePrompt = hasOpenCode
    ? 'continue exactly from where you stopped — complete the open code block, do not repeat what was already written'
    : 'continue exactly from where you stopped — do not repeat what was already written'

  const response = await fetchClaude({
    model,
    max_tokens: 4096,
    system:     systemHint,
    messages: [
      { role: 'user',      content: currentText },
      { role: 'assistant', content: partialReply },
      { role: 'user',      content: continuePrompt }
    ]
  }, timeoutMs)

  return await response.json()
}

router.get('/process-text', (_req, res) => {
  res.json({
    ok:      true,
    status:  'online',
    engine:  'CELF_Engine_AI_V5',
    llm:     'Claude Haiku 4.5',
    version: '5.9'
  })
})

router.post('/process-text', async (req, res) => {
  const {
    text          = '',
    sessionId,
    history       = [],
    image         = null,
    imageMimeType = 'image/jpeg'
  } = req.body

  const hasText  = typeof text  === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) {
    return res.status(400).json({ error: 'missing_input' })
  }

  if (hasImage && image.length > 5_000_000) {
    return res.status(413).json({ error: 'image_too_large', maxBytes: 5_000_000 })
  }

  const sid = sessionId || 'default'

  if (processingLock.has(sid)) {
    return res.status(429).json({ error: 'request_in_progress', retry: true })
  }

  processingLock.add(sid)

  try {
    const safeText = hasText && text.length > MAX_INPUT_CHARS
      ? text.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated — input too long ...]'
      : text

    const inputText = safeText || '(image)'
    const processed = feed(sid, inputText)

    if (!processed.ok) {
      return res.status(422).json({ error: processed.reason || 'processing_failed' })
    }

    const tValue = processed.result.t
    storeSemanticEntry(sid, tValue, inputText)

    const engine        = getEngine(sid)
    const fieldPrompt   = engine.buildFieldPrompt?.() ?? null

    // ── Inline Code Detection & Indexing ────────────────────────
    // إذا المستخدم أرسل كوداً في الرسالة — يُفهرس فوراً
    const structIndex = indexStore?.get(sid) ?? null
    const codeBlocks  = detectCodeBlocks(safeText)

    if (codeBlocks.length > 0 && structIndex) {
      const tempPath = `session_inline/${sid}/msg_${tValue}.js`
      structIndex.updateFile(tempPath, codeBlocks.join('\n\n'))
      structIndex.injectSemanticVectors(engine)
      structIndex.injectIntoVault(engine)
    }

    const rawRoute      = engine.routeContext(safeText, 5)

    // ── routeContext يُعيد array أو {items, vaultHit} ──────────────
    const routeItems    = Array.isArray(rawRoute) ? rawRoute : (rawRoute?.items ?? [])
    const vaultHit      = Array.isArray(rawRoute) ? null : (rawRoute?.vaultHit ?? null)

    const routedContext = enrichRouteContext(routeItems, sid)
    const routeConf     = calcRouteConfidence(routedContext)

    const built = build({
      ok:           true,
      signals:      processed.signals,
      celfResult:   processed.celfResult,
      passToLLM:    processed.passToLLM,
      fieldPrompt,
      routedContext: vaultHit ? { items: routedContext, vaultHit } : routedContext
    })

    if (built.blocked) {
      return res.status(422).json({
        blocked: true, reason: 'semantic_constraint', context: built.context
      })
    }

    if (!built.passToLLM && !hasImage) {
      return res.json({ reply: null, skippedLLM: true, reason: 'weak_semantic_field' })
    }

    // ── Cognitive Query Layer ────────────────────────────────────
    const cogTarget   = engine.buildCognitiveTarget(safeText, structIndex)
    const rawHint     = built.systemHint ?? ''

    const extraHints = []
    if (cogTarget.focus?.winner === 'user')  extraHints.push('topic-shift: true')
    if (cogTarget.focus?.winner === 'celf')  extraHints.push('context-driven: true')
    if (cogTarget.dependencies?.length) {
      extraHints.push(
        `graph: ${cogTarget.dependencies.slice(0, 4).map(d => `${d.from}→${d.to}`).join(', ')}`
      )
    }

    const systemHint = [rawHint, ...extraHints].filter(Boolean).join('\n')

    const intent     = built.context?.intent ?? 'question'
    const continuity = built.context?.continuity ?? 0
    const maxTokens  = 4096

    const lastExchange = getLastExchange(history)

    const userContent = hasImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } },
          ...(hasText ? [{ type: 'text', text: safeText }] : [])
        ]
      : safeText

    const messages = hasImage
      ? [{ role: 'user', content: userContent }]
      : buildMessageContext(safeText, routedContext, lastExchange, continuity, intent)

    let payloadSize = 0
    try {
      payloadSize = checkPayload(systemHint, messages)
    } catch (e) {
      return res.status(413).json({ error: 'prompt_too_large', detail: e.message })
    }

    let claudeData
    let reply             = null
    let inputTokensTotal  = 0
    let outputTokensTotal = 0

    // ── Hybrid Routing — CELF يقرر النموذج ──────────────────────
    const useDeep = cogTarget?._meta?.deepAnalysis === true
    const model   = useDeep
      ? 'claude-sonnet-4-6'          // debug / review / deep analysis
      : 'claude-haiku-4-5-20251001'  // محادثة عادية

    try {
      const claudeResponse = await fetchClaude({
        model,
        max_tokens: maxTokens,
        system:     systemHint,
        messages
      })

      claudeData = await claudeResponse.json()

      if (!claudeResponse.ok) {
        throw new Error(
          `Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`
        )
      }

      reply = claudeData?.content?.[0]?.text ?? null

      inputTokensTotal  = claudeData?.usage?.input_tokens  ?? 0
      outputTokensTotal = claudeData?.usage?.output_tokens ?? 0

      const MAX_CONTINUATIONS = 2
      let continuationCount   = 0

      while (
        reply &&
        isTruncated(claudeData) &&
        continuationCount < MAX_CONTINUATIONS
      ) {
        continuationCount++
        if (outputTokensTotal >= 4096) break

        const contData = await continuationCall(safeText, reply, systemHint, 30000, model)
        if (!contData?.content?.[0]?.text) break

        reply        += removeOverlap(reply, contData.content[0].text)
        inputTokensTotal  += contData?.usage?.input_tokens  ?? 0
        outputTokensTotal += contData?.usage?.output_tokens ?? 0
        claudeData         = contData
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'claude_timeout' })
      }
      throw err
    }

    const costUSD = parseFloat(
      (
        (inputTokensTotal  / 1_000_000) * 1.0 +
        (outputTokensTotal / 1_000_000) * 5.0
      ).toFixed(6)
    )

    if (reply) {
      const analysis = analyze({
        reply,
        fieldBefore: processed.celfResult.field,
        fieldAfter:  engine.buildFieldPrompt?.() ?? {}
      })
      analysisStore.set(sid, analysis)
    }

    metricsStore.set(sid, {
      sessionId:      sid,
      inputTokens:    inputTokensTotal,
      outputTokens:   outputTokensTotal,
      totalTokens:    inputTokensTotal + outputTokensTotal,
      costUSD,
      maxTokens,
      payloadSize,
      routeConfidence: Math.round(routeConf * 1000) / 1000,
      hasMemoryCard:  !!built.memoryCard,
      continuity,
      intent,
      phase:          processed.celfResult.phase ?? 'warmup',
      updatedAt:      new Date().toISOString()
    })

    return res.json({
      reply,
      metrics: {
        inputTokens:     inputTokensTotal,
        outputTokens:    outputTokensTotal,
        totalTokens:     inputTokensTotal + outputTokensTotal,
        costUSD,
        maxTokens,
        routeConfidence: Math.round(routeConf * 1000) / 1000,
        hasMemoryCard:   !!built.memoryCard,
        vaultHit:        vaultHit ? { score: vaultHit.score, compressed: vaultHit.compressed } : null,
        cognitiveMode:   cogTarget?.cognitiveMode ?? null,
        conflictWinner:  cogTarget?.focus?.winner ?? null,
        deepAnalysis:    cogTarget?._meta?.deepAnalysis ?? false,
        model,
        inlineCode:      codeBlocks.length > 0,
        payloadSize,
        truncated:       hasText && text.length > MAX_INPUT_CHARS
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
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'session_not_found' })
  }
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
  analysisStore.delete(req.params.id)
  semanticTextMaps.delete(req.params.id)
  processingLock.delete(req.params.id)
  return res.json({ ok: true })
})

export { getEngine }

export default router
