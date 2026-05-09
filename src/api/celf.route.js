import express from 'express'
import { CyclicProcessorEngine } from '../engines/CyclicProcessorEngine.js'
import { DecisionLayer } from '../utils/decision-layer.js'

const router = express.Router()

const MAX_INSTANCES = 100
const instances = new Map()

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

  const engine = new CyclicProcessorEngine(options)

  instances.set(id, engine)

  return engine
}

const layer = new DecisionLayer({
  windowSize: 10,
  useLLM: false,
  llmMinSeverity: 'high'
})

function handleDecision(res, decision) {
  if (decision?.action === 'block') {
    return res.status(403).json({
      blocked: true,
      reason: decision.reason || 'blocked_by_celf'
    })
  }

  return null
}

function generateBenchmarkData() {
  const data = []

  for (let i = 0; i < 9800; i++) {
    data.push({
      amount: Math.abs(Math.random() * 150 + Math.random() * 50),
      fraud: false
    })
  }

  for (let i = 0; i < 200; i++) {
    data.push({
      amount: Math.random() * 4000 + 1000,
      fraud: true
    })
  }

  for (let i = data.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[data[i], data[j]] = [data[j], data[i]]
  }

  return data
}

function runCELF(data) {
  const engine = new CyclicProcessorEngine({
    resolution: 1000,
    cycle: 6000
  })

  const localLayer = new DecisionLayer({
    windowSize: 10,
    useLLM: false
  })

  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0

  for (const row of data) {
    const result = engine.process(row.amount)

    if (result.phase === 'warmup') continue

    localLayer.evaluateSync(result)

    const detected =
      result.phase === 'turbulent' ||
      result.phase === 'drift'

    if (row.fraud && detected) tp++
    if (!row.fraud && detected) fp++
    if (!row.fraud && !detected) tn++
    if (row.fraud && !detected) fn++
  }

  const fraudTotal = data.filter(r => r.fraud).length

  const precision = tp / (tp + fp) || 0
  const recall = tp / fraudTotal || 0
  const f1 = (2 * precision * recall) / (precision + recall) || 0

  return {
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1
  }
}

function runZScore(data) {
  const values = data.map(r => r.amount)

  const mean =
    values.reduce((a, b) => a + b, 0) / values.length

  const std = Math.sqrt(
    values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length
  )

  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0

  for (const row of data) {
    const detected =
      Math.abs((row.amount - mean) / std) > 3

    if (row.fraud && detected) tp++
    if (!row.fraud && detected) fp++
    if (!row.fraud && !detected) tn++
    if (row.fraud && !detected) fn++
  }

  const fraudTotal = data.filter(r => r.fraud).length

  const precision = tp / (tp + fp) || 0
  const recall = tp / fraudTotal || 0
  const f1 = (2 * precision * recall) / (precision + recall) || 0

  return {
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1
  }
}

router.get('/benchmark', (req, res) => {
  const data = generateBenchmarkData()

  const fraudTotal =
    data.filter(r => r.fraud).length

  const celf = runCELF(data)
  const zscore = runZScore(data)

  const winner =
    celf.f1 > zscore.f1
      ? 'CELF'
      : celf.f1 < zscore.f1
      ? 'Z-Score'
      : 'Draw'

  res.json({
    dataset: {
      total: data.length,
      fraud: fraudTotal,
      normal: data.length - fraudTotal
    },

    celf: {
      truePositive: celf.tp,
      falsePositive: celf.fp,
      trueNegative: celf.tn,
      falseNegative: celf.fn,
      precision: Math.round(celf.precision * 10000) / 100,
      recall: Math.round(celf.recall * 10000) / 100,
      f1: Math.round(celf.f1 * 10000) / 100
    },

    zscore: {
      truePositive: zscore.tp,
      falsePositive: zscore.fp,
      trueNegative: zscore.tn,
      falseNegative: zscore.fn,
      precision: Math.round(zscore.precision * 10000) / 100,
      recall: Math.round(zscore.recall * 10000) / 100,
      f1: Math.round(zscore.f1 * 10000) / 100
    },

    winner
  })
})

router.get('/slow', async (req, res) => {
  const delay = parseInt(req.query.ms) || 2500

  await new Promise(r => setTimeout(r, delay))

  res.json({
    ok: true,
    delayed: delay
  })
})

function getBitcoinInstance() {
  return getInstance('bitcoin-demo', {
    resolution: 1000,
    cycle: 200000
  })
}

let _btcPrice = 95000 + Math.random() * 5000

