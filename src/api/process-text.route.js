router.post('/process-text', async (req, res) => {

  try {

    const {
      text = '',
      sessionId = 'default',
      history = []
    } = req.body

    if (!text || !text.trim()) {
      return res.status(400).json({
        error: 'missing_text'
      })
    }

    const messages = [
      ...history,
      {
        role: 'user',
        content: text
      }
    ]

    const response = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },

        body: JSON.stringify({

          model: 'claude-haiku-4-5-20251001',

          max_tokens: 2048,

          messages

        })
      }
    )

    const data = await response.json()

    console.log(
      JSON.stringify(data, null, 2)
    )

    if (!response.ok) {

      return res.status(500).json({

        error: 'claude_failed',

        detail:
          data?.error?.message ||
          'unknown_error'
      })
    }

    const reply =
      data?.content
        ?.filter(x => x.type === 'text')
        ?.map(x => x.text)
        ?.join('\n')
        ?.trim() || 'No reply'

    return res.json({

      reply,

      model:
        'claude-haiku-4-5-20251001',

      usage: data?.usage || null

    })

  } catch (err) {

    console.error(err)

    return res.status(500).json({

      error: 'server_error',

      detail: err.message
    })
  }
})
