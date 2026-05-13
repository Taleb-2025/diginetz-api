/**
 * CELF AI — /celf/process-text (router v5.1)
 * Fixes:
 *  - systemHint hard cap 400 chars
 *  - assistant history 400 chars, user 200 chars
 *  - question replay: last user + last assistant
 *  - image size protection
 *  - Claude timeout 25s
 *  - concurrent request protection per session
 *  - hallucination guard: sourceWeight 0.15
 */

import express from 'express'
import { CELF_Engine_AI_V5 } from '../engines/celf-engine-v5.js'
import { parse }              from '../utils/lightweight-parser.js'
import { build }              from '../utils/context-builder.js'
import { analyze }            from '../utils/response-analyzer.js'

const router          = express.Router()
const MAX_SESSIONS    = 500
const sessions        = new Map()
const metricsStore    = new Map()
const analysisStore   = new Map()
const processingLock  = new Set()   // concurrent request guard

// ── Session LRU ──────────────────────────────
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

// ── Intent ───────────────────────────────────
function mapIntent(snapshot) {
  const s = snapshot?.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question)        return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error)           return 'complaint'
  if (s.emotional)       return 'emotional'
  return 'statement'
}



// ── feed() ───────────────────────────────────
function feed(sessionId, text) {
  const signals = parse(text)
  if (!signals.valid) {
    return { ok: false, reason: signals.reason ?? 'invalid_signals' }
  }

  const engine   = getEngine(sessionId)
  const snapshot = engine.process(text)   // sync — no await

  const field        = snapshot.field        ?? {}
  const metrics      = snapshot.metrics      ?? {}
  const control      = snapshot.control      ?? {}
  const perturbation = snapshot.perturbation ?? {}
  const attractors   = snapshot.attractors   ?? []

  const coherence  = Number(field.coherence         ?? 0)
  const resonance  = Number(field.resonance         ?? 0)
  const confidence = Number(field.semanticGrounding ?? 0)
  const intent     = mapIntent(snapshot)

  const passToLLM =
    coherence  > 0.15 ||
    resonance  > 0.20 ||
    intent     === 'greeting' ||
    intent     === 'emotional' ||
    confidence < 0.4

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

// ── Token estimator ─────────────────────────
// Better than char/4 — accounts for code density
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0
  const codeBlocks = (text.match(/```[\s\S]*?```/g) ?? [])
  const codeChars  = codeBlocks.reduce((s, b) => s + b.length, 0)
  const textChars  = text.length - codeChars
  // Code is denser: ~3 chars/token. Text: ~4 chars/token
  return Math.ceil(codeChars / 3) + Math.ceil(textChars / 4)
}