function fetchBitcoinPrice() {
  const change = (Math.random() - 0.5) * 0.04

  _btcPrice = Math.max(
    50000,
    _btcPrice * (1 + change)
  )

  return _btcPrice
}

router.get('/bitcoin/tick', async (req, res) => {
  try {
    const value = fetchBitcoinPrice()

    const result =
      getBitcoinInstance().process(value)

    const decision =
      await layer.evaluate(result, {
        type: 'bitcoin_tick',
        value
      })

    if (handleDecision(res, decision)) return

    res.json({
      value,
      pair: 'BTC/USDT',
      ...result,
      decision
    })
  } catch {
    res.status(500).json({
      error: 'fetch failed'
    })
  }
})

router.get('/bitcoin/spike', async (req, res) => {
  try {
    const base = fetchBitcoinPrice()

    const spike =
      (Math.random() * 0.08 + 0.03) *
      (Math.random() > 0.5 ? 1 : -1)

    const value = base * (1 + spike)

    const result =
      getBitcoinInstance().process(value)

    const decision =
      await layer.evaluate(result, {
        type: 'bitcoin_spike',
        value
      })

    if (handleDecision(res, decision)) return

    res.json({
      value,
      base,
      spike,
      pair: 'BTC/USDT',
      ...result,
      decision
    })
  } catch {
    res.status(500).json({
      error: 'fetch failed'
    })
  }
})

async function fetchLatency(url) {
  const start = Date.now()

  try {
    const res = await fetch(url)

    const duration = Date.now() - start

    const status =
      duration > 2000
        ? 0
        : res.status

    return { duration, status }
  } catch {
    return {
      duration: 3000,
      status: 0
    }
  }
}

function latencyCategory(status, duration) {
  if (status === 0) return 'timeout'
  if (status >= 500) return 'server_error'
  if (status >= 400) return 'client_error'
  if (duration > 1000) return 'slow'

  return 'normal'
}

function getLatencyInstance(id) {
  return getInstance(id, {
    resolution: 200,
    cycle: 3000
  })
}

router.get('/latency/tick', async (req, res) => {
  const endpoint =
    'https://diginetz-api-production.up.railway.app/health'

  const { duration, status } =
    await fetchLatency(endpoint)

  const category =
    latencyCategory(status, duration)

  const result =
    getLatencyInstance('latency:health').process(duration)

  const decision =
    await layer.evaluate(result, {
      type: 'latency',
      endpoint,
      duration,
      status,
      category
    })

  if (handleDecision(res, decision)) return

  res.json({
    value: duration,
    unit: 'ms',
    endpoint,
    status,
    category,
    ...result,
    decision
  })
})

router.get('/latency/spike', async (req, res) => {
  const endpoint =
    'https://diginetz-api-production.up.railway.app/celf/slow'

  const { duration, status } =
    await fetchLatency(endpoint)

  const category =
    latencyCategory(status, duration)

  const result =
    getLatencyInstance('latency:health').process(duration)

  const decision =
    await layer.evaluate(result, {
      type: 'latency_spike',
      endpoint,
      duration,
      status,
      category
    })

  if (handleDecision(res, decision)) return

  res.json({
    value: duration,
    unit: 'ms',
    endpoint,
    status,
    category,
    ...result,
    decision
  })
})

router.post('/observe', async (req, res) => {
  const {
    id,
    value,
    options,
    event
  } = req.body

  if (!id) {
    return res.status(400).json({
      error: 'missing id'
    })
  }

  if (!Number.isFinite(value)) {
    return res.status(400).json({
      error: 'invalid value'
    })
  }

  const result =
    getInstance(id, options ?? {}).process(value)

  const decision =
    await layer.evaluate(result, event ?? null)

  if (handleDecision(res, decision)) return

  res.json({
    ...result,
    decision
  })
})

router.get('/summary/:id', (req, res) => {
  if (!instances.has(req.params.id)) {
    return res.status(404).json({
      error: 'instance not found'
    })
  }

  res.json(
    getInstance(req.params.id).getSummary()
  )
})

router.delete('/instance/:id', (req, res) => {
  instances.delete(req.params.id)

  res.json({
    ok: true,
    id: req.params.id
  })
})

router.get('/instances', (req, res) => {
  const list = []

  for (const [id, engine] of instances.entries()) {
    list.push({
      id,
      ...engine.getSummary()
    })
  }

  res.json({
    instances: list,
    total: list.length,
    max: MAX_INSTANCES
  })
})

export default router
