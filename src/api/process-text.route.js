import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse } from '../utils/lightweight-parser.js'
import { build } from '../utils/context-builder.js'
import { analyze } from '../utils/response-analyzer.js'
import { indexStore } from './index-code.route.js'

const router = express.Router()

const MAX_SESSIONS = 150
const MAX_INPUT_CHARS = 40000
const MAX_IMAGE_BYTES = 5_000_000
const MAX_TEXT_MAP = 300
const MAX_HISTORY_MESSAGES = 4
const MAX_CONTINUATIONS = 2
const MAX_PROMPT_BYTES = 80000
const MAX_TOKENS = 4096

const DEDUP_JACCARD_THRESHOLD = 0.72
const ROUTE_CONFIDENCE_THRESHOLD = 0.25
const FEEDBACK_TIME_BUDGET_MS = 20000
const FEEDBACK_RELEVANCE_THRESHOLD = 0.24
const FEEDBACK_MIN_REPLY_CHARS = 80

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEEP_MODEL = 'claude-sonnet-4-6'

const sessions = new Map()
const metricsStore = new Map()
const analysisStore = new Map()
const processingLock = new Set()
const semanticTextMaps = new Map()

const TECH_KEYWORDS = {
  frameworks: ['fastapi', 'django', 'flask', 'express', 'nestjs', 'react', 'vue', 'spring'],
  databases: ['redis', 'postgresql', 'postgres', 'mysql', 'mongodb', 'sqlite', 'elasticsearch'],
  infra: ['docker', 'railway', 'nginx', 'kubernetes', 'aws', 'gcp', 'azure', 'vercel'],
  concepts: [
    'caching',
    'pooling',
    'rate limiting',
    'authentication',
    'websocket',
    'async',
    'optimization',
    'deployment',
    'monitoring',
    'scaling',
    'latency',
    'performance',
    'connection',
    'middleware',
    'routing',
    'security'
  ]
}

const FILLERS = new Set([
  'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'a', 'an', 'in', 'on', 'at', 'to', 'for',
  'ich', 'bin', 'ein', 'eine', 'der', 'die', 'das', 'und', 'wie', 'mit', 'von', 'auf', 'bei', 'für',
  'هل', 'في', 'من', 'على', 'مع', 'هو', 'هي', 'كان', 'لا', 'أو', 'و', 'ما', 'هذا', 'ذلك'
])

function round3(v) {
  return Math.round(Number(v || 0) * 1000) / 1000
}

