/**
 * CELF AI — /celf/process-text endpoint
 * Add to server.js: app.use('/celf', processTextRoute)
 */

import express from 'express'
import { parse } from '../utils/lightweight-parser.js'
import { build } from '../utils/context-builder.js'
import { CELF_Engine_V8 } from '../engines/CELF_Engine_V8.js'

const router = express.Router()

// ─────────────────────────────────────────────
// Session Engine Pool (adapter inlined)
// ─────────────────────────────────────────────
const MAX_SESSIONS = 500

const sessions = new Map()

// ─────────────────────────────────────────────
// Metrics Store
// ─────────────────────────────────────────────
const metricsStore = new Map()

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
  }

  const engine = new CELF_Engine_V8({
    resolution:      200,
    cycle:           1000,
    windowSize:      64,
    thresholdFactor: 2.2,
    decayRate:       0.995,
    reinforceRate:   0.05,
    eliminationRate: 0.20
  })

  sessions.set(sessionId, engine)

  return engine
}

function feed(sessionId, signals) {

  if (!signals.valid) {
    return {
      ok: false,
      reason: 'invalid_signals',
      passToLLM: false,
      celfResult: null
    }
  }

  const engine = getEngine(sessionId)

  const result = engine.observe(signals.numeric)

  const passToLLM =
    signals.intent === 'greeting'
      ? true
      : result.phase === 'warmup'
        ? true
        : result.impossible && result.confidence < 0.3
          ? false
          : true

  return {
    ok: true,
    passToLLM,
    signals,
    celfResult: result
  }
}

// ─────────────────────────────────────────────
// POST /celf/process-text
// Body: { text, sessionId, history? }
// ─────────────────────────────────────────────
router.post('/process-text', async (req, res) => {

  const { text, sessionId, history = [] } = req.body

  if (!text || typeof text !== 'string') {
    return res.status(400).json({
      error: 'missing text'
    })
  }

  const sid = sessionId || 'default'

  const signals       = parse(text)
  const adapterOutput = feed(sid, signals)
  const built         = build(adapterOutput)

  // ─────────────────────────────────────────────
  // Blocked by CELF
  // ─────────────────────────────────────────────
  if (built.blocked) {

    return res.status(422).json({
      blocked: true,
      reason: 'anomaly_detected',
      context: built.context
    })
  }

  // ─────────────────────────────────────────────
  // Filtered before LLM
  // ─────────────────────────────────────────────
  if (!built.passToLLM) {

    return res.json({
      reply: null,
      skippedLLM: true,
      context: built.context,
      reason: 'filtered_by_celf'
    })
  }

  try {

    // ─────────────────────────────────────────────
    // Prompt Size Metrics
    // ─────────────────────────────────────────────
    const systemTokensEstimate =
      Math.ceil((built.systemHint?.length || 0) / 4)

    const historyChars =
      history.reduce(
        (s, h) => s + (h.content?.length || 0),
        0
      )

    const rawInputChars =
      text.length + historyChars

    const compressedChars =
      (built.systemHint?.length || 0) + text.length

    const compressionRatio =
      rawInputChars > 0
        ? Math.round(
            (1 - (compressedChars / rawInputChars)) * 100
          )
        : 0

    // ─────────────────────────────────────────────
    // Save Metrics
    // ─────────────────────────────────────────────
    metricsStore.set(sid, {
      sessionId: sid,
      rawInputChars,
      compressedChars,
      compressionRatio,
      estimatedSystemTokens: systemTokensEstimate,
      updatedAt: new Date().toISOString()
    })

    console.log({
      sessionId: sid,
      rawInputChars,
      compressedChars,
      compressionRatio,
      estimatedSystemTokens: systemTokensEstimate
    })

    // ─────────────────────────────────────────────
    // LLM Request
    // ─────────────────────────────────────────────
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Authorization':
            `Bearer ${process.env.GROQ_API_KEY}`
        },

        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',

          max_tokens: 1024,

          messages: [

            {
              role: 'system',
              content: built.systemHint
            },

            ...history.map(h => ({
              role: h.role,
              content: h.content
            })),

            {
              role: 'user',
              content: text
            }
          ]
        })
      }
    )

    const data  = await response.json()

    const reply =
      data?.choices?.[0]?.message?.content ?? null

    return res.json({

      reply,

      context: built.context,

      celf: adapterOutput.celfResult,

      signals: adapterOutput.signals,

      metrics: {
        rawInputChars,
        compressedChars,
        compressionRatio,
        estimatedSystemTokens: systemTokensEstimate
      }
    })

  } catch (err) {

    return res.status(500).json({
      error: 'llm_failed',
      detail: err.message
    })
  }
})

// ─────────────────────────────────────────────
// GET /celf/session/:id
// ─────────────────────────────────────────────
router.get('/session/:id', (req, res) => {

  if (!sessions.has(req.params.id)) {

    return res.status(404).json({
      error: 'session not found'
    })
  }

  res.json(
    sessions.get(req.params.id).getSummary()
  )
})

// ─────────────────────────────────────────────
// GET /celf/metrics/:id
// ─────────────────────────────────────────────
router.get('/metrics/:id', (req, res) => {

  const metrics =
    metricsStore.get(req.params.id)

  if (!metrics) {

    return res.status(404).json({
      error: 'metrics not found'
    })
  }

  res.json(metrics)
})

// ─────────────────────────────────────────────
// DELETE /celf/session/:id
// ─────────────────────────────────────────────
router.delete('/session/:id', (req, res) => {

  sessions.delete(req.params.id)

  metricsStore.delete(req.params.id)

  res.json({
    ok: true
  })
})

export default router
