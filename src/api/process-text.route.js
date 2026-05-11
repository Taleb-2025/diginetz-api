/**
 * CELF AI — /celf/process-text  (router v4.0)
 * Claude Haiku — بدون Groq — مفتوح للتجربة
 */

import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse }              from '../utils/lightweight-parser.js'
import { build }              from '../utils/context-builder.js'

const router = express.Router()

const MAX_SESSIONS = 500
const sessions     = new Map()
const metricsStore = new Map()

function getEngine(sessionId) {
  if (sessions.has(sessionId)) {
    const engine = sessions.get(sessionId)
    sessions.delete(sessionId)
    sessions.set(sessionId, engine)
    return engine
  }

  if (sessions.size >= MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value)
  }

  const engine = new CELF_Engine_AI_V5({
    resolution:    360,
    ringCount:     5,
    cycle:         360,
    diffusionRate: 0.08,
    constraintRate: 0.12,
    attractorLimit: 12
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

function buildSemanticSummary(text, routedContext = [], snapshot = {}) {

  const lower = String(text || '').toLowerCase()

  const topics = []

  if (/python|fastapi|redis|api|server|backend/.test(lower)) {
    topics.push('backend-development')
  }

  if (/latency|timeout|performance|speed|cache|caching/.test(lower)) {
    topics.push('performance-optimization')
  }

  if (/railway|deploy|docker|cloud|hosting/.test(lower)) {
    topics.push('deployment')
  }

  if (/tokens|claude|openai|llm|prompt/.test(lower)) {
    topics.push('llm-optimization')
  }

  const language =
    /[أ-ي]/.test(text)
      ? 'arabic'
      : 'english'

  const field =
    snapshot?.field ?? {}

  const phase =
    snapshot?.phase ?? 'warmup'

  const coherence =
    Number(field.coherence ?? 0)

  const resonance =
    Number(field.resonance ?? 0)

  const novelty =
    Number(field.noveltyPressure ?? 0)

  const grounding =
    Number(field.semanticGrounding ?? 0)

  const routed =
    routedContext
      .slice(0, 3)
      .map(r => ({
        phase: r.phase,
        score: r.score
      }))

  return {
    topic: topics.join(', ') || 'general-discussion',
    language,
    phase,
    coherence,
    resonance,
    novelty,
    grounding,
    routed
  }

}

async function feed(sessionId, text) {

  const signals = parse(text)

  if (!signals.valid) {
    return { ok: false, reason: signals.reason ?? 'invalid_signals' }
  }

  const engine   = getEngine(sessionId)
  const snapshot = await engine.process(text)

  const field        = snapshot.field        ?? {}
  const metrics      = snapshot.metrics      ?? {}
  const control      = snapshot.control      ?? {}
  const perturbation = snapshot.perturbation ?? {}
  const attractors   = snapshot.attractors   ?? []

  const coherence     = Number(field.coherence         ?? 0)
  const fieldStrength = Number(field.resonance         ?? 0)
  const resonance     = Number(field.resonance         ?? 0)
  const confidence    = Number(field.semanticGrounding ?? 0)
  const intent        = mapIntent(snapshot)

  const passToLLM =
    coherence     > 0.15 ||
    fieldStrength > 0.15 ||
    resonance     > 0.20 ||
    intent        === 'greeting' ||
    intent        === 'emotional' ||
    confidence    < 0.4

  return {
    ok: true,
    passToLLM,
    signals,
    result: snapshot,
    celfResult: {
      phase: snapshot.phase,
      t:     snapshot.t,
      field,
      metrics,
      control,
      perturbation,
      attractors
    }
  }
}

async function callClaude(
  systemHint,
  userContent,
  history,
  hasImage,
  routedContext = [],
  semanticSummary = {}
) {

  let finalContent

  if (hasImage) {
    finalContent = userContent
  } else {
    finalContent =
      typeof userContent === 'string'
        ? userContent
        : JSON.stringify(userContent)
  }

  const compactMemory = routedContext.map(r => ({
    t:          r.t,
    phase:      r.phase,
    score:      r.score,
    theta:      r.theta,
    signature:  r.signature,
    signalType: r.signalType
  }))

  const summaryText =
    JSON.stringify(semanticSummary)

  const messages = [
    {
      role: 'user',
      content: hasImage
        ? finalContent
        : `[CELF SUMMARY]\n${summaryText}\n\n[CELF MEMORY]\n${JSON.stringify(compactMemory)}\n\n${finalContent}`
    }
  ]

  const historyChars = history.reduce(
    (s, h) => s + JSON.stringify(h).length,
    0
  )

  const systemChars = systemHint.length

  const userChars =
    typeof finalContent === 'string'
      ? finalContent.length
      : JSON.stringify(finalContent).length

  const memoryChars =
    JSON.stringify(compactMemory).length

  const summaryChars =
    summaryText.length

  const totalChars =
    historyChars +
    systemChars +
    userChars +
    memoryChars +
    summaryChars

  const estimatedInputTokens =
    Math.ceil(totalChars / 4)

  console.log('\n========== REAL API PAYLOAD ==========')
  console.log('History messages:      ', history.length)
  console.log('History chars:         ', historyChars)
  console.log('System hint chars:     ', systemChars)
  console.log('User chars:            ', userChars)
  console.log('CELF memory chars:     ', memoryChars)
  console.log('CELF summary chars:    ', summaryChars)
  console.log('TOTAL chars:           ', totalChars)
  console.log('Estimated INPUT TOKENS:', estimatedInputTokens)
  console.log('Max OUTPUT TOKENS:     ', 1024)
  console.log('======================================\n')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     systemHint,
      messages
    })
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      `Claude API error: ${data?.error?.message ?? response.status}`
    )
  }

  return data?.content?.[0]?.text ?? null
}