function clamp01(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

function semanticHash(text) {
  const normalized = String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
  let h = 2166136261

  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return Math.abs(h >>> 0).toString(36)
}

function semanticCompress(text, maxWords = 12) {
  const cleaned = String(text ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[\s\S]*?`/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const words = cleaned
    .split(/\s+/)
    .filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))

  return words.slice(0, maxWords).join(' ')
}

function jaccardSimilarity(textA, textB) {
  const setA = new Set(String(textA ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const setB = new Set(String(textB ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 2))

  if (!setA.size || !setB.size) return 0

  let overlap = 0
  for (const w of setA) {
    if (setB.has(w)) overlap++
  }

  const union = setA.size + setB.size - overlap
  return union > 0 ? overlap / union : 0
}

function detectCodeBlocks(text) {
  const blocks = []
  const source = String(text ?? '')
  const fenced = /```(?:js|javascript|ts|typescript|jsx|tsx)?\s*\n([\s\S]*?)```/gi
  let match

  while ((match = fenced.exec(source)) !== null) {
    const code = match[1].trim()
    if (code.length > 30) blocks.push(code)
  }

  if (!blocks.length) {
    const codeSignals = [
      /^(import|export|const|let|var|function|class|async)\s/m,
      /=>\s*\{/,
      /\bthis\.\w+\s*=/,
      /^\s{2,}(const|let|var|return|if|for)\s/m
    ]

    const looksLikeCode = codeSignals.filter(p => p.test(source)).length >= 2

    if (looksLikeCode && source.length > 50 && source.length < 20000) {
      blocks.push(source)
    }
  }

  return blocks
}

function getEngine(sessionId) {
  if (sessions.has(sessionId)) {
    const engine = sessions.get(sessionId)
    sessions.delete(sessionId)
    sessions.set(sessionId, engine)
    return engine
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

  if (!signals.valid) {
    return { ok: false, reason: signals.reason ?? 'invalid_signals' }
  }

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

  const passToLLM =
    coherence > 0.15 ||
    resonance > 0.20 ||
    intent === 'greeting' ||
    intent === 'emotional' ||
    confidence < 0.4

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

  map.set(t, { hash, text: compressed })

  while (map.size > MAX_TEXT_MAP) {
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

  const valid = routedContext.filter(i =>
    Number(i.score ?? 0) > ROUTE_CONFIDENCE_THRESHOLD &&
    typeof i.text === 'string' &&
    i.text.trim().length > 3
  )

  if (!valid.length) return 0

  return valid.reduce((s, i) => s + Number(i.score ?? 0), 0) / valid.length
}

function extractCodePurpose(lang, surroundingText, codeContent) {
  const combined = `${surroundingText} ${String(codeContent ?? '').slice(0, 300)}`.toLowerCase()
  const allTech = [...TECH_KEYWORDS.frameworks, ...TECH_KEYWORDS.databases, ...TECH_KEYWORDS.infra]
  const foundTech = allTech.filter(k => combined.includes(k)).slice(0, 2)
  const foundConcept = TECH_KEYWORDS.concepts.find(k => combined.includes(k))
  const declarations = String(codeContent ?? '').match(/(?:def|function|class|async def)\s+(\w+)/g) ?? []
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

    if (textBefore.trim()) {
      parts.push({ type: 'text', content: textBefore.trim() })
    }

    parts.push({
      type: 'label',
      content: extractCodePurpose(lang, textBefore, codeContent)
    })

    lastIndex = match.index + match[0].length
  }

  const textAfter = content.slice(lastIndex).trim()

  if (textAfter) {
    parts.push({ type: 'text', content: textAfter })
  }

  if (!parts.length) return '[response provided]'

  const textParts = parts
    .filter(p => p.type === 'text')
    .map(p => p.content.slice(0, 200))

  const labelParts = parts
    .filter(p => p.type === 'label')
    .map(p => p.content)

  return [textParts.join('\n').trim(), labelParts.join(', ')]
    .filter(Boolean)
    .join('\n') || '[response provided]'
}

function buildHistoryLayer(history, continuity) {
  if (continuity < 0.65) return []

  const clean = Array.isArray(history)
    ? history
        .filter(h =>
          h &&
          (h.role === 'user' || h.role === 'assistant') &&
          typeof h.content === 'string' &&
          h.content.length > 0
        )
        .slice(-MAX_HISTORY_MESSAGES)
    : []

  if (clean.length < 2) return []

  return clean.map(h => ({
    role: h.role,
    content: h.role === 'assistant'
      ? compressAssistantMessage(h.content)
      : h.content.slice(0, 300)
  }))
}

function buildReplyVector(engine, reply) {
  if (!reply || typeof reply !== 'string') return null

  if (typeof engine.buildVector === 'function') {
    return engine.buildVector(reply)
  }

  if (typeof engine.extractSemantic === 'function') {
    return engine.extractSemantic(reply, reply)?.vector ?? null
  }

  return null
}

function extractImportantTerms(text, maxTerms = 8) {
  const cleaned = String(text ?? '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[^\p{L}\p{N}_#+.-]+/gu, ' ')
    .trim()

  const words = cleaned
    .split(/\s+/)
    .filter(w => w.length > 2 && !FILLERS.has(w))

  const counts = new Map()

  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([word]) => word)
}

function termCoverage(question, reply) {
  const terms = extractImportantTerms(question)
  if (!terms.length) return 1

  const replyText = String(reply ?? '').toLowerCase()
  const hits = terms.filter(t => replyText.includes(t)).length

  return hits / terms.length
}

function measureReplyRelevance(engine, questionVector, questionText, reply, memoryCard = null) {
  const replyVector = buildReplyVector(engine, reply)

  if (!questionVector?.length || !replyVector?.length) {
    return {
      semantic: 1,
      coverage: 1,
      memory: 1,
      score: 1,
      needsCorrection: false
    }
  }

  const semantic = clamp01(engine.cosineSimilarity(questionVector, replyVector))
  const coverage = clamp01(termCoverage(questionText, reply))

  let memory = 1

  if (memoryCard?.topics?.length) {
    const replyText = String(reply ?? '').toLowerCase()
    const joined = memoryCard.topics.join(' ').toLowerCase()
    const memoryTerms = extractImportantTerms(joined, 8)

    if (memoryTerms.length) {
      memory = memoryTerms.filter(t => replyText.includes(t)).length / memoryTerms.length
    }
  }

  const score = clamp01(semantic * 0.45 + coverage * 0.35 + memory * 0.20)
  const tooShort = String(reply ?? '').trim().length < FEEDBACK_MIN_REPLY_CHARS
  const needsCorrection = score < FEEDBACK_RELEVANCE_THRESHOLD || (semantic < 0.18 && coverage < 0.25) || tooShort

  return {
    semantic: round3(semantic),
    coverage: round3(coverage),
    memory: round3(memory),
    score: round3(score),
    needsCorrection
  }
}

function buildCorrectionPrompt(questionText, relevance, memoryCard = null) {
  const focus = memoryCard?.topics?.length
    ? `حافظ على السياق المرتبط بـ: ${memoryCard.topics.join(' — ')}.`
    : 'أجب عن السؤال الأصلي مباشرة.'

  return [
    'أعد المحاولة.',
    `السؤال الأصلي: ${questionText}`,
    `الرد السابق لم يغط السؤال بما يكفي. relevance=${relevance.score}.`,
    focus,
    'لا تشرح سبب الإعادة. قدّم الإجابة المصححة فقط.'
  ].join('\n')
}

function checkPayload(systemHint, messages) {
  const size = JSON.stringify({ system: systemHint, messages }).length

  if (size > MAX_PROMPT_BYTES) {
    throw new Error('prompt_too_large')
  }

  return size
}

async function fetchClaude(body, timeoutMs = 50000) {
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

function isTruncated(claudeData) {
  return claudeData?.stop_reason === 'max_tokens'
}

function detectOpenCodeBlock(text) {
  return (String(text ?? '').match(/```/g) ?? []).length % 2 !== 0
}