// ── Adaptive history ─────────────────────────
// Budget-aware: fills available space intelligently
function adaptiveHistory(history = [], intent = 'question', tokenBudget = 800) {
  if (!Array.isArray(history) || history.length === 0) return []

  const clean = history
    .filter(h =>
      h &&
      (h.role === 'user' || h.role === 'assistant') &&
      typeof h.content === 'string' &&
      h.content.length > 0
    )

  if (intent === 'greeting' || intent === 'emotional') return []

  // Fill from most recent — stop when budget exceeded
  const selected = []
  let usedTokens  = 0
  const maxTokens = Math.min(tokenBudget, 600)

  for (let i = clean.length - 1; i >= 0; i--) {
    const h      = clean[i]
    const tokens = estimateTokens(h.content)

    if (usedTokens + tokens > maxTokens) break

    selected.unshift(h)
    usedTokens += tokens
  }

  // Trim content to fit — never cut mid-sentence
  return selected.map(h => {
    const maxChars = h.role === 'assistant' ? 1200 : 600
    if (h.content.length <= maxChars) return h
    const trimmed = h.content.slice(0, maxChars)
    const lastPeriod = Math.max(
      trimmed.lastIndexOf('.'),
      trimmed.lastIndexOf('
'),
      trimmed.lastIndexOf('```')
    )
    return {
      role:    h.role,
      content: lastPeriod > maxChars * 0.6
        ? trimmed.slice(0, lastPeriod + 1)
        : trimmed
    }
  })
}

// ── Payload protection ────────────────────────
function checkPayload(systemHint, messages) {
  const size = JSON.stringify({ system: systemHint, messages }).length
  if (size > 25000) throw new Error('prompt_too_large')
  return size
}

// ── Claude fetch with timeout ─────────────────
async function fetchClaude(body, timeoutMs = 25000) {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

// ── GET ──────────────────────────────────────
router.get('/process-text', (_req, res) => {
  res.json({
    ok:      true,
    status:  'online',
    engine:  'CELF_Engine_AI_V5',
    llm:     'Claude Haiku 4.5',
    version: '5.2'
  })
})

// ── POST ─────────────────────────────────────
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

  // Image size protection — base64 > 5MB rejected
  if (hasImage && image.length > 5_000_000) {
    return res.status(413).json({ error: 'image_too_large', maxBytes: 5_000_000 })
  }

  const sid = sessionId || 'default'

  // Concurrent request protection
  if (processingLock.has(sid)) {
    return res.status(429).json({ error: 'request_in_progress', retry: true })
  }
  processingLock.add(sid)

  try {
    const inputText = hasText ? text : '(image)'
    const processed = feed(sid, inputText)

    if (!processed.ok) {
      return res.status(422).json({ error: processed.reason || 'processing_failed' })
    }

    // Read field topology from engine
    const engine       = getEngine(sid)
    const fieldPrompt  = engine.buildFieldPrompt?.() ?? null
    const prevAnalysis = analysisStore.get(sid) ?? null

    const built = build({
      ok:             true,
      signals:        processed.signals,
      celfResult:     processed.celfResult,
      passToLLM:      processed.passToLLM,
      structuralHint: prevAnalysis?.structuralHint ?? null,
      prevMaxTokens:  prevAnalysis?.nextMaxTokens  ?? null,
      fieldPrompt,
      prevAnalysis
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

    // systemHint hard cap — max 400 chars (~100 tokens)
    const rawHint    = built.systemHint || ''
    const systemHint = rawHint.slice(0, 400)

    const intent        = built.context?.intent ?? 'question'
    // Dynamic output reserve — code needs more space
    const baseMax = built.maxTokens ?? 400
    const outputReserve = intent === 'command'   ? 1600
                        : intent === 'question'  ? 800
                        : intent === 'complaint' ? 1000
                        : 600
    const maxTokens = Math.min(Math.max(baseMax, outputReserve), 2000)

    // Adaptive history — token-budget aware
    const historyBudget = Math.max(200, 4000 - maxTokens - 200)
    const prunedHistory = adaptiveHistory(history, intent, historyBudget)

    // Build user content
    let userContent
    if (hasImage) {
      userContent = [
        {
          type:   'image',
          source: { type: 'base64', media_type: imageMimeType, data: image }
        },
        ...(hasText ? [{ type: 'text', text }] : [])
      ]
    } else {
      userContent = text
    }

    const messages = [
      ...prunedHistory,
      { role: 'user', content: userContent }
    ]

    // Payload protection
    let payloadSize = 0
    try {
      payloadSize = checkPayload(systemHint, messages)
    } catch (e) {
      return res.status(413).json({ error: 'prompt_too_large', detail: e.message })
    }

    // Claude call with 25s timeout
    let claudeData
    try {
      const claudeResponse = await fetchClaude({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system:     systemHint,
        messages
      })

      claudeData = await claudeResponse.json()

      if (!claudeResponse.ok) {
        throw new Error(`Claude error: ${ claudeData?.error?.message ?? claudeResponse.status }`)
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'claude_timeout', detail: 'Request exceeded 25s' })
      }
      throw err
    }

    const reply        = claudeData?.content?.[0]?.text ?? null
    const usage        = claudeData?.usage ?? {}
    const inputTokens  = usage.input_tokens  ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const costUSD      = parseFloat((
      (inputTokens  / 1_000_000 * 1.00) +
      (outputTokens / 1_000_000 * 5.00)
    ).toFixed(6))

    // Feedback Loop — hallucination guard: weight 0.15
    if (reply) {
      const fieldBefore = processed.celfResult.field
      engine.process(reply, 0.15)   // low weight — stabilize only
      const fieldAfter = engine.buildFieldPrompt?.() ?? {}

      const analysis = analyze({
        reply,
        fieldBefore,
        fieldAfter,
        maxTokens
      })

      analysisStore.set(sid, analysis)
    }

    // Store real metrics
    metricsStore.set(sid, {
      sessionId:     sid,
      inputTokens,
      outputTokens,
      totalTokens:   inputTokens + outputTokens,
      costUSD,
      maxTokens,
      payloadSize,
      prunedHistory: prunedHistory.length,
      intent,
      phase:         processed.celfResult.phase ?? 'warmup',
      fieldZone:     fieldPrompt?.zone      ?? null,
      fieldStyle:    fieldPrompt?.style     ?? null,
      continuity:    fieldPrompt?.continuity ?? 0,
      updatedAt:     new Date().toISOString()
    })

    return res.json({
      reply,
      context: built.context,
      signals: processed.signals,
      celf:    processed.result,
      wave:    analysisStore.get(sid)?.wave ?? null,
      metrics: {
        inputTokens,
        outputTokens,
        totalTokens:   inputTokens + outputTokens,
        costUSD,
        maxTokens,
        prunedHistory: prunedHistory.length,
        payloadSize,
        systemHintPreview: systemHint.slice(0, 120)
      }
    })

  } catch (err) {
    console.error('[process-text] error:', err.message)
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  } finally {
    processingLock.delete(sid)   // always release lock
  }
})

// ── Session / Metrics / Debug / Delete ───────
router.get('/session/:id', (req, res) => {
  if (!sessions.has(req.params.id))
    return res.status(404).json({ error: 'session_not_found' })
  const summary = sessions.get(req.params.id).getSummary?.() ?? {}
  return res.json({ ok: true, sessionId: req.params.id, summary })
})

router.get('/metrics/:id', (req, res) => {
  const m = metricsStore.get(req.params.id)
  if (!m) return res.status(404).json({ error: 'metrics_not_found' })
  return res.json(m)
})

router.get('/debug/:id', (req, res) => {
  if (!sessions.has(req.params.id))
    return res.status(404).json({ error: 'session_not_found' })
  const engine = sessions.get(req.params.id)
  return res.json({
    metrics:     metricsStore.get(req.params.id),
    summary:     engine.getSummary?.()        ?? {},
    fieldPrompt: engine.buildFieldPrompt?.()  ?? {},
    analysis:    analysisStore.get(req.params.id) ?? null
  })
})

router.delete('/session/:id', (req, res) => {
  sessions.delete(req.params.id)
  metricsStore.delete(req.params.id)
  analysisStore.delete(req.params.id)
  processingLock.delete(req.params.id)
  return res.json({ ok: true })
})

export default router
