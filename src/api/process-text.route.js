import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse } from '../utils/lightweight-parser.js'
import { build } from '../utils/context-builder.js'
import { analyze } from '../utils/response-analyzer.js'

const router = express.Router()

const MAX_SESSIONS = 150
const sessions = new Map()
const metricsStore = new Map()
const analysisStore = new Map()
const processingLock = new Set()

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
    return {
      ok: false,
      reason: signals.reason ?? 'invalid_signals'
    }
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

function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0

  const codeBlocks = text.match(/```[\s\S]*?```/g) ?? []

  const codeChars = codeBlocks.reduce((s, b) => s + b.length, 0)
  const textChars = text.length - codeChars

  return Math.ceil(codeChars / 3) + Math.ceil(textChars / 4)
}

function adaptiveHistory(history = [], intent = 'question', tokenBudget = 800) {
  if (!Array.isArray(history) || history.length === 0) {
    return []
  }

  if (intent === 'greeting' || intent === 'emotional') {
    return []
  }

  const clean = history.filter(h =>
    h &&
    (h.role === 'user' || h.role === 'assistant') &&
    typeof h.content === 'string' &&
    h.content.length > 0
  )

  const selected = []

  let usedTokens = 0
  const maxTokens = Math.min(tokenBudget, 500)

  for (let i = clean.length - 1; i >= 0; i--) {
    const h = clean[i]
    const tokens = estimateTokens(h.content)

    if (usedTokens + tokens > maxTokens) break

    selected.unshift(h)
    usedTokens += tokens
  }

  return selected.map(h => {
    const maxChars = h.role === 'assistant' ? 800 : 400

    if (h.content.length <= maxChars) {
      return h
    }

    const trimmed = h.content.slice(0, maxChars)

    const lastBoundary = Math.max(
      trimmed.lastIndexOf('.'),
      trimmed.lastIndexOf('\n'),
      trimmed.lastIndexOf('```')
    )

    return {
      role: h.role,
      content:
        lastBoundary > maxChars * 0.6
          ? trimmed.slice(0, lastBoundary + 1)
          : trimmed
    }
  })
}

function checkPayload(systemHint, messages) {
  const size = JSON.stringify({
    system: systemHint,
    messages
  }).length

  if (size > 18000) {
    throw new Error('prompt_too_large')
  }

  return size
}

async function fetchClaude(body, timeoutMs = 20000) {
  const controller = new AbortController()

  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

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

router.get('/process-text', (_req, res) => {
  res.json({
    ok: true,
    status: 'online',
    engine: 'CELF_Engine_AI_V5',
    llm: 'Claude Haiku 4.5',
    version: '5.3'
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

  if (hasImage && image.length > 5_000_000) {
    return res.status(413).json({
      error: 'image_too_large',
      maxBytes: 5_000_000
    })
  }

  const sid = sessionId || 'default'

  if (processingLock.has(sid)) {
    return res.status(429).json({
      error: 'request_in_progress',
      retry: true
    })
  }

  processingLock.add(sid)

  try {
    const inputText = hasText ? text : '(image)'

    const processed = feed(sid, inputText)

    if (!processed.ok) {
      return res.status(422).json({
        error: processed.reason || 'processing_failed'
      })
    }

    const engine = getEngine(sid)

    const fieldPrompt =
      engine.buildFieldPrompt?.() ?? null

    const prevAnalysis =
      analysisStore.get(sid) ?? null

    const built = build({
      ok: true,
      signals: processed.signals,
      celfResult: processed.celfResult,
      passToLLM: processed.passToLLM,
      structuralHint:
        prevAnalysis?.structuralHint ?? null,
      prevMaxTokens:
        prevAnalysis?.nextMaxTokens ?? null,
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
        reason: 'weak_semantic_field'
      })
    }

    const rawHint = built.systemHint || ''
    const systemHint = rawHint.slice(0, 300)

    const intent =
      built.context?.intent ?? 'question'

    const baseMax =
      built.maxTokens ?? 400

    const outputReserve =
      intent === 'command'
        ? 1200
        : intent === 'question'
        ? 700
        : intent === 'complaint'
        ? 900
        : 500

    const maxTokens = Math.min(
      Math.max(baseMax, outputReserve),
      1400
    )

    const historyBudget = Math.max(
      150,
      3000 - maxTokens
    )

    const prunedHistory = adaptiveHistory(
      history,
      intent,
      historyBudget
    )

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
        ...(hasText
          ? [{ type: 'text', text }]
          : [])
      ]
    } else {
      userContent = text
    }

    const messages = [
      ...prunedHistory,
      {
        role: 'user',
        content: userContent
      }
    ]

    let payloadSize = 0

    try {
      payloadSize = checkPayload(
        systemHint,
        messages
      )
    } catch (e) {
      return res.status(413).json({
        error: 'prompt_too_large',
        detail: e.message
      })
    }

    let claudeData

    try {
      const claudeResponse = await fetchClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: systemHint,
        messages
      })

      claudeData = await claudeResponse.json()

      if (!claudeResponse.ok) {
        throw new Error(
          `Claude error: ${
            claudeData?.error?.message ??
            claudeResponse.status
          }`
        )
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({
          error: 'claude_timeout'
        })
      }

      throw err
    }

    const reply =
      claudeData?.content?.[0]?.text ?? null

    const usage = claudeData?.usage ?? {}

    const inputTokens =
      usage.input_tokens ?? 0

    const outputTokens =
      usage.output_tokens ?? 0

    const costUSD = parseFloat(
      (
        (inputTokens / 1_000_000) * 1.0 +
        (outputTokens / 1_000_000) * 5.0
      ).toFixed(6)
    )

    if (reply) {
      const fieldBefore =
        processed.celfResult.field

      const fieldAfter =
        engine.buildFieldPrompt?.() ?? {}

      const analysis = analyze({
        reply,
        fieldBefore,
        fieldAfter,
        maxTokens
      })

      analysisStore.set(sid, analysis)
    }

    metricsStore.set(sid, {
      sessionId: sid,
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens + outputTokens,
      costUSD,
      maxTokens,
      payloadSize,
      prunedHistory:
        prunedHistory.length,
      intent,
      phase:
        processed.celfResult.phase ??
        'warmup',
      updatedAt: new Date().toISOString()
    })

    return res.json({
      reply,
      metrics: {
        inputTokens,
        outputTokens,
        totalTokens:
          inputTokens + outputTokens,
        costUSD,
        maxTokens,
        prunedHistory:
          prunedHistory.length,
        payloadSize
      }
    })
  } catch (err) {
    console.error(
      '[process-text] error:',
      err.message
    )

    return res.status(500).json({
      error: 'llm_failed',
      detail: err.message
    })
  } finally {
    processingLock.delete(sid)
  }
})

router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({
      error: 'session_not_found'
    })
  }

  const summary =
    sessions.get(req.params.id)
      .getSummary?.() ?? {}

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

router.delete('/session/:id', (req, res) => {
  sessions.delete(req.params.id)
  metricsStore.delete(req.params.id)
  analysisStore.delete(req.params.id)
  processingLock.delete(req.params.id)

  return res.json({
    ok: true
  })
})

export default router
