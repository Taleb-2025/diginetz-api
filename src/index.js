import express from 'express'
import cors from 'cors'
import cycleguardRoute from './api/cycleguard.route.js'
import cycleguardSessionRoute from './api/cycleguard-session.route.js'
import identityRoute from './api/identity.route.js'
import celfRoute from './api/celf.route.js'
import { CELF_Engine_V6 } from './engines/CELF_Engine_V6.js'

const app  = express()
const PORT = process.env.PORT || 8080

const monitor    = new CELF_Engine_V6({
  resolution:      1000,
  cycle:           5000,
  windowSize:      128,
  thresholdFactor: 2.0
})

const monitorLog = []

app.use(cors({
  origin: [
    'https://diginetz-template.com',
    'https://www.diginetz-template.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'x-reference-id',
    'x-agent-key',
    'x-cg-api-key',
    'x-cg-pub-token'
  ]
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }))
app.use(express.static('public'))

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    const result   = monitor.observe(duration)

    if (result.impossible) {
      monitorLog.unshift({
        time:      new Date().toISOString(),
        path:      req.path,
        method:    req.method,
        status:    res.statusCode,
        duration,
        threshold: result.threshold,
        jump:      result.jump
      })
      if (monitorLog.length > 50) monitorLog.pop()
    }
  })
  next()
})

app.use('/api/cycleguard', cycleguardRoute)
app.use('/api/cg-session', cycleguardSessionRoute)
app.use('/api/identity',   identityRoute)
app.use('/celf',           celfRoute)

app.get('/celf/monitor', (req, res) => {
  res.json({
    summary:   monitor.getSummary(),
    anomalies: monitorLog
  })
})

app.get('/', (_req, res) => {
  res.json({ service: 'DigiNetz TSL Core', engine: 'TSL + CPSE v1.0 + CELF v6', status: 'RUNNING' })
})

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log('TSL CORE API RUNNING ON PORT ' + PORT)
})
