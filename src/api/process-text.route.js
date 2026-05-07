/**
 * CELF AI — /celf/process-text
 */

import express from 'express'

import { CELF_Engine_AI }
from '../engines/celf-engine.js'

import { parse }
from '../utils/lightweight-parser.js'

import { build }
from '../utils/context-builder.js'

const router =
  express.Router()

const MAX_SESSIONS =
  500

const sessions =
  new Map()

const metricsStore =
  new Map()

function getEngine(sessionId) {

  if (sessions.has(sessionId)) {

    const engine =
      sessions.get(sessionId)

    sessions.delete(sessionId)

    sessions.set(sessionId, engine)

    return engine
  }

  if (sessions.size >= MAX_SESSIONS) {

    const oldest =
      sessions.keys().next().value

    sessions.delete(oldest)
  }

  const engine =
    new CELF_Engine_AI()

  sessions.set(sessionId, engine)

  return engine
}

function feed(sessionId, text) {

  const signals =
    parse(text)

  if (!signals.valid) {

    return {
      ok: false,
      reason: 'invalid_signals'
    }
  }

  const engine =
    getEngine(sessionId)

  const result =
    engine.process(text)

  const refined =
    result?.refined ?? {}

  const coherence =
    Number(
      refined?.refinedCoherence ?? 0
    )

  const fieldStrength =
    Number(
      refined?.refinedField ?? 0
    )

  const passToLLM =

    coherence > 0.15 ||

    fieldStrength > 0.15 ||

    signals.intent === 'greeting'

  return {

    ok: true,

    passToLLM,

    signals,

    result
  }
}

router.post(
  '/process-text',

  async (req, res) => {

    const {
      text,
      sessionId,
      history = []
    } = req.body

    if (
      !text ||
      typeof text !== 'string'
    ) {

      return res.status(400).json({
        error: 'missing_text'
      })
    }

    const sid =
      sessionId || 'default'

    const processed =
      feed(sid, text)

    if (!processed.ok) {

      return res.status(422).json({

        error:
          processed.reason || 'processing_failed'
      })
    }

    const built =
      build({

        ok: true,

        signals:
          processed.signals,

        celfResult: {

          phase:
            processed.result?.relation?.relation ||
            'emergent',

          confidence:
            processed.result?.refined?.refinedCoherence || 0,

          maturityScore:
            processed.result?.attractor?.attractorStability || 0,

          impossible:
            false,

          aliveRatio:
            processed.result?.convergence?.fieldConvergence || 0
        },

        passToLLM:
          processed.passToLLM
      })

    if (built.blocked) {

      return res.status(422).json({

        blocked: true,

        reason:
          'semantic_constraint',

        context:
          built.context
      })
    }

    if (!built.passToLLM) {

      return res.json({

        reply: null,

        skippedLLM: true,

        reason:
          'weak_semantic_field',

        context:
          built.context,

        celf:
          processed.result
      })
    }

    try {

      const systemHint =
        built.systemHint || ''

      const systemTokensEstimate =
        Math.ceil(
          systemHint.length / 4
        )

      const historyChars =
        history.reduce(
          (s, h) =>
            s +
            (
              h.content?.length || 0
            ),
          0
        )

      const rawInputChars =
        text.length + historyChars

      const compressedChars =
        systemHint.length +
        text.length

      const compressionRatio =
        rawInputChars > 0

          ? Math.round(
              (
                1 -
                (
                  compressedChars /
                  rawInputChars
                )
              ) * 100
            )

          : 0

      metricsStore.set(sid, {

        sessionId:
          sid,

        rawInputChars,

        compressedChars,

        compressionRatio,

        estimatedSystemTokens:
          systemTokensEstimate,

        updatedAt:
          new Date().toISOString()
      })

      const response =
        await fetch(
          'https://api.groq.com/openai/v1/chat/completions',
          {

            method: 'POST',

            headers: {

              'Content-Type':
                'application/json',

              'Authorization':
                `Bearer ${process.env.GROQ_API_KEY}`
            },

            body: JSON.stringify({

              model:
                'llama-3.3-70b-versatile',

              max_tokens:
                1024,

              messages: [

                {
                  role: 'system',
                  content: systemHint
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

      const data =
        await response.json()

      const reply =
        data?.choices?.[0]
          ?.message?.content ?? null

      return res.json({

        reply,

        context:
          built.context,

        celf:
          processed.result,

        metrics: {

          rawInputChars,

          compressedChars,

          compressionRatio,

          estimatedSystemTokens:
            systemTokensEstimate
        }
      })

    } catch (err) {

      return res.status(500).json({

        error:
          'llm_failed',

        detail:
          err.message
      })
    }
  }
)

router.get(
  '/session/:id',

  (req, res) => {

    if (
      !sessions.has(req.params.id)
    ) {

      return res.status(404).json({
        error: 'session_not_found'
      })
    }

    const engine =
      sessions.get(req.params.id)

    return res.json({

      ok: true,

      sessionId:
        req.params.id,

      fieldCount:
        engine.space?.fields?.length ?? 0,

      latestField:
        engine.previousField ?? null
    })
  }
)

router.get(
  '/metrics/:id',

  (req, res) => {

    const metrics =
      metricsStore.get(
        req.params.id
      )

    if (!metrics) {

      return res.status(404).json({
        error: 'metrics_not_found'
      })
    }

    return res.json(metrics)
  }
)

router.delete(
  '/session/:id',

  (req, res) => {

    sessions.delete(req.params.id)

    metricsStore.delete(req.params.id)

    return res.json({
      ok: true
    })
  }
)

export default router
