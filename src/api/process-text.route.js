/**
 * CELF AI — /celf/process-text  (router v2.0)
 *
 * يعمل مع:
 *   CELF_Engine_AI v4
 *   lightweight-parser v2
 *   context-builder v2
 */

import express from 'express'
import { CELF_Engine_AI } from '../engines/celf-engine.js'
import { parse }           from '../utils/lightweight-parser.js'
import { build }           from '../utils/context-builder.js'

const router = express.Router()

// ─────────────────────────────────────────────
//  Session management — LRU Map, max 500
// ─────────────────────────────────────────────

const MAX_SESSIONS = 500
const sessions     = new Map()   // sessionId → CELF_Engine_AI
const metricsStore = new Map()   // sessionId → metrics

function getEngine(sessionId) {
  if (sessions.has(sessionId)) {
    // LRU refresh: move to end
    const engine = sessions.get(sessionId)
    sessions.delete(sessionId)
    sessions.set(sessionId, engine)
    return engine
  }

  if (sessions.size >= MAX_SESSIONS) {
    // Evict oldest
    sessions.delete(sessions.keys().next().value)
  }

  const engine = new CELF_Engine_AI()
  sessions.set(sessionId, engine)
  return engine
}

// ─────────────────────────────────────────────
//  feed() — runs parser + engine + adapter
// ─────────────────────────────────────────────

function feed(sessionId, text) {
  // Layer 1: noise + language gate (lightweight-parser)
  const signals = parse(text)

  if (!signals.valid) {
    return { ok: false, reason: signals.reason ?? 'invalid_signals' }
  }

  // Layer 2: full semantic processing (CELF Engine v4)
  const engine = getEngine(sessionId)
  const result = engine.process(text)

  // ── Read v4 fields correctly ──────────────────
  const refined      = result?.refined      ?? {}
  const semanticField = result?.semanticField ?? {}
  const signature    = result?.signature    ?? {}
  const attractor    = result?.attractor    ?? {}
  const reprojection = result?.reprojection ?? {}
  const trajectory   = result?.trajectory   ?? {}
  const reduction    = result?.reduction    ?? {}
  const projection   = result?.projection   ?? {}

  // passToLLM decision using v4 signals
  const coherence      = Number(refined?.refinedCoherence   ?? 0)
  const fieldStrength  = Number(refined?.refinedField        ?? 0)
  const resonance      = Number(signature?.resonanceSignature ?? 0)
  const intent         = semanticField?.intent ?? 'statement'
  const confidence     = Number(semanticField?.confidence    ?? 1)

  const passToLLM = 
    coherence     > 0.15 ||
    fieldStrength > 0.15 ||
    resonance     > 0.20 ||
    intent        === 'greeting' ||
    confidence    < 0.4    // sparse input still passes — needs LLM clarification

  return {
    ok: true,
    passToLLM,
    signals,
    result,
    // Structured celfResult for context-builder (v4 fields)
    celfResult: {
      semanticField,
      attractor,
      signature,
      reprojection,
      trajectory,
      reduction,
      projection,
      refined
    }
  }
}

// ─────────────────────────────────────────────
//  POST /process-text
// ─────────────────────────────────────────────

