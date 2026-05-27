import express from 'express'

const router = express.Router()

async function fetchClaude(body) {

  const response = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },

      body: JSON.stringify(body)
    }
  )

  const data = await response.json()

  if (!response.ok) {

    throw new Error(
      data?.error?.message ||
      'Claude request failed'
    )

  }

  return data
}

router.post('/', async (req, res) => {

  try {

    const {
      text = '',
      history = []
    } = req.body

    // ── Tiny Context Window ─────────────────────
    // Only last message survives

    const messages = [

      ...history.slice(-1),

      {
        role: 'user',
        content: text
      }

    ]

    const body = {

      model: 'claude-haiku-4-5-20251001',

      max_tokens: 700,

      system: `
You are part of a symbolic semantic experiment.

Interpret symbols semantically.

Rules:

>#  = continuation of previous context
>   = execution or forward continuation
>>  = deep continuation
?   = uncertainty or possible issue
!   = critical issue or strong signal
::  = relation between layers
&&  = coupling
=>  = transformation or flow
{}  = structure
[]  = grouped context

Infer intent from symbols naturally.

Do not explain the symbols themselves.

Continue the semantic direction implicitly.

Assume symbolic markers may compress previous semantic context.
`,

      messages

    }

    const data = await fetchClaude(body)

    const reply =
      data?.content
        ?.filter(x => x.type === 'text')
        ?.map(x => x.text)
        ?.join('\n')
        ?.trim() || null

    return res.json({

      ok: true,

      reply

    })

  } catch (err) {

    console.error(
      '[demo-symbol]',
      err.message
    )

    return res.status(500).json({

      ok: false,

      error: err.message

    })

  }

})

router.get('/', (_req, res) => {

  return res.json({

    ok: true,

    route: 'demo-symbol',

    status: 'online',

    historyWindow: 1

  })

})

export default router
