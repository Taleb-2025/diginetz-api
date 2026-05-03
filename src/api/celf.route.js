import express from 'express'
import { CELF_Engine_V6 } from '../engines/CELF_Engine_V6.js'

const router = express.Router()

const instances = new Map()

function getInstance(id, options = {}) {
  if (!instances.has(id)) {
    instances.set(id, new CELF_Engine_V6(options))
  }
  return instances.get(id)
}

router.get('/forex/tick', async (req, res) => {
  try {
    const r    = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR')
    const data = await r.json()
    let value  = data.rates.EUR

    if (Math.random() < 0.1) {
      const spike = (Math.random() * 0.15 + 0.05) * (Math.random() > 0.5 ? 1 : -1)
      value = value * (1 + spike)
    }

    const engine = getInstance('forex-demo')
    const result = engine.observe(value)

    res.json({ value, ...result })
  } catch (err) {
    res.status(500).json({ error: 'fetch failed' })
  }
})

router.get('/forex/spike', async (req, res) => {
  try {
    const r    = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR')
    const data = await r.json()
    const spike = (Math.random() * 0.15 + 0.05) * (Math.random() > 0.5 ? 1 : -1)
    const value = data.rates.EUR * (1 + spike)

    const engine = getInstance('forex-demo')
    const result = engine.observe(value)

    res.json({ value, ...result })
  } catch (err) {
    res.status(500).json({ error: 'fetch failed' })
  }
})

router.post('/observe', (req, res) => {
  const { id, value, options } = req.body
  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  const engine = getInstance(id, options ?? {})
  const result = engine.observe(value)
  res.json(result)
})

router.post('/test', (req, res) => {
  const { id, value } = req.body
  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  const engine = getInstance(id)
  const result = engine.test(value)
  res.json(result)
})

router.post('/filter', (req, res) => {
  const { id, values } = req.body
  if (!id)                    return res.status(400).json({ error: 'missing id' })
  if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be array' })

  const engine   = getInstance(id)
  const filtered = engine.filter(values)
  const blocked  = values.filter(v => !filtered.includes(v))
  res.json({ filtered, blocked, total: values.length })
})

router.post('/reverse', (req, res) => {
  const { id, value } = req.body
  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  const engine     = getInstance(id)
  const candidates = engine.reverseInfer(value)
  res.json({ candidates })
})

router.get('/summary/:id', (req, res) => {
  const { id } = req.params
  if (!instances.has(id)) return res.status(404).json({ error: 'instance not found' })

  const engine = getInstance(id)
  res.json(engine.getSummary())
})

router.get('/space/:id', (req, res) => {
  const { id } = req.params
  if (!instances.has(id)) return res.status(404).json({ error: 'instance not found' })

  const engine = getInstance(id)
  res.json({ space: engine.getSpace() })
})

router.post('/reset/:id', (req, res) => {
  const { id } = req.params
  if (!instances.has(id)) return res.status(404).json({ error: 'instance not found' })

  getInstance(id).reset()
  res.json({ ok: true, id })
})

router.delete('/instance/:id', (req, res) => {
  const { id } = req.params
  instances.delete(id)
  res.json({ ok: true, id })
})

router.get('/instances', (req, res) => {
  const list = []
  for (const [id, engine] of instances.entries()) {
    list.push({ id, ...engine.getSummary() })
  }
  res.json({ instances: list, total: list.length })
})

export default router
