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

  if (!id)                  return res.status(400).json({ error: 'missing id' })
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
