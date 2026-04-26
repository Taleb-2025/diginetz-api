/**
 * cycleguard.route.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CycleGuard Cloud — API Route
 * Powered by CyclicProcessorEngine (CPSE v1.0)
 *
 * Mount in server.js:
 *   import cycleguardRoute from "./api/cycleguard.route.js"
 *   app.use("/api/cycleguard", cycleguardRoute)
 *
 * Endpoints:
 *   POST /api/cycleguard/analyze      — analyze a single value
 *   POST /api/cycleguard/learn        — learn pattern from array
 *   GET  /api/cycleguard/state        — get current engine state
 *   POST /api/cycleguard/reset        — reset engine
 *   GET  /api/cycleguard/snapshot     — full snapshot
 *   POST /api/cycleguard/restore      — restore from snapshot
 *   GET  /api/cycleguard/health       — route health check
 */

import { Router }               from "express"
import { CyclicProcessorEngine } from "../engines/CyclicProcessorEngine.js"

const router = Router()

// ── Engine instances (one per session key) ───────────────────────────────────
// Simple in-memory map: sessionId → engine instance
// For production: replace with Redis or persistent store
const engines = new Map()
const SESSION_TTL = 1000 * 60 * 60 * 2  // 2 hours

// Cleanup stale sessions every 30 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, meta] of engines) {
    if (now - meta.lastUsed > SESSION_TTL) {
      engines.delete(id)
    }
  }
}, 1000 * 60 * 30)

/**
 * getEngine(req)
 * Returns the engine for the session, creating one if needed.
 * Session key = x-reference-id header OR "default"
 */
function getEngine(req) {
  const sessionId = req.headers["x-reference-id"] || "default"

  if (!engines.has(sessionId)) {
    const opts = req.body?.engineOptions || {}
    const engine = new CyclicProcessorEngine({
      cycle:        Number.isFinite(opts.cycle)        ? opts.cycle        : 360,
      step:         Number.isFinite(opts.step)         ? opts.step         : 1,
      initialState: Number.isFinite(opts.initialState) ? opts.initialState : 0,
      maxVelocity:  Number.isFinite(opts.maxVelocity)  ? opts.maxVelocity  : Infinity,
      maxHistory:   Number.isFinite(opts.maxHistory)   ? opts.maxHistory   : 1000,
      analyzer: {
        baseThreshold:    opts.baseThreshold    ?? 50,
        historyWindow:    opts.historyWindow     ?? 20,
        trendBufferSize:  opts.trendBufferSize   ?? 5,
        scoreHistorySize: opts.scoreHistorySize  ?? 10,
        intervalMs:       opts.intervalMs        ?? 3600000,
      }
    })
    engines.set(sessionId, { engine, lastUsed: Date.now() })
  }

  const meta = engines.get(sessionId)
  meta.lastUsed = Date.now()
  return meta.engine
}

// ── Middleware: validate numeric value ────────────────────────────────────────
function requireValue(req, res, next) {
  const val = req.body?.value
  if (!Number.isFinite(Number(val))) {
    return res.status(400).json({
      ok:    false,
      error: "CPE_INVALID_VALUE",
      msg:   "body.value must be a finite number"
    })
  }
  next()
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cycleguard/analyze
// Body: { value: number, engineOptions?: {...} }
// Returns: full CPSE analyze() report + containment state
// ────────────────────────────────────────────────────────────────────────────
router.post("/analyze", requireValue, (req, res) => {
  try {
    const engine = getEngine(req)
    const value  = Number(req.body.value)

    const report = engine.analyze(value)

    return res.json({
      ok:   true,
      data: report
    })

  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cycleguard/learn
// Body: { values: number[], engineOptions?: {...} }
// Trains the engine's pattern recognition
// ────────────────────────────────────────────────────────────────────────────
router.post("/learn", (req, res) => {
  try {
    const values = req.body?.values

    if (!Array.isArray(values) || values.length < 2) {
      return res.status(400).json({
        ok:    false,
        error: "CPE_INVALID_LEARN_VALUES",
        msg:   "body.values must be an array of at least 2 numbers"
      })
    }

    const engine = getEngine(req)
    engine.learnPattern(values.map(Number))

    return res.json({
      ok:  true,
      msg: "Pattern learned from " + values.length + " values",
      learned: values.length
    })

  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cycleguard/state
// Returns current containment state + analyzer severity
// ────────────────────────────────────────────────────────────────────────────
router.get("/state", (req, res) => {
  try {
    const engine = getEngine(req)

    return res.json({
      ok:   true,
      data: {
        containment: engine.getContainmentState(),
        severity:    engine.getAnalyzerSeverity(),
        cycle:       engine.getCycle(),
        step:        engine.getStep(),
        maxVelocity: engine.getMaxVelocity(),
      }
    })

  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cycleguard/reset
// Body: { state?: number }
// Resets engine to given state (default 0)
// ────────────────────────────────────────────────────────────────────────────
router.post("/reset", (req, res) => {
  try {
    const engine = getEngine(req)
    const state  = Number.isFinite(Number(req.body?.state))
      ? Number(req.body.state)
      : 0

    engine.reset(state)
    engine.recalibrateAnalyzer()

    return res.json({
      ok:   true,
      msg:  "Engine reset to state " + state,
      state: engine.getContainmentState()
    })

  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cycleguard/snapshot
// Returns full engine snapshot (state + history + containment)
// ────────────────────────────────────────────────────────────────────────────
router.get("/snapshot", (req, res) => {
  try {
    const engine   = getEngine(req)
    const snapshot = engine.snapshot()

    return res.json({
      ok:   true,
      data: snapshot
    })

  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cycleguard/restore
// Body: { snapshot: {...} }
// Restores engine from a previous snapshot
// ────────────────────────────────────────────────────────────────────────────
router.post("/restore", (req, res) => {
  try {
    const snapshot = req.body?.snapshot

    if (!snapshot) {
      return res.status(400).json({
        ok:    false,
        error: "CPE_MISSING_SNAPSHOT",
        msg:   "body.snapshot is required"
      })
    }

    const engine = getEngine(req)
    engine.restore(snapshot)

    return res.json({
      ok:    true,
      msg:   "Engine restored",
      state: engine.getContainmentState()
    })

  } catch (err) {
    return res.status(400).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cycleguard/process
// Body: { input?: any, engineOptions?: {...} }
// Runs the processor pipeline (for custom processors via plugins)
// ────────────────────────────────────────────────────────────────────────────
router.post("/process", (req, res) => {
  try {
    const engine = getEngine(req)
    const input  = req.body?.input ?? null
    const result = engine.process(input)

    return res.json({
      ok:   true,
      data: result
    })

  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cycleguard/history
// Returns engine history (last N entries)
// Query: ?limit=50
// ────────────────────────────────────────────────────────────────────────────
router.get("/history", (req, res) => {
  try {
    const engine  = getEngine(req)
    const limit   = Math.min(parseInt(req.query.limit) || 50, 500)
    const history = engine.getHistory().slice(-limit)

    return res.json({
      ok:    true,
      count: history.length,
      data:  history
    })

  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err.message
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cycleguard/health
// Simple health check for this route
// ────────────────────────────────────────────────────────────────────────────
router.get("/health", (_req, res) => {
  res.json({
    ok:      true,
    service: "CycleGuard API",
    engine:  "CPSE v1.0",
    status:  "RUNNING",
    sessions: engines.size
  })
})

export default router