router.get('/process-text', (_req, res) => {
  res.json({
    ok:       true,
    endpoint: '/celf/process-text',
    method:   'POST',
    status:   'online',
    engine:   'CELF_Engine_AI_V5',
    llm:      'Claude Haiku'
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

  const hasText  =
    typeof text === 'string' &&
    text.trim().length > 0

  const hasImage =
    typeof image === 'string' &&
    image.length > 0

  if (!hasText && !hasImage) {
    return res.status(400).json({
      error: 'missing_input'
    })
  }

  const sid       = sessionId || 'default'
  const inputText = hasText ? text : '(image)'
  const processed = await feed(sid, inputText)

  if (!processed.ok) {
    return res.status(422).json({
      error: processed.reason || 'processing_failed'
    })
  }

  const built = build({
    ok:         true,
    signals:    processed.signals,
    celfResult: processed.celfResult,
    passToLLM:  processed.passToLLM
  })

  if (built.blocked) {
    return res.status(422).json({
      blocked: true,
      reason:  'semantic_constraint',
      context: built.context
    })
  }

  if (!built.passToLLM && !hasImage) {
    return res.json({
      reply:      null,
      skippedLLM: true,
      reason:     'weak_semantic_field',
      context:    built.context,
      celf:       processed.result
    })
  }

  try {

    const systemHint = built.systemHint || ''

    let userContent

    if (hasImage) {

      userContent = [
        {
          type: 'image',
          source: {
            type:       'base64',
            media_type: imageMimeType,
            data:       image
          }
        },
        ...(hasText
          ? [{ type: 'text', text }]
          : [])
      ]

    } else {

      userContent = text

    }

    const engine = getEngine(sid)

    const routedContext =
      engine.routeContext(text, 3)

    const semanticSummary =
      buildSemanticSummary(
        text,
        routedContext,
        processed.result
      )

    const historyChars =
      history.reduce(
        (s, h) => s + (h.content?.length || 0),
        0
      )

    const rawInputChars =
      text.length + historyChars

    const compactMemoryChars =
      JSON.stringify(routedContext).length

    const semanticSummaryChars =
      JSON.stringify(semanticSummary).length

    const compressedChars =
      systemHint.length +
      text.length +
      compactMemoryChars +
      semanticSummaryChars

    const compressionRatio =
      rawInputChars > 0
        ? Math.round(
            (1 - compressedChars / rawInputChars) * 100
          )
        : 0

    metricsStore.set(sid, {
      sessionId: sid,
      rawInputChars,
      compressedChars,
      compressionRatio,
      estimatedSystemTokens: Math.ceil(systemHint.length / 4),
      estimatedCompactTokens: Math.ceil(compactMemoryChars / 4),
      estimatedSummaryTokens: Math.ceil(semanticSummaryChars / 4),
      phase:       processed.celfResult.phase                  ?? 'warmup',
      resonance:   processed.celfResult.field?.resonance       ?? 0,
      coherence:   processed.celfResult.field?.coherence       ?? 0,
      novelty:     processed.celfResult.field?.noveltyPressure ?? 0,
      attractors:  processed.celfResult.attractors?.length     ?? 0,
      hasImage,
      llm:         'claude-haiku-4-5',
      updatedAt:   new Date().toISOString()
    })

    const reply = await callClaude(
      systemHint,
      userContent,
      history,
      hasImage,
      routedContext,
      semanticSummary
    )

    if (reply) {
      await engine.process(reply)
    }

    return res.json({
      reply,
      context: built.context,
      signals: processed.signals,
      celf: processed.result,
      routedContext,
      semanticSummary,
      metrics: {
        rawInputChars,
        compressedChars,
        compressionRatio,
        estimatedSystemTokens: Math.ceil(systemHint.length / 4),
        estimatedCompactTokens: Math.ceil(compactMemoryChars / 4),
        estimatedSummaryTokens: Math.ceil(semanticSummaryChars / 4)
      }
    })

  } catch (err) {

    console.error(
      '[process-text] error:',
      err.message,
      err.stack
    )

    return res.status(500).json({
      error: 'llm_failed',
      detail: err.message
    })

  }

})

router.get('/session/:id', (req, res) => {

  if (!sessions.has(req.params.id)) {
    return res.status(404).json({
      error: 'session_not_found'
    })
  }

  const engine  = sessions.get(req.params.id)
  const summary = engine.getSummary?.() ?? {}

  return res.json({
    ok: true,
    sessionId: req.params.id,
    summary
  })

})

router.get('/metrics/:id', (req, res) => {

  const metrics = metricsStore.get(req.params.id)

  if (!metrics) {
    return res.status(404).json({
      error: 'metrics_not_found'
    })
  }

  return res.json(metrics)

})

router.get('/debug/:id', (req, res) => {

  if (!sessions.has(req.params.id)) {
    return res.status(404).json({
      error: 'session_not_found'
    })
  }

  const engine  = sessions.get(req.params.id)
  const metrics = metricsStore.get(req.params.id)
  const summary = engine.getSummary?.() ?? {}

  return res.json({
    metrics,
    summary,
    rings: engine.getRings?.() ?? []
  })

})

router.delete('/session/:id', (req, res) => {

  sessions.delete(req.params.id)
  metricsStore.delete(req.params.id)

  return res.json({
    ok: true
  })

})

export default router