router.post('/process-text', async (req, res) => {
  const { text, sessionId, history = [] } = req.body

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'missing_text' })
  }

  const sid      = sessionId || 'default'
  const processed = feed(sid, text)

  if (!processed.ok) {
    return res.status(422).json({
      error: processed.reason || 'processing_failed'
    })
  }

  // Build context + systemHint from v4 output
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

  if (!built.passToLLM) {
    return res.json({
      reply:      null,
      skippedLLM: true,
      reason:     'weak_semantic_field',
      context:    built.context,
      celf:       processed.result
    })
  }

  // ── Call LLM ────────────────────────────────
  try {
    const systemHint = built.systemHint || ''

    // Metrics
    const historyChars   = history.reduce((s, h) => s + (h.content?.length || 0), 0)
    const rawInputChars  = text.length + historyChars
    const compressedChars = systemHint.length + text.length
    const compressionRatio = rawInputChars > 0
      ? Math.round((1 - compressedChars / rawInputChars) * 100)
      : 0

    metricsStore.set(sid, {
      sessionId:               sid,
      rawInputChars,
      compressedChars,
      compressionRatio,
      estimatedSystemTokens:   Math.ceil(systemHint.length / 4),
      // v4 extras
      resonance:               processed.celfResult.signature?.resonanceSignature ?? 0,
      emergence:               processed.celfResult.reprojection?.emergence       ?? 0,
      trajPattern:             processed.celfResult.trajectory?.pattern           ?? null,
      phase:                   built.context?.phase                               ?? 'warmup',
      updatedAt:               new Date().toISOString()
    })

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
          { role: 'system', content: systemHint },
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: text }
        ]
      })
    })

    const data  = await response.json()
    const reply = data?.choices?.[0]?.message?.content ?? null

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
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  }
})

// ─────────────────────────────────────────────
//  GET /session/:id
// ─────────────────────────────────────────────

router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'session_not_found' })
  }

  const engine = sessions.get(req.params.id)

  return res.json({
    ok:          true,
    sessionId:   req.params.id,
    fieldCount:  engine.space?.fields?.length ?? 0,
    // v4 trajectory
    trajectory:  engine.getTrajectorySnapshot?.() ?? null
  })
})

// ─────────────────────────────────────────────
//  GET /metrics/:id
// ─────────────────────────────────────────────

router.get('/metrics/:id', (req, res) => {
  const metrics = metricsStore.get(req.params.id)
  if (!metrics) return res.status(404).json({ error: 'metrics_not_found' })
  return res.json(metrics)
})

// ─────────────────────────────────────────────
//  GET /debug/:id
// ─────────────────────────────────────────────

router.get('/debug/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'session_not_found' })
  }

  const engine  = sessions.get(req.params.id)
  const metrics = metricsStore.get(req.params.id)
  const space   = engine.getSpace?.() ?? {}
  const ctx     = engine.getContext?.() ?? {}

  // Pull latest entries from aligned arrays
  const lastIdx    = (space.fields?.length ?? 1) - 1
  const lastField  = space.fields?.[lastIdx]      ?? {}
  const lastSig    = space.signatures?.[lastIdx]  ?? {}
  const lastAttr   = space.attractors?.[lastIdx]  ?? {}
  const lastRepr   = ctx.lastReprojection          ?? {}

  return res.json({
    metrics,
    totalFields: space.fields?.length ?? 0,
    // v4 runtime snapshot
    runtime: {
      // Semantic field
      intent:          lastField.intent           ?? null,
      reasoningMode:   lastField.reasoningMode    ?? null,
      coherence:       lastField.coherence        ?? 0,
      entropy:         lastField.entropy          ?? 0,
      drift:           lastField.drift            ?? 0,
      driftAcceleration: lastField.driftAcceleration ?? 0,
      confidence:      lastField.confidence       ?? 1,
      // Attractor
      attractorStability:   lastAttr.attractorStability   ?? 0,
      convergencePotential: lastAttr.convergencePotential ?? 0,
      // Signature
      resonance:       lastSig.resonanceSignature ?? 0,
      // Reprojection [F3]
      emergence:       lastRepr.emergence         ?? 0,
      reprDelta:       lastRepr.delta             ?? 0,
      // Trajectory [F2]
      trajSpeed:       ctx.lastReprojection?.trajAlignment ?? 0,
      trajPattern:     engine.trajectory?.pattern         ?? null
    }
  })
})

// ─────────────────────────────────────────────
//  DELETE /session/:id
// ─────────────────────────────────────────────

router.delete('/session/:id', (req, res) => {
  sessions.delete(req.params.id)
  metricsStore.delete(req.params.id)
  return res.json({ ok: true })
})

export default router
