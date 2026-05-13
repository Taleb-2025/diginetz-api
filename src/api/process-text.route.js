function isTruncated(claudeData) {
  return claudeData?.stop_reason === 'max_tokens'
}

function detectOpenCodeBlock(text) {
  const fences = (text.match(/```/g) ?? []).length
  return fences % 2 !== 0
}

async function continuationCall(
  messages,
  partialReply,
  maxTokens,
  timeoutMs = 20000
) {
  const hasOpenCode = detectOpenCodeBlock(partialReply)

  const continuePrompt = hasOpenCode
    ? 'continue exactly from where you stopped, complete the code block'
    : 'continue exactly from where you stopped'

  const continuationMessages = [
    ...messages,
    { role: 'assistant', content: partialReply },
    { role: 'user', content: continuePrompt }
  ]

  const response = await fetchClaude({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: continuationMessages
  }, timeoutMs)

  return await response.json()
}

function resolveHardCap(complexity, intent) {
  if (complexity === 'extreme') return 4096
  if (complexity === 'very_high') return 2048
  if (complexity === 'high') return 1400
  if (intent === 'command') return 1200
  return 900
}

router.post('/process-text', async (req, res) => {
  const {
    text = '',
    sessionId,
    history = [],
    image = null,
    imageMimeType = 'image/jpeg'
  } = req.body

  const hasText = typeof text === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) {
    return res.status(400).json({ error: 'missing_input' })
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
    const fieldPrompt = engine.buildFieldPrompt?.() ?? null
    const prevAnalysis = analysisStore.get(sid) ?? null

    const built = build({
      ok: true,
      signals: processed.signals,
      celfResult: processed.celfResult,
      passToLLM: processed.passToLLM,
      structuralHint: prevAnalysis?.structuralHint ?? null,
      prevMaxTokens: prevAnalysis?.nextMaxTokens ?? null,
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

    const rawHint = built.systemHint || ''
    const systemHint = rawHint.slice(0, 300)

    const intent = built.context?.intent ?? 'question'
    const complexity = built.context?.complexity ?? 'low'
    const baseMax = built.maxTokens ?? 400

    const hardCap = resolveHardCap(complexity, intent)
    const maxTokens = Math.min(Math.max(baseMax, 160), hardCap)

    const historyBudget = Math.max(150, 3000 - maxTokens)
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
        ...(hasText ? [{ type: 'text', text }] : [])
      ]
    } else {
      userContent = text
    }

    const messages = [
      ...prunedHistory,
      { role: 'user', content: userContent }
    ]

    const fullSystemHint = [
      systemHint,
      complexity === 'extreme' || complexity === 'very_high'
        ? 'Never truncate. Complete all code blocks fully.'
        : ''
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 400)

    let payloadSize = 0

    try {
      payloadSize = checkPayload(fullSystemHint, messages)
    } catch (e) {
      return res.status(413).json({
        error: 'prompt_too_large',
        detail: e.message
      })
    }

    let claudeData
    let reply = null

    let inputTokensTotal = 0
    let outputTokensTotal = 0

    try {
      const claudeResponse = await fetchClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: fullSystemHint,
        messages
      })

      claudeData = await claudeResponse.json()

      if (!claudeResponse.ok) {
        throw new Error(
          `Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`
        )
      }

      reply = claudeData?.content?.[0]?.text ?? null

      inputTokensTotal =
        claudeData?.usage?.input_tokens ?? 0

      outputTokensTotal =
        claudeData?.usage?.output_tokens ?? 0

      const MAX_CONTINUATIONS = 2

      let continuationCount = 0

      while (
        reply &&
        isTruncated(claudeData) &&
        continuationCount < MAX_CONTINUATIONS
      ) {
        continuationCount++

        const contTokens = Math.min(
          maxTokens,
          4096 - outputTokensTotal
        )

        if (contTokens < 50) break

        const contData = await continuationCall(
          messages,
          reply,
          contTokens
        )

        if (!contData?.content?.[0]?.text) {
          break
        }

        reply += contData.content[0].text

        inputTokensTotal +=
          contData?.usage?.input_tokens ?? 0

        outputTokensTotal +=
          contData?.usage?.output_tokens ?? 0

        claudeData = contData
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({
          error: 'claude_timeout'
        })
      }

      throw err
    }

    const costUSD = parseFloat(
      (
        (inputTokensTotal / 1_000_000) * 1.0 +
        (outputTokensTotal / 1_000_000) * 5.0
      ).toFixed(6)
    )

    if (reply) {
      const fieldBefore = processed.celfResult.field

      engine.process(reply, 0.15)

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
      inputTokens: inputTokensTotal,
      outputTokens: outputTokensTotal,
      totalTokens:
        inputTokensTotal + outputTokensTotal,
      costUSD,
      maxTokens,
      payloadSize,
      prunedHistory: prunedHistory.length,
      intent,
      complexity,
      phase:
        processed.celfResult.phase ?? 'warmup',
      fieldZone: fieldPrompt?.zone ?? null,
      fieldStyle: fieldPrompt?.style ?? null,
      continuity:
        fieldPrompt?.continuity ?? 0,
      updatedAt: new Date().toISOString()
    })

    return res.json({
      reply,
      context: built.context,
      signals: processed.signals,
      celf: processed.result,
      wave:
        analysisStore.get(sid)?.wave ?? null,
      metrics: {
        inputTokens: inputTokensTotal,
        outputTokens: outputTokensTotal,
        totalTokens:
          inputTokensTotal + outputTokensTotal,
        costUSD,
        maxTokens,
        complexity,
        prunedHistory:
          prunedHistory.length,
        payloadSize,
        systemHintPreview:
          fullSystemHint.slice(0, 120)
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
