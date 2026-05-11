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
      field, metrics, control, perturbation, attractors
    }
  }
}

// ── Claude API call ──────────────────────────
async function callClaude(systemHint, userContent, history, hasImage) {

  // بناء messages لـ Claude
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    {
      role: 'user',
      content: hasImage ? userContent : userContent
    }
  ]

  // صورة → content array
  let finalContent
  if (hasImage) {
    finalContent = userContent  // array جاهز
  } else {
    finalContent = typeof userContent === 'string' ? userContent : JSON.stringify(userContent)
  }

  const lastMessage = messages[messages.length - 1]
  lastMessage.content = finalContent

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
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
    throw new Error(`Claude API error: ${data?.error?.message ?? response.status}`)
  }

  return data?.content?.[0]?.text ?? null
}

// ─────────────────────────────────────────────
//  GET /process-text
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
//  POST /process-text
// ─────────────────────────────────────────────

router.post('/process-text', async (req, res) => {
  const {
    text          = '',
    sessionId,
    history       = [],
    image         = null,
    imageMimeType = 'image/jpeg'
  } = req.body

  const hasText  = typeof text === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) {
    return res.status(400).json({ error: 'missing_input' })
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

    // بناء userContent
    let userContent
    if (hasImage) {
      userContent = [
        {
          type:   'image',
          source: {
            type:       'base64',
            media_type: imageMimeType,
            data:       image
          }
        },
        ...(hasText ? [{ type: 'text', text }] : [])
      ]
    } else {
      userContent = text
    }

    // Metrics
    const historyChars     = history.reduce((s, h) => s + (h.content?.length || 0), 0)
    const rawInputChars    = text.length + historyChars
    const compressedChars  = systemHint.length + text.length
    const compressionRatio = rawInputChars > 0
      ? Math.round((1 - compressedChars / rawInputChars) * 100)
      : 0

    metricsStore.set(sid, {
      sessionId: sid,
      rawInputChars,
      compressedChars,
      compressionRatio,
      estimatedSystemTokens: Math.ceil(systemHint.length / 4),
      phase:       processed.celfResult.phase                  ?? 'warmup',
      resonance:   processed.celfResult.field?.resonance       ?? 0,
      coherence:   processed.celfResult.field?.coherence       ?? 0,
      novelty:     processed.celfResult.field?.noveltyPressure ?? 0,
      attractors:  processed.celfResult.attractors?.length     ?? 0,
      hasImage,
      llm:         'claude-haiku-4-5',
      updatedAt:   new Date().toISOString()
    })

    // استدعاء Claude
    const reply = await callClaude(systemHint, userContent, history, hasImage)

    // Feedback Loop
    if (reply) {
      const engine = getEngine(sid)
      await engine.process(reply)
    }

    return res.json({
      reply,
      context: built.context,
      signals: processed.signals,
      celf:    processed.result,
      metrics: {
        rawInputChars,
        compressedChars,
        compressionRatio,
        estimatedSystemTokens: Math.ceil(systemHint.length / 4)
      }
    })

  } catch (err) {
    console.error('[process-text] error:', err.message, err.stack)
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  }
})

router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'session_not_found' })
  }
  const engine  = sessions.get(req.params.id)
  const summary = engine.getSummary?.() ?? {}
  return res.json({ ok: true, sessionId: req.params.id, summary })
})

router.get('/metrics/:id', (req, res) => {
  const metrics = metricsStore.get(req.params.id)
  if (!metrics) return res.status(404).json({ error: 'metrics_not_found' })
  return res.json(metrics)
})

router.get('/debug/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'session_not_found' })
  }
  const engine  = sessions.get(req.params.id)
  const metrics = metricsStore.get(req.params.id)
  const summary = engine.getSummary?.() ?? {}
  return res.json({ metrics, summary, rings: engine.getRings?.() ?? [] })
})

router.delete('/session/:id', (req, res) => {
  sessions.delete(req.params.id)
  metricsStore.delete(req.params.id)
  return res.json({ ok: true })
})

export default router
