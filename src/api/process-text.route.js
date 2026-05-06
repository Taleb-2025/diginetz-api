/**
 * CELF AI — /celf/process-text endpoint
 * Add to server.js: app.use('/celf', processTextRoute)
 * (already covered by existing /celf route mount)
 */

import express from 'express'
import { parse }              from '../utils/lightweight-parser.js'
import { feed, getSessionSummary, clearSession } from '../utils/celf-adapter.js'
import { build }              from '../utils/context-builder.js'

const router = express.Router()

// ─────────────────────────────────────────────
// POST /celf/process-text
// Body: { text, sessionId, history? }
// ─────────────────────────────────────────────
router.post('/process-text', async (req, res) => {
  const { text, sessionId, history = [] } = req.body

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'missing text' })
  }

  const sid = sessionId || 'default'

  // ── Step 1: Parse ──────────────────────────
  const signals = parse(text)

  // ── Step 2: CELF ───────────────────────────
  const adapterOutput = feed(sid, signals)

  // ── Step 3: Build Context ──────────────────
  const built = build(adapterOutput)

  // ── Step 4: Blocked? ──────────────────────
  if (built.blocked) {
    return res.status(422).json({
      blocked:    true,
      reason:     'anomaly_detected',
      context:    built.context
    })
  }

  // ── Step 5: Call Claude API ────────────────
  if (!built.passToLLM) {
    return res.json({
      reply:      null,
      skippedLLM: true,
      context:    built.context,
      reason:     'filtered_by_celf'
    })
  }

  try {
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: text }
    ]

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model:      'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: built.systemHint },
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: text }
        ]
      })
    })

    const data  = await response.json()
    const reply = data?.choices?.[0]?.message?.content ?? null

    return res.json({
      reply,
      context:    built.context,
      celf:       adapterOutput.celfResult,
      signals:    adapterOutput.signals
    })

  } catch (err) {
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  }
})

// ─────────────────────────────────────────────
// GET /celf/session/:id
// ─────────────────────────────────────────────
router.get('/session/:id', (req, res) => {
  const summary = getSessionSummary(req.params.id)
  if (!summary) return res.status(404).json({ error: 'session not found' })
  res.json(summary)
})

// ─────────────────────────────────────────────
// DELETE /celf/session/:id
// ─────────────────────────────────────────────
router.delete('/session/:id', (req, res) => {
  clearSession(req.params.id)
  res.json({ ok: true })
})

export default router
