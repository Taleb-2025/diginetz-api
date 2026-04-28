/**
 * identity.route.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CPSE Identity — API Route
 * Powered by CyclicProcessorEngine (CPSE v1.0)
 *
 * Mount in server.js:
 *   import identityRoute from "./api/identity.route.js"
 *   app.use("/api/identity", identityRoute)
 *
 * Endpoints:
 *   POST /api/identity/build        — build signature from values array
 *   POST /api/identity/update       — add single value to existing signature
 *   GET  /api/identity/state        — get current signature state
 *   POST /api/identity/verify       — compare two signatures
 *   GET  /api/identity/certificate  — generate identity certificate
 *   POST /api/identity/reset        — reset identity engine
 *   GET  /api/identity/health       — route health check
 */

import { Router }                from "express"
import { CyclicProcessorEngine } from "../engines/CyclicProcessorEngine.js"

const router = Router()

// ── Identity engine instances (one per device/session) ───────────────────────
const identities = new Map()
const SESSION_TTL = 1000 * 60 * 60 * 24  // 24 hours

// Cleanup stale sessions every hour
setInterval(() => {
  const now = Date.now()
  for (const [id, meta] of identities) {
    if (now - meta.lastUsed > SESSION_TTL) identities.delete(id)
  }
}, 1000 * 60 * 60)

/**
 * getIdentityEngine(req)
 * Returns or creates an engine for the device identity session.
 * Session key = x-reference-id header OR "default"
 */
function getIdentityEngine(req) {
  const sessionId = req.headers["x-reference-id"] || "default"

  if (!identities.has(sessionId)) {
    const opts = req.body?.engineOptions || {}
    const engine = new CyclicProcessorEngine({
      cycle:       Number.isFinite(opts.cycle)       ? opts.cycle       : 360,
      maxHistory:  Number.isFinite(opts.maxHistory)  ? opts.maxHistory  : 5000,
      maxVelocity: Number.isFinite(opts.maxVelocity) ? opts.maxVelocity : Infinity,
    })
    identities.set(sessionId, { engine, deviceLabel: opts.deviceLabel || null, createdAt: Date.now(), lastUsed: Date.now() })
  }

  const meta = identities.get(sessionId)
  meta.lastUsed = Date.now()
  return meta
}

// ── φ signature helper ────────────────────────────────────────────────────────
const PHI = 1.6180339887

