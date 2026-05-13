// ── دالة مساعدة: هل الرد مقطوع؟ ─────────────────────────
function isTruncated(claudeData) {
  return claudeData?.stop_reason === 'max_tokens'
}

// ── دالة مساعدة: استخراج آخر كتلة كود مفتوحة ───────────
function detectOpenCodeBlock(text) {
  const fences = (text.match(/```/g) ?? []).length
  return fences % 2 !== 0  // عدد فردي = كتلة كود مفتوحة
}

// ── دالة الاستمرار التلقائي ──────────────────────────────
async function continuationCall(
  messages,
  partialReply,
  maxTokens,
  timeoutMs = 20000
) {
  const hasOpenCode = detectOpenCodeBlock(partialReply)

  // نُخبر Claude بأنه كان يكتب ويجب أن يكمل
  const continuePrompt = hasOpenCode
    ? 'continue exactly from where you stopped, complete the code block'
    : 'continue exactly from where you stopped'

  const continuationMessages = [
    ...messages,
    { role: 'assistant', content: partialReply },
    { role: 'user',      content: continuePrompt }
  ]

  const response = await fetchClaude({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages:   continuationMessages
  }, timeoutMs)

  return await response.json()
}

// ── السقف الديناميكي حسب complexity ─────────────────────
function resolveHardCap(complexity, intent) {
  if (complexity === 'extreme')   return 4096
  if (complexity === 'very_high') return 2048
  if (complexity === 'high')      return 1400
  if (intent === 'command')       return 1200
  return 900
}

// ── داخل router.post('/process-text') ────────────────────
// استبدل الكود من "const baseMax" حتى نهاية استدعاء Claude

    const rawHint    = built.systemHint || ''
    const systemHint = rawHint.slice(0, 300)
    const intent     = built.context?.intent ?? 'question'
    const complexity = built.context?.complexity ?? 'low'
    const baseMax    = built.maxTokens ?? 400

    // ── السقف الديناميكي بدل الصلب 1400 ─────────────────
    const hardCap   = resolveHardCap(complexity, intent)
    const maxTokens = Math.min(Math.max(baseMax, 160), hardCap)

    const historyBudget   = Math.max(150, 3000 - maxTokens)
    const prunedHistory   = adaptiveHistory(history, intent, historyBudget)

    let userContent = hasImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } },
          ...(hasText ? [{ type: 'text', text }] : [])
        ]
      : text

    const messages = [
      ...prunedHistory,
      { role: 'user', content: userContent }
    ]

    // ── System hint يتضمن تعليم عدم القطع ───────────────
    const fullSystemHint = [
      systemHint,
      complexity === 'extreme' || complexity === 'very_high'
        ? 'Never truncate. Complete all code blocks fully.'
        : ''
    ].filter(Boolean).join(' ').slice(0, 400)

    let payloadSize = 0
    try {
      payloadSize = checkPayload(fullSystemHint, messages)
    } catch (e) {
      return res.status(413).json({ error: 'prompt_too_large', detail: e.message })
    }

    let claudeData
    let reply = null

    try {
      // ── الاستدعاء الأول ───────────────────────────────
      const claudeResponse = await fetchClaude({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system:     fullSystemHint,
        messages
      })

      claudeData = await claudeResponse.json()

      if (!claudeResponse.ok) {
        throw new Error(
          `Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`
        )
      }

      reply = claudeData?.content?.[0]?.text ?? null

      // ── كشف القطع والاستمرار التلقائي ────────────────
      const MAX_CONTINUATIONS = 2  // حد أقصى لتجنب infinite loop

      let continuationCount = 0
      let inputTokensTotal  = claudeData?.usage?.input_tokens  ?? 0
      let outputTokensTotal = claudeData?.usage?.output_tokens ?? 0

      while (
        reply &&
        isTruncated(claudeData) &&
        continuationCount < MAX_CONTINUATIONS
      ) {
        continuationCount++

        const contTokens = Math.min(
          maxTokens,
          4096 - outputTokensTotal  // لا نتجاوز الحد الكلي
        )

        if (contTokens < 50) break  // لا فائدة من continuation صغير جداً

        const contData = await continuationCall(
          messages,
          reply,
          contTokens
        )

        if (!contData?.content?.[0]?.text) break

        // دمج الردود
        reply += contData.content[0].text

        inputTokensTotal  += contData?.usage?.input_tokens  ?? 0
        outputTokensTotal += contData?.usage?.output_tokens ?? 0

        // تحديث claudeData للـ loop التالي
        claudeData = contData
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'claude_timeout' })
      }
      throw err
    }

    // ── حساب التكلفة الإجمالية شاملة الـ continuations ──
    const inputTokens  = claudeData?.usage?.input_tokens  ?? 0
    const outputTokens = claudeData?.usage?.output_tokens ?? 0

    const costUSD = parseFloat(
      (
        (inputTokens  / 1_000_000) * 1.0 +
        (outputTokens / 1_000_000) * 5.0
      ).toFixed(6)
    )

    // ... باقي الكود (analyze, metricsStore, return) كما هو
    return res.json({
      reply,
      metrics: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUSD,
        maxTokens,
        complexity,           // ← مفيد للـ debugging
        prunedHistory: prunedHistory.length,
        payloadSize
      }
    })
