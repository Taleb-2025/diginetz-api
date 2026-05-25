import express from 'express'

const router = express.Router()
const MAX_INPUT_CHARS = 40000

router.get('/process-text', (_req, res) => {
  res.json({ ok: true, status: 'online', engine: 'NONE', llm: 'Claude Haiku 4.5', version: 'no-celf-test' })
})

async function fetchClaude(body, timeoutMs = 90000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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

router.post('/process-text', async (req, res) => {
  const { text = '', sessionId, history = [], image = null, imageMimeType = 'image/jpeg' } = req.body

  const hasText  = typeof text === 'string' && text.trim().length > 0
  const hasImage = typeof image === 'string' && image.length > 0

  if (!hasText && !hasImage) return res.status(400).json({ error: 'missing_input' })

  const sid = sessionId || 'default'

  try {
    const cleanedText = hasText && text.length > MAX_INPUT_CHARS
      ? text.slice(0, MAX_INPUT_CHARS)
      : text

    const _inputWords = (cleanedText || '').trim().split(/\s+/).length
    const hasCode = /```|function|class|const|let|var|=>|import|export/.test(cleanedText)

    const maxTokens =
      hasCode          ? 3000 :
      _inputWords <= 5  ?  600 :
      _inputWords <= 15 ? 1200 :
                          1800

    const conciseHint =
      hasCode          ? 'Be thorough with code examples.' :
      _inputWords <= 5  ? 'Reply in max 2 sentences. No markdown. No bullet points.' :
      _inputWords <= 15 ? 'Be concise. Max 2 paragraphs. No markdown. No bullet points.' :
                          'Be clear and complete. No markdown unless necessary.'

    const filteredHistory = (history || [])
      .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
      .slice(-4)
      .map(h => ({ role: h.role, content: h.content.slice(0, 800) }))

    const userContent = hasImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: image } },
          ...(hasText ? [{ type: 'text', text: cleanedText }] : [])
        ]
      : cleanedText

    const messages = [
      ...filteredHistory,
      { role: 'user', content: hasImage ? userContent : cleanedText }
    ]

    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: conciseHint,
      messages
    }

    const claudeResponse = await fetchClaude(body)
    const claudeData = await claudeResponse.json()

    if (!claudeResponse.ok)
      throw new Error(`Claude error: ${claudeData?.error?.message ?? claudeResponse.status}`)

    const reply = claudeData?.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n').trim() || null

    const inputTokens  = claudeData?.usage?.input_tokens  ?? 0
    const outputTokens = claudeData?.usage?.output_tokens ?? 0
    const costUSD = parseFloat(
      ((inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 5.0).toFixed(6)
    )

    return res.json({
      reply,
      debug: { celf: false },
      metrics: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUSD,
        maxTokens,
        model: 'claude-haiku-4-5-20251001'
      }
    })

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'claude_timeout' })
    return res.status(500).json({ error: 'llm_failed', detail: err.message })
  }
})

export default router
