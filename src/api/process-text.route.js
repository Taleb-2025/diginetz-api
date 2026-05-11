/**
 * CELF AI — /celf/process-text  (router v3.0)
 *
 * يعمل مع:
 *   CELF_Engine_AI_V5   — حلقات × دقة
 *   lightweight-parser  v2.1
 *   context-builder     v3.0
 *
 * التغييرات عن v2.0:
 *   - قراءة V5 snapshot (field, metrics, control, perturbation)
 *   - إصلاح bug: passToLLM كان = true دائماً
 *   - دعم image (base64) في الطلب
 *   - metrics محدّثة لـ V5
 */

import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse }              from '../utils/lightweight-parser.js'
import { build }              from '../utils/context-builder.js'

const router = express.Router()

// ─────────────────────────────────────────────
//  Session management — LRU Map, max 500
// ─────────────────────────────────────────────

const MAX_SESSIONS = 500
const sessions     = new Map()   // sessionId → CELF_Engine_AI_V5
const metricsStore = new Map()   // sessionId → metrics

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
    resolution:  360,
    ringCount:   5,
    cycle:       360,
    diffusionRate:   0.08,
    constraintRate:  0.12,
    attractorLimit:  12
  })

  sessions.set(sessionId, engine)
  return engine
}

// ─────────────────────────────────────────────
//  Intent helper — يقرأ من V5 perturbation
// ─────────────────────────────────────────────

function mapIntent(snapshot) {
  const s = snapshot?.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question)        return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error)           return 'complaint'
  if (s.emotional)       return 'emotional'
  return 'statement'
}

// ─────────────────────────────────────────────
//  feed() — parser + V5 engine + adapter
// ─────────────────────────────────────────────

async function feed(sessionId, text) {
  // Layer 1: noise + language gate
  const signals = parse(text)

  if (!signals.valid) {
    return { ok: false, reason: signals.reason ?? 'invalid_signals' }
  }

  // Layer 2: V5 engine
  const engine   = getEngine(sessionId)
  const snapshot = await engine.process(text)

  // ── V5 snapshot fields ────────────────────
  const field        = snapshot.field        ?? {}
  const metrics      = snapshot.metrics      ?? {}
  const control      = snapshot.control      ?? {}
  const perturbation = snapshot.perturbation ?? {}
  const attractors   = snapshot.attractors   ?? []

  // ── passToLLM — إصلاح الـ bug (كان = true دائماً) ──
  const coherence    = Number(field.coherence         ?? 0)
  const fieldStrength= Number(field.resonance         ?? 0)
  const resonance    = Number(field.resonance         ?? 0)
  const confidence   = Number(field.semanticGrounding ?? 0)
  const intent       = mapIntent(snapshot)

  const passToLLM =
    coherence     > 0.15 ||
    fieldStrength > 0.15 ||
    resonance     > 0.20 ||
    intent        === 'greeting' ||
    intent        === 'emotional' ||
    confidence    < 0.4    // sparse → LLM يطلب توضيحاً

  return {
    ok: true,
    passToLLM,
    signals,
    result: snapshot,
    // celfResult مُهيكَل لـ context-builder v3.0
    celfResult: {
      phase:       snapshot.phase,
      t:           snapshot.t,
      field,
      metrics,
      control,
      perturbation,
      attractors
    }
  }
}

// ─────────────────────────────────────────────
//  POST /process-text
// ─────────────────────────────────────────────

router.get('/process-text', (_req, res) => {
  res.json({
    ok:       true,
    endpoint: '/celf/process-text',
    method:   'POST',
    status:   'online',
    engine:   'CELF_Engine_AI_V5'
  })
})

router.post('/process-text', async (req, res) => {
  const {
    text      = '',
    sessionId,
    history   = [],
    image     = null,        // base64 string أو null — جديد
    imageMimeType = 'image/jpeg'
  } = req.body

  // نقبل إذا في نص أو صورة
  const hasText  = typeof text === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) {
    return res.status(400).json({ error: 'missing_input' })
  }

  const sid        = sessionId || 'default'
  const inputText  = hasText ? text : '(image)'   // نمرر للـ engine دائماً
  const processed  = await feed(sid, inputText)

  if (!processed.ok) {
    return res.status(422).json({
      error: processed.reason || 'processing_failed'
    })
  }

  // build context + systemHint
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

  // ── Call LLM ─────────────────────────────
  try {
    const systemHint = built.systemHint || ''

    // بناء محتوى الرسالة (نص + صورة)
    let userContent
    if (hasImage) {
      userContent = [
        {
          type:      'image_url',
          image_url: { url: `data:${imageMimeType};base64,${image}` }
        },
        ...(hasText ? [{ type: 'text', text }] : [])
      ]
    } else {
      userContent = text
    }

    // Metrics
    const historyChars    = history.reduce((s, h) => s + (h.content?.length || 0), 0)
    const rawInputChars   = text.length + historyChars
    const compressedChars = systemHint.length + text.length
    const compressionRatio = rawInputChars > 0
      ? Math.round((1 - compressedChars / rawInputChars) * 100)
      : 0

    // V5 metrics store
    metricsStore.set(sid, {
      sessionId:              sid,
      rawInputChars,
      compressedChars,
      compressionRatio,
      estimatedSystemTokens:  Math.ceil(systemHint.length / 4),
      // V5 fields
      phase:        processed.celfResult.phase                    ?? 'warmup',
      resonance:    processed.celfResult.field?.resonance         ?? 0,
      emergence:    processed.celfResult.field?.emergence         ?? 0,
      coherence:    processed.celfResult.field?.coherence         ?? 0,
      momentum:     processed.celfResult.field?.momentum          ?? 0,
      novelty:      processed.celfResult.field?.noveltyPressure   ?? 0,
      continuity:   processed.celfResult.field?.continuity        ?? 0,
      persistence:  processed.celfResult.field?.persistence       ?? 0,
      attractors:   processed.celfResult.attractors?.length       ?? 0,
      hasImage:     hasImage,
      updatedAt:    new Date().toISOString()
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
          { role: 'system',    content: systemHint },
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: 'user',      content: userContent }
        ]
      })
    })

    const data  = await response.json()
    const reply = data?.choices?.[0]?.message?.content ?? null

    // أعد حقن الرد في الـ engine (Feedback Loop)
    if (reply) {
      const engine = getEngine(sid)
      await engine.process(reply)   // Field Continuity Update
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

// ─────────────────────────────────────────────
//  GET /session/:id
// ─────────────────────────────────────────────

router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'session_not_found' })
  }

  const engine   = sessions.get(req.params.id)
  const summary  = engine.getSummary?.() ?? {}

  return res.json({
    ok:        true,
    sessionId: req.params.id,
    summary
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
  const summary = engine.getSummary?.() ?? {}

  return res.json({
    metrics,
    summary,
    rings: engine.getRings?.() ?? []
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
