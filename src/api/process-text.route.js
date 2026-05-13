import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse } from '../utils/lightweight-parser.js'
import { build } from '../utils/context-builder.js'
import { analyze } from '../utils/response-analyzer.js'

const router = express.Router()
const MAX_SESSIONS = 500
const sessions = new Map()
const metricsStore = new Map()
const analysisStore = new Map()

function getEngine(sessionId) {
  if (sessions.has(sessionId)) {
    const e = sessions.get(sessionId)
    sessions.delete(sessionId)
    sessions.set(sessionId, e)
    return e
  }

  if (sessions.size >= MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value)
  }

  const engine = new CELF_Engine_AI_V5({
    resolution: 360,
    ringCount: 5,
    cycle: 360,
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
  if (s.question) return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error) return 'complaint'
  if (s.emotional) return 'emotional'

  return 'statement'
}

function normalizeHistory(history = [], limit = 2, charLimit = 500) {
  if (!Array.isArray(history)) return []

  return history
    .filter(h =>
      (h?.role === 'user' || h?.role === 'assistant') &&
      typeof h?.content === 'string' &&
      h.content.length > 0
    )
    .slice(-limit)
    .map(h => ({
      role: h.role,
      content: h.content.slice(0, charLimit)
    }))
}

function buildSemanticContinuity(engine) {
  const routed =
    engine
      .getSemanticState?.()
      ?.routedContext ?? []

  if (!routed.length)
    return null

  const top = routed.slice(0, 3)

  const phases = [
    ...new Set(top.map(x => x.phase).filter(Boolean))
  ]

  return [
    'Previous semantic continuity:',
    `Phase memory: ${phases.join(', ')}`,
    `Top continuity score: ${top[0]?.score ?? 0}`
  ].join('\n')
}

