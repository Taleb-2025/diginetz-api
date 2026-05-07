import express from 'express'
import cors from 'cors'

import cycleguardRoute        from './api/cycleguard.route.js'
import cycleguardSessionRoute from './api/cycleguard-session.route.js'
import identityRoute          from './api/identity.route.js'
import celfRoute              from './api/celf.route.js'
import processTextRoute       from './api/process-text.route.js'

import { CELF_Engine_V8 }     from './engines/CELF_Engine_V8.js'

const app  = express()

const PORT =
  process.env.PORT || 8080

const MAX_MONITORS = 200

const monitors =
  new Map()

const monitorLog =
  new Map()

function getMonitor(key) {

  if (monitors.has(key)) {

    const engine =
      monitors.get(key)

    monitors.delete(key)

    monitors.set(key, engine)

    return engine
  }

  if (monitors.size >= MAX_MONITORS) {

    const oldest =
      monitors.keys().next().value

    monitors.delete(oldest)
  }

  const engine =
    new CELF_Engine_V8({

      resolution: 400,

      cycle: 3000,

      windowSize: 128,

      thresholdFactor: 2.0
    })

  monitors.set(key, engine)

  return engine
}

app.use(cors({

  origin: [

    'https://diginetz-template.com',

    'https://www.diginetz-template.com'
  ],

  methods: [
    'GET',
    'POST',
    'OPTIONS',
    'DELETE'
  ],

  allowedHeaders: [

    'Content-Type',

    'x-reference-id',

    'x-agent-key',

    'x-cg-api-key',

    'x-cg-pub-token'
  ]
}))

app.use(
  express.json({
    limit: '10mb'
  })
)

app.use(
  express.raw({
    type: 'application/octet-stream',
    limit: '1mb'
  })
)

app.use(
  express.static('public')
)

app.use((req, res, next) => {

  const start =
    Date.now()

  res.on('finish', () => {

    const duration =
      Date.now() - start

    if (res.statusCode >= 500) {
      return
    }

    const routePath =

      req.baseUrl &&
      req.route?.path

        ? req.baseUrl + req.route.path

        : req.baseUrl + req.path

    const key =
      req.method + ':' + routePath

    let value =
      duration

    if (res.statusCode >= 400) {
      value += 300
    }

    value =
      Math.min(value, 5000)

    const monitor =
      getMonitor(key)

    const result =
      monitor.observe(value)

    if (result.phase === 'warmup') {
      return
    }

    const isAnomaly =

      result.impossible ||

      (
        result.confidence < 0.25 &&
        result.phase === 'active'
      )

    if (!isAnomaly) {
      return
    }

    if (!monitorLog.has(key)) {
      monitorLog.set(key, [])
    }

    const list =
      monitorLog.get(key)

    list.unshift({

      time:
        new Date().toISOString(),

      key,

      path:
        req.path,

      method:
        req.method,

      status:
        res.statusCode,

      duration,

      phase:
        result.phase,

      maturityScore:
        result.maturityScore,

      confidence:
        result.confidence,

      threshold:
        result.threshold,

      jump:
        result.jump
    })

    if (list.length > 50) {
      list.pop()
    }
  })

  next()
})

app.use(
  '/api/cycleguard',
  cycleguardRoute
)

app.use(
  '/api/cg-session',
  cycleguardSessionRoute
)

app.use(
  '/api/identity',
  identityRoute
)

app.use(
  '/celf',
  celfRoute
)

app.use(
  '/celf',
  processTextRoute
)

app.get(
  '/celf/monitor',
  (req, res) => {

    const summaries = []

    for (
      const [key, engine]
      of monitors.entries()
    ) {

      summaries.push({

        key,

        ...engine.getSummary()
      })
    }

    const anomalies = []

    for (
      const [key, list]
      of monitorLog.entries()
    ) {

      anomalies.push({

        key,

        entries: list
      })
    }

    return res.json({

      totalMonitors:
        monitors.size,

      maxMonitors:
        MAX_MONITORS,

      monitors:
        summaries,

      anomalies
    })
  }
)

app.get('/', (_req, res) => {

  return res.json({

    service:
      'DigiNetz TSL Core',

    engine:
      'TSL + CPSE + CELF AI',

    status:
      'RUNNING'
  })
})

app.get('/health', (_req, res) => {

  return res.status(200).json({
    ok: true
  })
})

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      'DIGINETZ CORE RUNNING ON PORT ' +
      PORT
    )
  }
)
