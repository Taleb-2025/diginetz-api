import express from 'express'
import { CELF_Engine_V8 }  from '../engines/CELF_Engine_V8.js'
import { DecisionLayer }   from '../utils/decision-layer.js'

const router = express.Router()

// ─────────────────────────────────────────────
// Instances — LRU, حد أقصى 100
// ─────────────────────────────────────────────
const MAX_INSTANCES = 100
const instances     = new Map()

function getInstance(id, options = {}) {
  if (instances.has(id)) {
    const engine = instances.get(id)
    instances.delete(id)
    instances.set(id, engine)
    return engine
  }

  if (instances.size >= MAX_INSTANCES) {
    const oldest = instances.keys().next().value
    instances.delete(oldest)
  }

  const engine = new CELF_Engine_V8(options)
  instances.set(id, engine)
  return engine
}

// ─────────────────────────────────────────────
// Decision Layer
// ─────────────────────────────────────────────
const layer = new DecisionLayer({
  windowSize:     10,
  useLLM:         false,
  llmMinSeverity: 'high'
})

// ─────────────────────────────────────────────
// Block helper
// ─────────────────────────────────────────────
function handleDecision(res, decision) {
  if (decision?.action === 'block') {
    return res.status(403).json({
      blocked: true,
      reason:  decision.reason || 'blocked_by_celf'
    })
  }
  return null
}

// ─────────────────────────────────────────────
// Bitcoin
// ─────────────────────────────────────────────
function getBitcoinInstance() {
  return getInstance('bitcoin-demo', {
    resolution:      1000,
    cycle:           200000,
    windowSize:      128,
    thresholdFactor: 2.0
  })
}

async function fetchBitcoinPrice() {
  const r    = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
  const data = await r.json()
  return data.bitcoin.usd
}

router.get('/bitcoin/tick', async (req, res) => {
  try {
    const value    = await fetchBitcoinPrice()
    const result   = getBitcoinInstance().observe(value)
    const decision = await layer.evaluate(result, { type: 'bitcoin_tick', value })

    if (handleDecision(res, decision)) return
    res.json({ value, pair: 'BTC/USDT', ...result, decision })
  } catch {
    res.status(500).json({ error: 'fetch failed' })
  }
})

router.get('/bitcoin/spike', async (req, res) => {
  try {
    const base   = await fetchBitcoinPrice()
    const spike  = (Math.random() * 0.08 + 0.03) * (Math.random() > 0.5 ? 1 : -1)
    const value  = base * (1 + spike)
    const result   = getBitcoinInstance().observe(value)
    const decision = await layer.evaluate(result, { type: 'bitcoin_spike', value })

    if (handleDecision(res, decision)) return
    res.json({ value, base, spike, pair: 'BTC/USDT', ...result, decision })
  } catch {
    res.status(500).json({ error: 'fetch failed' })
  }
})

// ─────────────────────────────────────────────
// Latency
// ─────────────────────────────────────────────
async function fetchLatency(url) {
  const start = Date.now()
  try {
    const res      = await fetch(url)
    const duration = Date.now() - start
    const status   = duration > 2000 ? 0 : res.status
    return { duration, status }
  } catch {
    return { duration: 3000, status: 0 }
  }
}

function latencyCategory(status, duration) {
  if (status === 0)    return 'timeout'
  if (status >= 500)   return 'server_error'
  if (status >= 400)   return 'client_error'
  if (duration > 1000) return 'slow'
  return 'normal'
}

function getLatencyInstance(url) {
  // hostname فقط كـ id — نظيف ومختصر
  const id = 'latency:' + new URL(url).hostname
  return getInstance(id, {
    resolution:      200,
    cycle:           3000,
    windowSize:      64,
    thresholdFactor: 2.5
  })
}

router.get('/latency/tick', async (req, res) => {
  const endpoint = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
  const { duration, status } = await fetchLatency(endpoint)
  const category = latencyCategory(status, duration)

  const result   = getLatencyInstance(endpoint).observe(duration)
  const decision = await layer.evaluate(result, {
    type: 'latency',
    endpoint,
    duration,
    status,
    category
  })

  if (handleDecision(res, decision)) return
  res.json({ value: duration, unit: 'ms', endpoint, status, category, ...result, decision })
})

router.get('/latency/spike', async (req, res) => {
  const endpoint = 'https://httpbin.org/delay/2'
  const { duration, status } = await fetchLatency(endpoint)
  const category = latencyCategory(status, duration)

  const result   = getLatencyInstance(endpoint).observe(duration)
  const decision = await layer.evaluate(result, {
    type: 'latency_spike',
    endpoint,
    duration,
    status,
    category
  })

  if (handleDecision(res, decision)) return
  res.json({ value: duration, unit: 'ms', endpoint, status, category, ...result, decision })
})

// ─────────────────────────────────────────────
// Observe
// ─────────────────────────────────────────────
router.post('/observe', async (req, res) => {
  const { id, value, options, event } = req.body

  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  const result   = getInstance(id, options ?? {}).observe(value)
  const decision = await layer.evaluate(result, event ?? null)

  if (handleDecision(res, decision)) return
  res.json({ ...result, decision })
})

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────
router.post('/test', (req, res) => {
  const { id, value } = req.body

  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  const result   = getInstance(id).test(value)
  const decision = layer.evaluateSync(result)

  if (handleDecision(res, decision)) return
  res.json({ ...result, decision })
})

// ─────────────────────────────────────────────
// Filter
// ─────────────────────────────────────────────
router.post('/filter', (req, res) => {
  const { id, values } = req.body

  if (!id)                    return res.status(400).json({ error: 'missing id' })
  if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be array' })

  const engine   = getInstance(id)
  const filtered = engine.filter(values)
  res.json({
    filtered,
    blocked: values.filter(v => !filtered.includes(v)),
    total:   values.length
  })
})

// ─────────────────────────────────────────────
// Reverse
// ─────────────────────────────────────────────
router.post('/reverse', (req, res) => {
  const { id, value } = req.body

  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  res.json({ candidates: getInstance(id).reverseInfer(value) })
})

// ─────────────────────────────────────────────
// Summary / Space / Weights
// ─────────────────────────────────────────────
router.get('/summary/:id', (req, res) => {
  if (!instances.has(req.params.id)) return res.status(404).json({ error: 'instance not found' })
  res.json(getInstance(req.params.id).getSummary())
})

router.get('/space/:id', (req, res) => {
  if (!instances.has(req.params.id)) return res.status(404).json({ error: 'instance not found' })
  res.json({ space: getInstance(req.params.id).getSpace() })
})

router.get('/weights/:id', (req, res) => {
  if (!instances.has(req.params.id)) return res.status(404).json({ error: 'instance not found' })
  res.json(getInstance(req.params.id).getWeights())
})

// ─────────────────────────────────────────────
// Reset / Delete / List
// ─────────────────────────────────────────────
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
  res.json({ instances: list, total: list.length, max: MAX_INSTANCES })
})

export default router