function removeOverlap(existing, continuation) {
  const cont = String(continuation ?? '')
  const checkLen = Math.min(120, cont.length)
  const tail = String(existing ?? '').slice(-checkLen * 2)
  const head = cont.slice(0, checkLen)

  for (let len = checkLen; len >= 20; len--) {
    const fragment = head.slice(0, len)

    if (tail.includes(fragment)) {
      return cont.slice(cont.indexOf(fragment) + fragment.length)
    }
  }

  return cont
}

async function continuationCall(currentText, partialReply, systemHint, timeoutMs = 30000, model = DEFAULT_MODEL) {
  const hasOpenCode = detectOpenCodeBlock(partialReply)
  const continuePrompt = hasOpenCode
    ? 'continue exactly from where you stopped — complete the open code block, do not repeat what was already written'
    : 'continue exactly from where you stopped — do not repeat what was already written'

  const response = await fetchClaude({
    model,
    max_tokens: MAX_TOKENS,
    system: systemHint,
    messages: [
      { role: 'user', content: currentText },
      { role: 'assistant', content: partialReply },
      { role: 'user', content: continuePrompt }
    ]
  }, timeoutMs)

  return await response.json()
}

function extractClaudeText(data) {
  const parts = Array.isArray(data?.content) ? data.content : []
  return parts
    .filter(p => p?.type === 'text' || typeof p?.text === 'string')
    .map(p => p.text ?? '')
    .join('\n')
    .trim() || null
}

async function callClaudeWithContinuations({ model, systemHint, messages, currentText }) {
  let claudeData = null
  let reply = null
  let inputTokens = 0
  let outputTokens = 0

  const claudeResponse = await fetchClaude({
    model,
    max_tokens: MAX_TOKENS,
    system: systemHint,
    messages
  })

  claudeData = await claudeResponse.json()

  if (!claudeResponse.ok) {
    throw new Error(`Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`)
  }

  reply = extractClaudeText(claudeData)
  inputTokens += claudeData?.usage?.input_tokens ?? 0
  outputTokens += claudeData?.usage?.output_tokens ?? 0

  let continuationCount = 0

  while (reply && isTruncated(claudeData) && continuationCount < MAX_CONTINUATIONS) {
    continuationCount++

    if (outputTokens >= MAX_TOKENS) break

    const contData = await continuationCall(currentText, reply, systemHint, 30000, model)
    const contText = extractClaudeText(contData)

    if (!contText) break

    reply += removeOverlap(reply, contText)
    inputTokens += contData?.usage?.input_tokens ?? 0
    outputTokens += contData?.usage?.output_tokens ?? 0
    claudeData = contData
  }

  return { claudeData, reply, inputTokens, outputTokens }
}

