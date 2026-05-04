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

function getForexInstance() {
  return getInstance('forex-demo', {
    resolution:      1000,
    cycle:           2,
    windowSize:      128,
    thresholdFactor: 2.0
  })
}

function generateBenchmarkData() {
  const data = []
  for (let i = 0; i < 9800; i++) {
    data.push({ amount: Math.abs(Math.random() * 150 + Math.random() * 50), fraud: false })
  }
  for (let i = 0; i < 200; i++) {
    data.push({ amount: Math.random() * 4000 + 1000, fraud: true })
  }
  for (let i = data.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[data[i], data[j]] = [data[j], data[i]]
  }
  return data
}

function runCELF(data) {
  const engine = new CELF_Engine_V6({
    resolution: 1000, cycle: 6000, windowSize: 128, thresholdFactor: 2.0
  })
  let tp = 0, fp = 0, tn = 0, fn = 0
  for (const row of data) {


    
  const result = engine.observe(row.amount)

const detected =
  result.impossible === true &&
  Math.abs(result.jump) > result.threshold * 1.5

if (row.fraud  && detected)  tp++
if (!row.fraud && detected)  fp++
if (!row.fraud && !detected) tn++
if (row.fraud  && !detected) fn++


    
  }
  const fraudTotal = data.filter(r => r.fraud).length
  const precision  = tp / (tp + fp) || 0
  const recall     = tp / fraudTotal || 0
  const f1         = 2 * (precision * recall) / (precision + recall) || 0
  return { tp, fp, tn, fn, precision, recall, f1, aliveRatio: engine.getAliveRatio() }
}

function runZScore(data) {
  const values = data.map(r => r.amount)
  const mean   = values.reduce((a, b) => a + b, 0) / values.length
  const std    = Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length)
  let tp = 0, fp = 0, tn = 0, fn = 0
  for (const row of data) {
    const detected = Math.abs((row.amount - mean) / std) > 3
    if (row.fraud  && detected)  tp++
    if (!row.fraud && detected)  fp++
    if (!row.fraud && !detected) tn++
    if (row.fraud  && !detected) fn++
  }
  const fraudTotal = data.filter(r => r.fraud).length
  const precision  = tp / (tp + fp) || 0
  const recall     = tp / fraudTotal || 0
  const f1         = 2 * (precision * recall) / (precision + recall) || 0
  return { tp, fp, tn, fn, precision, recall, f1 }
}

router.get('/benchmark', (req, res) => {
  const data       = generateBenchmarkData()
  const fraudTotal = data.filter(r => r.fraud).length
  const celf       = runCELF(data)
  const zscore     = runZScore(data)

  const winner = celf.f1 > zscore.f1 ? 'CELF' : celf.f1 < zscore.f1 ? 'Z-Score' : 'Draw'

  res.json({
    dataset: {
      total:  data.length,
      fraud:  fraudTotal,
      normal: data.length - fraudTotal
    },
    celf: {
      truePositive:  celf.tp,
      falsePositive: celf.fp,
      trueNegative:  celf.tn,
      falseNegative: celf.fn,
      precision:     Math.round(celf.precision * 10000) / 100,
      recall:        Math.round(celf.recall    * 10000) / 100,
      f1:            Math.round(celf.f1        * 10000) / 100,
      aliveRatio:    Math.round(celf.aliveRatio * 10000) / 100
    },
    zscore: {
      truePositive:  zscore.tp,
      falsePositive: zscore.fp,
      trueNegative:  zscore.tn,
      falseNegative: zscore.fn,
      precision:     Math.round(zscore.precision * 10000) / 100,
      recall:        Math.round(zscore.recall    * 10000) / 100,
      f1:            Math.round(zscore.f1        * 10000) / 100
    },
    winner
  })
})

router.get('/forex/tick', async (req, res) => {
  try {
    const r    = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR')
    const data = await r.json()
    let value  = data.rates.EUR
    if (Math.random() < 0.1) {
      const spike = (Math.random() * 0.15 + 0.05) * (Math.random() > 0.5 ? 1 : -1)
      value = value * (1 + spike)
    }
    const engine = getForexInstance()
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
    const engine = getForexInstance()
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
  res.json(getInstance(id, options ?? {}).observe(value))
})

router.post('/test', (req, res) => {
  const { id, value } = req.body
  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })
  res.json(getInstance(id).test(value))
})

router.post('/filter', (req, res) => {
  const { id, values } = req.body
  if (!id)                    return res.status(400).json({ error: 'missing id' })
  if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be array' })
  const engine   = getInstance(id)
  const filtered = engine.filter(values)
  res.json({ filtered, blocked: values.filter(v => !filtered.includes(v)), total: values.length })
})

router.post('/reverse', (req, res) => {
  const { id, value } = req.body
  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })
  res.json({ candidates: getInstance(id).reverseInfer(value) })
})

router.get('/summary/:id', (req, res) => {
  if (!instances.has(req.params.id)) return res.status(404).json({ error: 'instance not found' })
  res.json(getInstance(req.params.id).getSummary())
})

router.get('/space/:id', (req, res) => {
  if (!instances.has(req.params.id)) return res.status(404).json({ error: 'instance not found' })
  res.json({ space: getInstance(req.params.id).getSpace() })
})

router.post('/reset/:id', (req, res) => {
  if (!instances.has(req.params.id)) return res.status(404).json({ error: 'instance not found' })
  instances.delete(req.params.id)
  res.json({ ok: true, id: req.params.id })
})

router.delete('/instance/:id', (req, res) => {
  instances.delete(req.params.id)
  res.json({ ok: true, id: req.params.id })
})

router.get('/instances', (req, res) => {
  const list = []
  for (const [id, engine] of instances.entries()) {
    list.push({ id, ...engine.getSummary() })
  }
  res.json({ instances: list, total: list.length })
})

export default router
