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
  useLLM:         !!process.env.OPENAI_API_KEY,
  llmMinSeverity: 'high'
})

// ─────────────────────────────────────────────
// Bitcoin instance (demo only)
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
  const r    = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
  const data = await r.json()
  return parseFloat(data.price)
}

// ─────────────────────────────────────────────
// Latency helpers
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

function latencyInstanceId(url) {
  try {
    return 'latency:' + new URL(url).hostname
  } catch {
    return 'latency:unknown'
  }
}

function getLatencyInstance(url) {
  return getInstance(latencyInstanceId(url), {
    resolution:      200,
    cycle:           3000,
    windowSize:      64,
    thresholdFactor: 2.5
  })
}

function latencyCategory(status, duration) {
  if (status === 0)    return 'timeout'
  if (status >= 500)   return 'server_error'
  if (status >= 400)   return 'client_error'
  if (duration > 1000) return 'slow'
  return 'normal'
}

// ─────────────────────────────────────────────
// Benchmark
// ─────────────────────────────────────────────
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
  const engine     = new CELF_Engine_V8({
    resolution: 1000, cycle: 6000, windowSize: 128, thresholdFactor: 2.0
  })
  const localLayer = new DecisionLayer({ windowSize: 10, useLLM: false })

  let tp = 0, fp = 0, tn = 0, fn = 0

  for (const row of data) {
    const result = engine.observe(row.amount)
    if (result.phase === 'warmup') continue

  const decision = {
  action: result.confidence < 0.5 ? 'block' : 'allow'
}

const detected = decision.action === 'block'

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

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
router.get('/benchmark', (req, res) => {
  const data       = generateBenchmarkData()
  const fraudTotal = data.filter(r => r.fraud).length
  const celf       = runCELF(data)
  const zscore     = runZScore(data)
  const winner     = celf.f1 > zscore.f1 ? 'CELF' : celf.f1 < zscore.f1 ? 'Z-Score' : 'Draw'

  res.json({
    dataset: { total: data.length, fraud: fraudTotal, normal: data.length - fraudTotal },
    celf: {
      truePositive:  celf.tp,
      falsePositive: celf.fp,
      trueNegative:  celf.tn,
      falseNegative: celf.fn,
      precision:     Math.round(celf.precision  * 10000) / 100,
      recall:        Math.round(celf.recall     * 10000) / 100,
      f1:            Math.round(celf.f1         * 10000) / 100,
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

// ── Bitcoin (demo only) ───────────────────────────────────────────
router.get('/bitcoin/tick', async (req, res) => {
  try {
    const value    = await fetchBitcoinPrice()
    const result   = getBitcoinInstance().observe(value)
    const decision = await layer.evaluate(result, { type: 'bitcoin_tick', value })
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
    const decision = await layer.evaluate(result, { type: 'bitcoin_spike', value, base, spike })
    res.json({ value, base, spike: Math.round(spike * 10000) / 100 + '%', pair: 'BTC/USDT', ...result, decision })
  } catch {
    res.status(500).json({ error: 'fetch failed' })
  }
})

// ── Latency — tick حقيقي ──────────────────────────────────────────
router.get('/latency/tick', async (req, res) => {
  const endpoint = 'https://api.binance.com/api/v3/time'

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

  res.json({ value: duration, unit: 'ms', endpoint, status, category, ...result, decision })
})

// ── Latency — spike اصطناعي ───────────────────────────────────────
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

  res.json({ value: duration, unit: 'ms', endpoint, status, category, ...result, decision })
})

// ── Generic routes ────────────────────────────────────────────────
router.post('/observe', async (req, res) => {
  const { id, value, options, event } = req.body
  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  const result   = getInstance(id, options ?? {}).observe(value)
  const decision = await layer.evaluate(result, event ?? null)
  res.json({ ...result, decision })
})

router.post('/test', (req, res) => {
  const { id, value } = req.body
  if (!id)                     return res.status(400).json({ error: 'missing id' })
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'invalid value' })

  const result   = getInstance(id).test(value)
  const decision = layer.evaluateSync(result)
  res.json({ ...result, decision })
})

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

router.get('/weights/:id', (req, res) => {
  if (!instances.has(req.params.id)) return res.status(404).json({ error: 'instance not found' })
  res.json(getInstance(req.params.id).getWeights())
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
  res.json({ instances: list, total: list.length, max: MAX_INSTANCES })
})

export default router