router.get('/process-text', (_req, res) => {
  res.json({
    ok: true,
    status: 'online',
    engine: 'CELF_Engine_AI_V5',
    llm: 'Claude Haiku 4.5',
    version: '6.3'
  })
})

router.post('/process-text', async (req, res) => {
  const {
    text = '',
    sessionId,
    history = [],
    image = null,
    imageMimeType = 'image/jpeg'
  } = req.body

  const hasText = typeof text === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) {
    return res.status(400).json({ error: 'missing_input' })
  }

  if (hasImage && image.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'image_too_large', maxBytes: MAX_IMAGE_BYTES })
  }

  const sid = sessionId || 'default'
  const requestStart = Date.now()

  if (processingLock.has(sid)) {
    return res.status(429).json({ error: 'request_in_progress', retry: true })
  }

  processingLock.add(sid)

  try {
    const safeText = hasText && text.length > MAX_INPUT_CHARS
      ? `${text.slice(0, MAX_INPUT_CHARS)}\n\n[... truncated ...]`
      : text

    const inputText = safeText || '(image)'
    const processed = feed(sid, inputText)

    if (!processed.ok) {
      return res.status(422).json({ error: processed.reason || 'processing_failed' })
    }

    const tValue = processed.result.t
    storeSemanticEntry(sid, tValue, inputText)

    const engine = getEngine(sid)
    const fieldPrompt = engine.buildFieldPrompt?.() ?? null
    const questionVector = processed.result?.perturbation?.semantic?.vector ?? null

    const structIndex = indexStore?.get(sid) ?? null
    const codeBlocks = detectCodeBlocks(safeText)

    if (codeBlocks.length > 0 && structIndex) {
      const tempPath = `session_inline/${sid}/msg_${tValue}.js`
      structIndex.updateFile(tempPath, codeBlocks.join('\n\n'))
      structIndex.injectSemanticVectors(engine)
      structIndex.injectIntoVault(engine)
    }

    const rawRoute = engine.routeContext(safeText, 5)
    const routeItems = Array.isArray(rawRoute) ? rawRoute : (rawRoute?.items ?? [])
    const vaultHit = Array.isArray(rawRoute) ? null : (rawRoute?.vaultHit ?? null)
    const routedContext = enrichRouteContext(routeItems, sid)
    const routeConf = calcRouteConfidence(routedContext)

    const built = build({
      ok: true,
      signals: processed.signals,
      celfResult: processed.celfResult,
      passToLLM: processed.passToLLM,
      fieldPrompt,
      routedContext: vaultHit ? { items: routedContext, vaultHit } : routedContext
    })

    if (built.blocked) {
      return res.status(422).json({
        blocked: true,
        reason: 'semantic_constraint',
        context: built.context
      })
    }

    if (!built.passToLLM && !hasImage) {
      return res.json({
        reply: null,
        skippedLLM: true,
        reason: 'weak_semantic_field'
      })
    }

    const cogTarget = engine.buildCognitiveTarget(safeText, structIndex)
    const extraHints = []

    if (cogTarget.focus?.winner === 'user') {
      extraHints.push('topic-shift: true')
    }

    if (cogTarget.focus?.winner === 'celf') {
      extraHints.push('context-driven: true')
    }

    if (cogTarget.dependencies?.length) {
      extraHints.push(
        `graph: ${cogTarget.dependencies.slice(0, 4).map(d => `${d.from}→${d.to}`).join(', ')}`
      )
    }

    const systemHint = [built.systemHint, ...extraHints].filter(Boolean).join('\n')
    const continuity = built.context?.continuity ?? 0

    const userContent = hasImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } },
          ...(hasText ? [{ type: 'text', text: safeText }] : [])
        ]
      : safeText

    const historyMessages = hasImage ? [] : buildHistoryLayer(history, continuity)

    const messages = [
      ...historyMessages,
      { role: 'user', content: hasImage ? userContent : safeText }
    ]

    let payloadSize = 0

    try {
      payloadSize = checkPayload(systemHint, messages)
    } catch (err) {
      return res.status(413).json({ error: 'prompt_too_large', detail: err.message })
    }

    const useDeep = cogTarget?._meta?.deepAnalysis === true
    const model = useDeep ? DEEP_MODEL : DEFAULT_MODEL

    let reply = null
    let inputTokensTotal = 0
    let outputTokensTotal = 0
    let feedbackTriggered = false
    let replyRelevance = null

    try {
      const first = await callClaudeWithContinuations({
        model,
        systemHint,
        messages,
        currentText: safeText
      })

      reply = first.reply
      inputTokensTotal += first.inputTokens
      outputTokensTotal += first.outputTokens

      const elapsedMs = Date.now() - requestStart
      const canFeedback =
        reply &&
        !hasImage &&
        questionVector?.length &&
        elapsedMs < FEEDBACK_TIME_BUDGET_MS

      if (canFeedback) {
        const relevance = measureReplyRelevance(
          engine,
          questionVector,
          safeText,
          reply,
          built.memoryCard
        )

        replyRelevance = relevance

        if (relevance.needsCorrection) {
          feedbackTriggered = true

          const correctionPrompt = buildCorrectionPrompt(
            safeText,
            relevance,
            built.memoryCard
          )

          const retryMessages = [
            ...messages,
            { role: 'assistant', content: reply },
            { role: 'user', content: correctionPrompt }
          ]

          checkPayload(systemHint, retryMessages)

          const retry = await callClaudeWithContinuations({
            model,
            systemHint,
            messages: retryMessages,
            currentText: safeText
          })

          if (retry.reply) {
            reply = retry.reply
            inputTokensTotal += retry.inputTokens
            outputTokensTotal += retry.outputTokens
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'claude_timeout' })
      }

      throw err
    }

    const costUSD = parseFloat(
      (
        (inputTokensTotal / 1_000_000) * 1.0 +
        (outputTokensTotal / 1_000_000) * 5.0
      ).toFixed(6)
    )

    if (reply) {
      const analysis = analyze({
        reply,
        fieldBefore: processed.celfResult.field,
        fieldAfter: engine.buildFieldPrompt?.() ?? {}
      })

      analysisStore.set(sid, analysis)
    }

    metricsStore.set(sid, {
      sessionId: sid,
      inputTokens: inputTokensTotal,
      outputTokens: outputTokensTotal,
      totalTokens: inputTokensTotal + outputTokensTotal,
      costUSD,
      maxTokens: MAX_TOKENS,
      payloadSize,
      routeConfidence: round3(routeConf),
      hasMemoryCard: !!built.memoryCard,
      continuity,
      phase: processed.celfResult.phase ?? 'warmup',
      feedbackTriggered,
      replyRelevance,
      updatedAt: new Date().toISOString()
    })

    return res.json({
      reply,
      metrics: {
        inputTokens: inputTokensTotal,
        outputTokens: outputTokensTotal,
        totalTokens: inputTokensTotal + outputTokensTotal,
        costUSD,
        maxTokens: MAX_TOKENS,
        routeConfidence: round3(routeConf),
        hasMemoryCard: !!built.memoryCard,
        vaultHit: vaultHit ? { score: vaultHit.score, compressed: vaultHit.compressed } : null,
        cognitiveMode: cogTarget?.cognitiveMode ?? null,
        conflictWinner: cogTarget?.focus?.winner ?? null,
        deepAnalysis: cogTarget?._meta?.deepAnalysis ?? false,
        model,
        inlineCode: codeBlocks.length > 0,
        payloadSize,
        feedbackTriggered,
        replyRelevance,
        truncated: hasText && text.length > MAX_INPUT_CHARS
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
  const metrics = metricsStore.get(req.params.id)

  if (!metrics) {
    return res.status(404).json({ error: 'metrics_not_found' })
  }

  return res.json(metrics)
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
