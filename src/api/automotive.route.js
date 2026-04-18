'use strict'

/**
 * automotive.route.js
 * REST API routes for DigiNetz TSL Automotive
 *
 * Path: src/api/automotive.route.js
 *
 * Endpoints:
 *   GET  /api/automotive/status          → vehicle health status
 *   POST /api/automotive/push            → receive data from OBD agent
 *   POST /api/automotive/push-shortcut   → receive data from iOS / Dashboard
 *   POST /api/automotive/obd-cmd         → TCP proxy to ELM327
 *   POST /api/automotive/simulate        → control simulation
 *   GET  /api/automotive/scenarios       → list available scenarios
 *   POST /api/automotive/recalibrate     → reset all analyzers
 *   GET  /api/automotive/pids            → list PID configurations
 */

import { Router }          from 'express'
import { OBDSimulator }    from '../obd/OBDSimulator.js'
import { AnalyzerManager } from '../obd/AnalyzerManager.js'
import { obdCommand }      from '../obd/OBDProxy.js'

const router    = Router()
const simulator = new OBDSimulator()
const manager   = new AnalyzerManager()

// ─── Internal: feed data into manager ────────────────────────────────────────

function feed(data) {
  manager.process(data)
}

// ─── GET /api/automotive/status ──────────────────────────────────────────────
// Returns full vehicle health status
// Called by Dashboard every 500ms

router.get('/status', (_req, res) => {
  if (!manager.hasData()) {
    return res.json({
      ready:   false,
      message: 'No data yet. Start simulation or connect OBD agent.'
    })
  }
  res.json({
    ready: true,
    ...manager.getStatus()
  })
})

// ─── POST /api/automotive/push ───────────────────────────────────────────────
// Receives data from OBD agent running on Laptop
// Body: { name, value, time, source }

router.post('/push', (req, res) => {
  const key = req.headers['x-agent-key']
  if (key !== process.env.AGENT_KEY) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const { name, value, time, source } = req.body

  if (!name || value === undefined) {
    return res.status(400).json({ error: 'missing name or value' })
  }

  const result = manager.process({
    name,
    value:  parseFloat(value),
    time:   time ?? Date.now(),
    source: source ?? 'obd'
  })

  if (!result) {
    return res.status(400).json({ error: `unknown PID: ${name}` })
  }

  res.json({
    ok:     true,
    name,
    health: result.health,
    status: result.status
  })
})

// ─── POST /api/automotive/push-shortcut ──────────────────────────────────────
// Receives data from iOS Shortcut or Dashboard directly
// Body: { rpm, speed, coolant, throttle, load, key }

router.post('/push-shortcut', (req, res) => {
  const { rpm, speed, coolant, throttle, load, key } = req.body ?? {}

  if (key !== process.env.AGENT_KEY) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const readings = [
    { name: 'RPM',      value: rpm      },
    { name: 'SPEED',    value: speed    },
    { name: 'COOLANT',  value: coolant  },
    { name: 'THROTTLE', value: throttle },
    { name: 'LOAD',     value: load     }
  ]

  const results = {}

  for (const r of readings) {
    if (r.value !== null && r.value !== undefined) {
      const parsed = parseFloat(r.value)
      if (!isNaN(parsed)) {
        const result = manager.process({
          name:   r.name,
          value:  parsed,
          time:   Date.now(),
          source: 'ios'
        })
        if (result) {
          results[r.name] = {
            health:   result.health,
            status:   result.status,
            behavior: result.behaviorVector?.behavior ?? null
          }
        }
      }
    }
  }

  res.json({
    ok:     true,
    source: 'ios',
    results
  })
})

// ─── POST /api/automotive/obd-cmd ────────────────────────────────────────────
// TCP proxy — يتصل بـ ELM327 مباشرة ويرجع الرد للـ Dashboard
// Body: { ip, cmd, key }
// ip  = "192.168.0.10:35000"
// cmd = "010C\r"  (OBD PID command)

router.post('/obd-cmd', async (req, res) => {
  const { ip, cmd, key } = req.body ?? {}

  // Security check
  if (key !== process.env.AGENT_KEY) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  if (!ip || !cmd) {
    return res.status(400).json({ error: 'missing ip or cmd' })
  }

  // Parse IP:Port
  const parts = ip.split(':')
  const host  = parts[0]
  const port  = parseInt(parts[1] ?? '35000')

  if (!host || isNaN(port)) {
    return res.status(400).json({ error: 'invalid ip format. Use: 192.168.0.10:35000' })
  }

  try {
    const response = await obdCommand(host, port, cmd, 3000)
    res.json({ ok: true, response })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ─── POST /api/automotive/simulate ───────────────────────────────────────────
// Controls the OBD simulator
// Body: { action: 'start' | 'stop' | 'scenario', scenario?: string }

router.post('/simulate', (req, res) => {
  const { action, scenario } = req.body ?? {}

  switch (action) {

    case 'start': {
      if (simulator.isActive()) {
        return res.json({ ok: true, message: 'Simulator already running' })
      }
      const sc = scenario ?? 'normal'
      simulator.setScenario(sc)
      simulator.start(feed, 500)
      return res.json({
        ok:       true,
        message:  'Simulator started',
        scenario: sc
      })
    }

    case 'stop': {
      simulator.stop()
      return res.json({ ok: true, message: 'Simulator stopped' })
    }

    case 'scenario': {
      if (!scenario) {
        return res.status(400).json({ error: 'scenario name required' })
      }
      try {
        simulator.setScenario(scenario)
        if (!simulator.isActive()) simulator.start(feed, 500)
        return res.json({
          ok:       true,
          message:  'Scenario changed',
          scenario
        })
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }
    }

    default:
      return res.status(400).json({
        error: 'invalid action. Use: start | stop | scenario'
      })
  }
})

// ─── GET /api/automotive/scenarios ───────────────────────────────────────────
// Lists all available simulation scenarios

router.get('/scenarios', (_req, res) => {
  res.json({
    active:    simulator.isActive(),
    current:   simulator.getScenario(),
    scenarios: simulator.getScenarios()
  })
})

// ─── POST /api/automotive/recalibrate ────────────────────────────────────────
// Resets all analyzers to baseline
// Body: { pid?: string }  — omit pid to reset all

router.post('/recalibrate', (req, res) => {
  const { pid } = req.body ?? {}
  manager.recalibrate(pid ?? null)
  res.json({
    ok:      true,
    message: pid ? `Recalibrated ${pid}` : 'All analyzers recalibrated'
  })
})

// ─── GET /api/automotive/pids ────────────────────────────────────────────────
// Returns PID list with configurations

router.get('/pids', (_req, res) => {
  res.json({
    pids: manager.getPIDList()
  })
})

export default router
