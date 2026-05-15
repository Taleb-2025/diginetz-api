import express from 'express'
import cors from 'cors'
import cycleguardRoute        from './api/cycleguard.route.js'
import cycleguardSessionRoute from './api/cycleguard-session.route.js'
import identityRoute          from './api/identity.route.js'
import celfRoute, { getMonitorData } from './api/celf.route.js'
import processTextRoute       from './api/process-text.route.js'
import indexCodeRoute         from './api/index-code.route.js'

const app  = express()
const PORT = process.env.PORT || 8080

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
app.use(express.raw({
  type: 'application/octet-stream',
  limit: '1mb'
}))
app.use(express.static('public'))

app.use('/api/cycleguard',  cycleguardRoute)
app.use('/api/cg-session',  cycleguardSessionRoute)
app.use('/api/identity',    identityRoute)
app.use('/celf',            celfRoute)
app.use('/celf',            processTextRoute)
app.use('/api/index-code',  indexCodeRoute)

app.get('/celf/monitor', (_req, res) => {
  return res.json(getMonitorData())
})

app.get('/', (_req, res) => {
  return res.json({
    service: 'DigiNetz TSL Core',
    engine:  'CyclicProcessorEngine + CELF_Engine_AI_V5',
    status:  'RUNNING'
  })
})

app.get('/health', (_req, res) => {
  return res.status(200).json({ ok: true })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log('DIGINETZ CORE RUNNING ON PORT ' + PORT)
})