function detectTruncation(reply = '', stopReason = '') {
  if (!reply) return false

  if (stopReason === 'max_tokens')
    return true

  const codeFenceCount =
    (reply.match(/```/g) || []).length

  if (codeFenceCount % 2 !== 0)
    return true

  const endings = [
    '{',
    '(',
    '[',
    'const',
    'let',
    'return',
    'class',
    'app.',
    'export',
    'import'
  ]

  const trimmed = reply.trim()

  return endings.some(e =>
    trimmed.endsWith(e)
  )
}

function resolveTemperature(complexity = 'low') {
  if (complexity === 'very_high') return 0.6
  if (complexity === 'high') return 0.5
  if (complexity === 'medium') return 0.4
  return 0.2
}

async function feed(sessionId, text) {
  const signals = parse(text)

  if (!signals.valid) {
    return {
      ok: false,
      reason: signals.reason ?? 'invalid_signals'
    }
  }

  const engine = getEngine(sessionId)
  const snapshot = await engine.process(text)

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

router.get('/process-text', (_req, res) => {
  res.json({
    ok: true,
    status: 'online',
    engine: 'CELF_Engine_AI_V5',
    llm: 'Claude Haiku 4.5',
    version: '5.0'
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

  const hasText =
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

  const sid = sessionId || 'default'
  const inputText = hasText ? text : '(image)'
  const processed = await feed(sid, inputText)

  if (!processed.ok) {
    return res.status(422).json({
      error: processed.reason || 'processing_failed'
    })
  }

  const prevAnalysis = analysisStore.get(sid) ?? null
  const structuralHint = prevAnalysis?.structuralHint ?? null
  const prevMaxTokens = prevAnalysis?.nextMaxTokens ?? null

  const engine = getEngine(sid)
  const fieldPrompt = engine.buildFieldPrompt?.() ?? null

  const built = build({
    ok: true,
    signals: processed.signals,
    celfResult: processed.celfResult,
    passToLLM: processed.passToLLM,
    structuralHint,
    prevMaxTokens,
    fieldPrompt,
    prevAnalysis
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
      reason: 'weak_semantic_field',
      context: built.context,
      celf: processed.result
    })
  }

  try {
    const systemHint = built.systemHint || ''
    const lightweightHistory = normalizeHistory(history)
    const semanticContinuity =
      buildSemanticContinuity(engine)

    const complexity =
      built?.context?.complexity ?? 'low'

    const temperature =
      resolveTemperature(complexity)

    let userContent

    if (hasImage) {
      userContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageMimeType,
            data: image
          }
        },
        ...(hasText ? [{ type: 'text', text }] : [])
      ]
    } else {
      userContent = text
    }

    const messages = [
      ...lightweightHistory.map(h => ({
        role: h.role,
        content: h.content
      })),
      ...(semanticContinuity
        ? [{
            role: 'user',
            content: semanticContinuity
          }]
        : []),
      {
        role: 'user',
        content: userContent
      }
    ]

    const historyChars = Array.isArray(history)
      ? history.reduce((s, h) => s + (h.content?.length || 0), 0)
      : 0

    const lightweightHistoryChars =
      lightweightHistory.reduce(
        (s, h) => s + (h.content?.length || 0),
        0
      )

    const rawInputChars =
      text.length + historyChars

    const compressedChars =
      systemHint.length +
      lightweightHistoryChars +
      text.length +
      (semanticContinuity?.length ?? 0)

    const compressionRatio =
      rawInputChars > 0
        ? Math.round((1 - compressedChars / rawInputChars) * 100)
        : 0

    let maxTokens =
      built.maxTokens ?? 300

    let claudeResponse = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          temperature,
          system:
            complexity === 'high' ||
            complexity === 'very_high'
              ? `${systemHint} Never truncate code. Always complete code blocks.`
              : systemHint,
          messages
        })
      }
    )

    let claudeData = await claudeResponse.json()

    if (!claudeResponse.ok) {
      throw new Error(
        `Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`
      )
    }

    let reply =
      claudeData?.content?.[0]?.text ?? null

    let usage =
      claudeData?.usage ?? {}

    const stopReason =
      claudeData?.stop_reason ?? ''

    const truncated =
      detectTruncation(reply, stopReason)

    if (
      truncated &&
      (
        complexity === 'high' ||
        complexity === 'very_high'
      )
    ) {
      maxTokens = Math.min(
        Math.round(maxTokens * 1.5),
        4000
      )

      const retryMessages = [
        ...messages,
        {
          role: 'assistant',
          content: reply
        },
        {
          role: 'user',
          content:
            'Continue exactly from previous output.'
        }
      ]

      const retryResponse = await fetch(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: maxTokens,
            temperature,
            system:
              `${systemHint} Never truncate code. Always complete code blocks.`,
            messages: retryMessages
          })
        }
      )

      const retryData =
        await retryResponse.json()

      if (retryResponse.ok) {
        const continued =
          retryData?.content?.[0]?.text ?? ''

        reply =
          `${reply}\n${continued}`

        usage = {
          input_tokens:
            (usage.input_tokens ?? 0) +
            (retryData?.usage?.input_tokens ?? 0),

          output_tokens:
            (usage.output_tokens ?? 0) +
            (retryData?.usage?.output_tokens ?? 0)
        }
      }
    }

    if (reply) {
      const fieldBefore =
        processed.celfResult.field

      await getEngine(sid).process(reply, 0.2)

      const fieldAfter =
        getEngine(sid).getSummary?.()?.field ?? {}

      const analysis = analyze({
        reply,
        fieldBefore,
        fieldAfter,
        maxTokens
      })

      analysisStore.set(sid, analysis)
    }

    const inputTokens =
      usage.input_tokens ?? 0

    const outputTokens =
      usage.output_tokens ?? 0

    const totalTokens =
      inputTokens + outputTokens

    const costUSD = parseFloat((
      (inputTokens / 1_000_000 * 1.00) +
      (outputTokens / 1_000_000 * 5.00)
    ).toFixed(6))

    metricsStore.set(sid, {
      sessionId: sid,
      rawInputChars,
      compressedChars,
      lightweightHistoryChars,
      compressionRatio,
      phase: processed.celfResult.phase ?? 'warmup',
      coherence: processed.celfResult.field?.coherence ?? 0,
      novelty: processed.celfResult.field?.noveltyPressure ?? 0,
      attractors: processed.celfResult.attractors?.length ?? 0,
      hasImage,
      complexity,
      temperature,
      maxTokens,
      actualInputTokens: inputTokens,
      actualOutputTokens: outputTokens,
      actualTotalTokens: totalTokens,
      costUSD,
      llm: 'claude-haiku-4-5',
      updatedAt: new Date().toISOString()
    })

    return res.json({
      reply,
      context: built.context,
      signals: processed.signals,
      celf: processed.result,
      metrics: {
        rawInputChars,
        compressedChars,
        lightweightHistoryChars,
        compressionRatio,
        complexity,
        temperature,
        maxTokens,
        systemHintPreview: systemHint.slice(0, 100),
        claudeUsage: {
          inputTokens,
          outputTokens,
          totalTokens,
          costUSD
        }
      }
    })
  } catch (err) {
    console.error('[process-text] error:', err.message)

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

  const summary =
    sessions.get(req.params.id).getSummary?.() ?? {}

  return res.json({
    ok: true,
    sessionId: req.params.id,
    summary
  })
})

router.get('/metrics/:id', (req, res) => {
  const m = metricsStore.get(req.params.id)

  if (!m) {
    return res.status(404).json({
      error: 'metrics_not_found'
    })
  }

  return res.json(m)
})

router.get('/debug/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({
      error: 'session_not_found'
    })
  }

  const engine = sessions.get(req.params.id)

  return res.json({
    metrics: metricsStore.get(req.params.id),
    summary: engine.getSummary?.() ?? {},
    rings: engine.getRings?.() ?? []
  })
})

router.delete('/session/:id', (req, res) => {
  sessions.delete(req.params.id)
  metricsStore.delete(req.params.id)
  analysisStore.delete(req.params.id)

  return res.json({
    ok: true
  })
})

export default router