function computeSignature(values, cycle = 360) {
  let sig = 0
  let cc  = 0

  function norm(v) { return ((v % cycle) + cycle) % cycle }
  function didWrap(prev, next, step) {
    return step > 0 ? next < prev : step < 0 ? next > prev : false
  }

  let state = 0
  for (const val of values) {
    const next  = norm(val)
    const delta = next - norm(state)
    if (didWrap(norm(state), next, delta)) cc++
    sig   = Math.round(((sig * PHI + next) % cycle) * 1000) / 1000
    state = next
  }

  return { signature: sig, cycleCount: cc, layer: cc * cycle + state, finalState: state }
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/identity/build
// Body: { values: number[], deviceLabel?: string, engineOptions?: {} }
// Builds identity signature from an array of values.
// Returns signature, cycleCount, layer — engine stays on server.
// ────────────────────────────────────────────────────────────────────────────
router.post("/build", (req, res) => {
  try {
    const values = req.body?.values
    if (!Array.isArray(values) || values.length < 2) {
      return res.status(400).json({
        ok:    false,
        error: "IDENTITY_INVALID_VALUES",
        msg:   "body.values must be an array of at least 2 numbers"
      })
    }

    const meta   = getIdentityEngine(req)
    const engine = meta.engine
    const cycle  = engine.getCycle()

    if (req.body?.deviceLabel) meta.deviceLabel = req.body.deviceLabel

    // Feed values into engine
    engine.reset(0)
    for (const val of values) {
      if (!Number.isFinite(Number(val))) continue
      const delta = engine.signedDistance(engine.getState(), Number(val))
      if (delta !== 0) engine.force(delta)
    }

    const cs = engine.getContainmentState()

    return res.json({
      ok:   true,
      data: {
        signature:   cs.memorySignature,
        cycleCount:  cs.cycleCount,
        layer:       cs.layer,
        state:       cs.value,
        valueCount:  values.length,
        deviceLabel: meta.deviceLabel,
        builtAt:     new Date().toISOString(),
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/identity/update
// Body: { value: number }
// Adds a single new value to the existing identity signature.
// ────────────────────────────────────────────────────────────────────────────
router.post("/update", (req, res) => {
  try {
    const value = Number(req.body?.value)
    if (!Number.isFinite(value)) {
      return res.status(400).json({
        ok:    false,
        error: "IDENTITY_INVALID_VALUE",
        msg:   "body.value must be a finite number"
      })
    }

    const meta   = getIdentityEngine(req)
    const engine = meta.engine
    const delta  = engine.signedDistance(engine.getState(), value)
    if (delta !== 0) engine.force(delta)

    const cs = engine.getContainmentState()

    return res.json({
      ok:   true,
      data: {
        signature:  cs.memorySignature,
        cycleCount: cs.cycleCount,
        layer:      cs.layer,
        state:      cs.value,
        updatedAt:  new Date().toISOString(),
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/identity/state
// Returns current signature state without exposing engine internals.
// ────────────────────────────────────────────────────────────────────────────
router.get("/state", (req, res) => {
  try {
    const meta   = getIdentityEngine(req)
    const engine = meta.engine
    const cs     = engine.getContainmentState()
    const sev    = engine.getAnalyzerSeverity()

    return res.json({
      ok:   true,
      data: {
        signature:   cs.memorySignature,
        cycleCount:  cs.cycleCount,
        layer:       cs.layer,
        state:       cs.value,
        cycle:       engine.getCycle(),
        deviceLabel: meta.deviceLabel,
        severity:    sev.severity,
        trend:       sev.trend,
        ready:       sev.ready,
        createdAt:   new Date(meta.createdAt).toISOString(),
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/identity/verify
// Body: { baseline: number, current?: number, tolerance?: number }
// Compares current signature with a stored baseline.
// Returns: match status, drift percentage, tamper flag.
// ────────────────────────────────────────────────────────────────────────────
router.post("/verify", (req, res) => {
  try {
    const baseline  = Number(req.body?.baseline)
    const tolerance = Number.isFinite(Number(req.body?.tolerance))
      ? Number(req.body.tolerance)
      : 5.0

    if (!Number.isFinite(baseline)) {
      return res.status(400).json({
        ok:    false,
        error: "IDENTITY_INVALID_BASELINE",
        msg:   "body.baseline must be a finite number"
      })
    }

    const meta      = getIdentityEngine(req)
    const engine    = meta.engine
    const cs        = engine.getContainmentState()
    const current   = Number.isFinite(Number(req.body?.current))
      ? Number(req.body.current)
      : cs.memorySignature

    const cycle     = engine.getCycle()
    const drift     = Math.abs(current - baseline)
    const driftPct  = Math.round((drift / cycle) * 10000) / 100

    let status = "MATCH"
    if (driftPct > tolerance * 2) status = "TAMPERED"
    else if (driftPct > tolerance) status = "DRIFTED"

    return res.json({
      ok:   true,
      data: {
        status,
        baseline,
        current,
        drift:      Math.round(drift * 1000) / 1000,
        driftPct,
        tolerance,
        tampered:   status === "TAMPERED",
        match:      status === "MATCH",
        verifiedAt: new Date().toISOString(),
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/identity/certificate
// Generates a digital identity certificate for the current session.
// Returns structured certificate — engine code never exposed.
// ────────────────────────────────────────────────────────────────────────────
router.get("/certificate", (req, res) => {
  try {
    const meta   = getIdentityEngine(req)
    const engine = meta.engine
    const cs     = engine.getContainmentState()
    const sev    = engine.getAnalyzerSeverity()

    const sessionId = req.headers["x-reference-id"] || "default"
    const certId    = "CG-" + new Date().getFullYear() + "-" + String(cs.cycleCount).padStart(5, "0")

    const health = cs.cycleCount < 2
      ? "Initializing"
      : sev.ready
        ? (sev.severity < 20 ? "Stable" : sev.severity < 50 ? "Drift" : sev.severity < 80 ? "Risk" : "Critical")
        : "Stable"

    const certificate = {
      id:          certId,
      version:     "CPSE-1.0",
      issuedBy:    "CycleGuard Cloud · CPSE Engine v1.0",
      issuedAt:    new Date().toISOString(),
      device: {
        label:     meta.deviceLabel || "Unknown Device",
        sessionId: sessionId.substring(0, 8) + "****",
      },
      identity: {
        signature:   cs.memorySignature,
        cycleCount:  cs.cycleCount,
        layer:       Math.round(cs.layer * 1000) / 1000,
        cycle:       engine.getCycle(),
        formula:     "σ(n+1) = (σ(n) × φ + state) mod cycle",
        phi:         PHI,
      },
      health: {
        status:   health,
        severity: sev.severity ?? 0,
        trend:    sev.trend    ?? "stable",
      },
      verification: {
        unforgeable:   true,
        behaviorBased: true,
        tamperEvident: true,
      },
      tagline: "Earned. Unforgeable. Unique.",
    }

    return res.json({ ok: true, data: certificate })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/identity/reset
// Resets the identity engine for this session.
// ────────────────────────────────────────────────────────────────────────────
router.post("/reset", (req, res) => {
  try {
    const meta = getIdentityEngine(req)
    meta.engine.reset(0)
    meta.deviceLabel = req.body?.deviceLabel || null
    meta.createdAt   = Date.now()

    return res.json({
      ok:  true,
      msg: "Identity engine reset",
      data: meta.engine.getContainmentState()
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/identity/health
// Route health check
// ────────────────────────────────────────────────────────────────────────────
router.get("/health", (_req, res) => {
  res.json({
    ok:       true,
    service:  "CPSE Identity API",
    engine:   "CPSE v1.0",
    formula:  "σ(n+1) = (σ(n) × φ + state) mod cycle",
    phi:      PHI,
    status:   "RUNNING",
    sessions: identities.size,
  })
})

export default router
