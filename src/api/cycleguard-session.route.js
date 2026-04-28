/**
 * cycleguard-session.route.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CyclicGuard Session — API Route
 * Powered by CyclicProcessorEngine (CPSE v1.0)
 *
 * Mount in server.js:
 *   import cgSessionRoute from "./api/cycleguard-session.route.js"
 *   app.use("/api/cg-session", cgSessionRoute)
 *
 * Endpoints:
 *   POST /api/cg-session/register         — register a new workspace, get API Key
 *   POST /api/cg-session/track            — send behavioral events for a user
 *   GET  /api/cg-session/trust/:userId    — get trust score for a user
 *   GET  /api/cg-session/users            — list all tracked users in workspace
 *   POST /api/cg-session/learn            — teach normal pattern for a user
 *   POST /api/cg-session/reset/:userId    — reset engine for a user
 *   GET  /api/cg-session/history/:userId  — get event history for a user
 *   GET  /api/cg-session/health           — health check
 *
 * Auth:
 *   Every request (except /register and /health) requires:
 *   Header: x-cg-api-key: cg_live_xxxx
 *
 * Architecture:
 *   Workspace (API Key)
 *     └── User (userId)
 *           └── CyclicProcessorEngine instance
 */

import { Router }                from "express"
import { randomBytes }           from "crypto"
import { CyclicProcessorEngine } from "../engines/CyclicProcessorEngine.js"

const router = Router()

// ── In-memory stores ──────────────────────────────────────────────────────────
// Production: replace with Redis or a database

/**
 * workspaces: Map<apiKey, WorkspaceMeta>
 * WorkspaceMeta = { apiKey, name, domain, createdAt, lastUsed }
 */
const workspaces = new Map()

/**
 * engines: Map<apiKey, Map<userId, EngineMeta>>
 * EngineMeta = { engine, lastUsed, eventCount, createdAt }
 */
const engines = new Map()

// TTL constants
const SESSION_TTL   = 1000 * 60 * 60 * 4   // 4 hours inactivity
const WORKSPACE_TTL = 1000 * 60 * 60 * 24  // 24 hours inactivity

// ── Cleanup stale sessions every 30 minutes ───────────────────────────────────
setInterval(() => {
  const now = Date.now()

  for (const [apiKey, userMap] of engines) {
    for (const [userId, meta] of userMap) {
      if (now - meta.lastUsed > SESSION_TTL) {
        userMap.delete(userId)
      }
    }
    if (userMap.size === 0) engines.delete(apiKey)
  }

  for (const [apiKey, ws] of workspaces) {
    if (now - ws.lastUsed > WORKSPACE_TTL) {
      workspaces.delete(apiKey)
      engines.delete(apiKey)
    }
  }
}, 1000 * 60 * 30)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * generateApiKey()
 * Generates a secure API key: cg_live_<32 random hex chars>
 */
function generateApiKey() {
  return "cg_live_" + randomBytes(16).toString("hex")
}

/**
 * getEngine(apiKey, userId, options?)
 * Returns or creates a CyclicProcessorEngine for this workspace + user.
 */
function getEngine(apiKey, userId, options = {}) {
  if (!engines.has(apiKey)) engines.set(apiKey, new Map())
  const userMap = engines.get(apiKey)

  if (!userMap.has(userId)) {
    const engine = new CyclicProcessorEngine({
      cycle:        360,
      step:         1,
      initialState: 0,
      maxVelocity:  Infinity,
      maxHistory:   500,
      analyzer: {
        baseThreshold:    options.baseThreshold    ?? 40,
        historyWindow:    options.historyWindow    ?? 20,
        trendBufferSize:  options.trendBufferSize  ?? 5,
        scoreHistorySize: options.scoreHistorySize ?? 10,
        intervalMs:       options.intervalMs       ?? 3600000,
      }
    })
    userMap.set(userId, {
      engine,
      lastUsed:   Date.now(),
      eventCount: 0,
      createdAt:  Date.now(),
    })
  }

  const meta = userMap.get(userId)
  meta.lastUsed = Date.now()
  return meta
}

/**
 * eventsToValue(events)
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts an array of behavioral events into a single numeric value (0–360)
 * that the CyclicProcessorEngine can analyze.
 *
 * Logic:
 *   1. Speed score   — actions per second (normalized)
 *   2. Risk score    — weighted by event type risk level
 *   3. Burst score   — spike detection (many events in short time)
 *   4. Final value   — weighted combination mapped to 0–360
 *
 * Higher value = more anomalous behavior
 */
function eventsToValue(events) {
  if (!Array.isArray(events) || events.length === 0) return 0

  const RISK_WEIGHTS = {
    export:     1.0,
    download:   0.9,
    delete:     0.9,
    admin:      0.8,
    bulk:       0.8,
    payment:    0.8,
    navigation: 0.2,
    click:      0.15,
    keypress:   0.1,
    scroll:     0.05,
    other:      0.3,
  }

  // 1. Speed score — events per second
  const timestamps = events
    .map(e => e.timestamp)
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b)

  let speedScore = 0
  if (timestamps.length >= 2) {
    const spanMs = Math.max(timestamps[timestamps.length - 1] - timestamps[0], 1)
    const epsRaw = (events.length / spanMs) * 1000  // events per second
    speedScore   = Math.min(1, epsRaw / 10)          // normalize: 10 eps = max
  }

  // 2. Risk score — weighted average of event types
  const totalRisk = events.reduce((sum, e) => {
    const type   = (e.type ?? "other").toLowerCase()
    const weight = RISK_WEIGHTS[type] ?? RISK_WEIGHTS.other
    const speed  = Number.isFinite(e.speed) ? Math.min(e.speed / 20, 1) : 0
    return sum + weight + speed * 0.3
  }, 0)
  const riskScore = Math.min(1, totalRisk / events.length)

  // 3. Burst score — detect micro-bursts (many events in < 2 seconds)
  let burstScore = 0
  if (timestamps.length >= 3) {
    let maxBurst = 0
    for (let i = 2; i < timestamps.length; i++) {
      const window = timestamps[i] - timestamps[i - 2]
      if (window < 2000) maxBurst = Math.max(maxBurst, 3 / (window / 1000))
    }
    burstScore = Math.min(1, maxBurst / 15)
  }

  // 4. Device change flag
  const devices    = [...new Set(events.map(e => e.device).filter(Boolean))]
  const deviceFlag = devices.length > 1 ? 0.8 : 0

  // 5. Weighted final value → mapped to 0–360
  const combined = (
    speedScore  * 0.30 +
    riskScore   * 0.35 +
    burstScore  * 0.25 +
    deviceFlag  * 0.10
  )

  return Math.round(combined * 360)
}

/**
 * buildTrustScore(report)
 * Converts CPSE analyze() report into a 0–100 trust score.
 * Higher = more trustworthy.
 */
function buildTrustScore(report) {
  return Math.max(0, Math.min(100, 100 - (report.severity ?? 0)))
}

// ── Middleware: validate API Key ───────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers["x-cg-api-key"]

  if (!key) {
    return res.status(401).json({
      ok:    false,
      error: "CGS_MISSING_API_KEY",
      msg:   "Header x-cg-api-key is required"
    })
  }

  if (!workspaces.has(key)) {
    return res.status(403).json({
      ok:    false,
      error: "CGS_INVALID_API_KEY",
      msg:   "Invalid or expired API key"
    })
  }

  // Update workspace lastUsed
  workspaces.get(key).lastUsed = Date.now()
  req.apiKey    = key
  req.workspace = workspaces.get(key)
  next()
}

// ── Middleware: validate userId ───────────────────────────────────────────────
function requireUserId(req, res, next) {
  const userId = req.body?.userId || req.params?.userId
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    return res.status(400).json({
      ok:    false,
      error: "CGS_MISSING_USER_ID",
      msg:   "userId is required"
    })
  }
  req.userId = userId.trim()
  next()
}

// ── Simple rate limiter ───────────────────────────────────────────────────────
const rateLimitStore = new Map()

function rateLimit(maxPerMinute = 120) {
  return (req, res, next) => {
    const key = req.apiKey + ":" + req.ip
    const now = Date.now()

    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 1, windowStart: now })
      return next()
    }

    const entry = rateLimitStore.get(key)

    if (now - entry.windowStart > 60000) {
      entry.count       = 1
      entry.windowStart = now
      return next()
    }

    entry.count++
    if (entry.count > maxPerMinute) {
      return res.status(429).json({
        ok:    false,
        error: "CGS_RATE_LIMIT",
        msg:   `Rate limit exceeded: max ${maxPerMinute} requests/minute`
      })
    }

    next()
  }
}

// Cleanup rate limit store every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > 60000) rateLimitStore.delete(key)
  }
}, 1000 * 60 * 5)

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/register
// Body: { name: string, domain: string, plan?: string }
// Returns: { apiKey, workspaceId, snippet }
// ────────────────────────────────────────────────────────────────────────────
router.post("/register", (req, res) => {
  try {
    const { name, domain, plan } = req.body ?? {}

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        ok:    false,
        error: "CGS_MISSING_NAME",
        msg:   "body.name is required"
      })
    }

    if (!domain || typeof domain !== "string") {
      return res.status(400).json({
        ok:    false,
        error: "CGS_MISSING_DOMAIN",
        msg:   "body.domain is required"
      })
    }

    const apiKey = generateApiKey()

    workspaces.set(apiKey, {
      apiKey,
      name:      name.trim(),
      domain:    domain.trim(),
      plan:      plan ?? "starter",
      createdAt: Date.now(),
      lastUsed:  Date.now(),
    })

    // JS Snippet for the client to embed
    const snippet = `
<!-- CyclicGuard Session — v1.0 -->
<script>
(function() {
  var CG = {
    apiKey:  "${apiKey}",
    baseUrl: "https://diginetz-api-production.up.railway.app/api/cg-session",
    userId:  null,
    buffer:  [],
    flushMs: 5000,

    identify: function(userId) {
      this.userId = userId;
      this._startFlush();
    },

    track: function(type, target, extra) {
      if (!this.userId) return;
      this.buffer.push(Object.assign({
        type:      type,
        target:    target || "",
        timestamp: Date.now(),
        device:    navigator.userAgent.substring(0, 80),
        speed:     0
      }, extra || {}));
    },

    _startFlush: function() {
      var self = this;
      setInterval(function() { self._flush(); }, self.flushMs);
      self._autoTrack();
    },

    _flush: function() {
      if (!this.userId || this.buffer.length === 0) return;
      var events = this.buffer.splice(0, this.buffer.length);
      fetch(this.baseUrl + "/track", {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cg-api-key": this.apiKey
        },
        body: JSON.stringify({ userId: this.userId, events: events })
      }).catch(function() {});
    },

    _autoTrack: function() {
      var self = this;
      var last = Date.now(); var count = 0;

      document.addEventListener("click", function(e) {
        count++;
        var now = Date.now();
        var speed = count / Math.max((now - last) / 1000, 0.1);
        self.track("click", e.target?.tagName || "", { speed: speed });
        last = now; count = 0;
      });

      window.addEventListener("popstate", function() {
        self.track("navigation", location.pathname);
      });

      document.addEventListener("keypress", function() {
        count++;
        self.track("keypress", "", { speed: count });
      });
    }
  };
  window.CyclicGuard = CG;
})();
<\/script>
<!-- End CyclicGuard Session -->`.trim()

    return res.status(201).json({
      ok:   true,
      msg:  "Workspace registered successfully",
      data: {
        apiKey,
        workspace: workspaces.get(apiKey),
        snippet,
        quickStart: {
          step1: "Add the snippet to your HTML <head>",
          step2: "Call CyclicGuard.identify('your-user-id') after login",
          step3: "Monitor trust scores at GET /api/cg-session/trust/:userId",
        }
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/track
// Header: x-cg-api-key
// Body: { userId: string, events: Event[] }
// Returns: full CPSE analyze() report + trust score
// ────────────────────────────────────────────────────────────────────────────
router.post("/track", requireApiKey, rateLimit(200), requireUserId, (req, res) => {
  try {
    const { events } = req.body ?? {}

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        ok:    false,
        error: "CGS_MISSING_EVENTS",
        msg:   "body.events must be a non-empty array"
      })
    }

    if (events.length > 500) {
      return res.status(400).json({
        ok:    false,
        error: "CGS_TOO_MANY_EVENTS",
        msg:   "Maximum 500 events per request"
      })
    }

    const value  = eventsToValue(events)
    const meta   = getEngine(req.apiKey, req.userId)
    const report = meta.engine.analyze(value)
    const trust  = buildTrustScore(report)

    meta.eventCount += events.length

    return res.json({
      ok:   true,
      data: {
        userId:     req.userId,
        trust,
        status:     report.status,
        health:     report.health,
        severity:   report.severity,
        trend:      report.trend,
        explain:    report.explain,
        containment: report.containment,
        behaviorVector: report.behaviorVector,
        forecast:   report.forecast,
        eventCount: meta.eventCount,
        raw:        report,
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/trust/:userId
// Header: x-cg-api-key
// Returns: quick trust score + severity (no full analysis)
// ────────────────────────────────────────────────────────────────────────────
router.get("/trust/:userId", requireApiKey, rateLimit(300), requireUserId, (req, res) => {
  try {
    const userMap = engines.get(req.apiKey)

    if (!userMap || !userMap.has(req.userId)) {
      return res.json({
        ok:   true,
        data: {
          userId:  req.userId,
          trust:   null,
          status:  "UNKNOWN",
          msg:     "No data yet for this user"
        }
      })
    }

    const meta     = userMap.get(req.userId)
    const severity = meta.engine.getAnalyzerSeverity()
    const trust    = severity.ready
      ? Math.max(0, 100 - (severity.severity ?? 0))
      : null

    return res.json({
      ok:   true,
      data: {
        userId:     req.userId,
        trust,
        severity:   severity.severity,
        trend:      severity.trend,
        ready:      severity.ready,
        eventCount: meta.eventCount,
        lastUsed:   meta.lastUsed,
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/users
// Header: x-cg-api-key
// Returns: all tracked users in this workspace
// ────────────────────────────────────────────────────────────────────────────
router.get("/users", requireApiKey, rateLimit(60), (req, res) => {
  try {
    const userMap = engines.get(req.apiKey)

    if (!userMap || userMap.size === 0) {
      return res.json({ ok: true, count: 0, data: [] })
    }

    const users = []
    for (const [userId, meta] of userMap) {
      const severity = meta.engine.getAnalyzerSeverity()
      const trust    = severity.ready
        ? Math.max(0, 100 - (severity.severity ?? 0))
        : null

      users.push({
        userId,
        trust,
        severity:   severity.severity,
        trend:      severity.trend,
        ready:      severity.ready,
        eventCount: meta.eventCount,
        lastUsed:   meta.lastUsed,
        createdAt:  meta.createdAt,
      })
    }

    // Sort by trust ascending (riskiest first)
    users.sort((a, b) => (a.trust ?? 101) - (b.trust ?? 101))

    return res.json({
      ok:    true,
      count: users.length,
      data:  users,
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/learn
// Header: x-cg-api-key
// Body: { userId: string, values: number[] }
// Teaches the engine the normal behavioral pattern for this user
// ────────────────────────────────────────────────────────────────────────────
router.post("/learn", requireApiKey, rateLimit(30), requireUserId, (req, res) => {
  try {
    const { values } = req.body ?? {}

    if (!Array.isArray(values) || values.length < 2) {
      return res.status(400).json({
        ok:    false,
        error: "CGS_INVALID_LEARN_VALUES",
        msg:   "body.values must be an array of at least 2 numbers"
      })
    }

    const meta = getEngine(req.apiKey, req.userId)
    meta.engine.learnPattern(values.map(Number))

    return res.json({
      ok:  true,
      msg: `Pattern learned for user ${req.userId} from ${values.length} values`,
      data: {
        userId:  req.userId,
        learned: values.length,
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/reset/:userId
// Header: x-cg-api-key
// Resets engine state for a specific user (e.g. after session termination)
// ────────────────────────────────────────────────────────────────────────────
router.post("/reset/:userId", requireApiKey, rateLimit(60), requireUserId, (req, res) => {
  try {
    const userMap = engines.get(req.apiKey)

    if (userMap && userMap.has(req.userId)) {
      const meta = userMap.get(req.userId)
      meta.engine.reset(0)
      meta.engine.recalibrateAnalyzer()
      meta.eventCount = 0
    }

    return res.json({
      ok:  true,
      msg: `Engine reset for user ${req.userId}`,
      data: { userId: req.userId }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/history/:userId
// Header: x-cg-api-key
// Query: ?limit=50
// Returns: engine history for this user
// ────────────────────────────────────────────────────────────────────────────
router.get("/history/:userId", requireApiKey, rateLimit(60), requireUserId, (req, res) => {
  try {
    const userMap = engines.get(req.apiKey)

    if (!userMap || !userMap.has(req.userId)) {
      return res.json({ ok: true, count: 0, data: [] })
    }

    const limit   = Math.min(parseInt(req.query.limit) || 50, 500)
    const history = userMap.get(req.userId).engine.getHistory().slice(-limit)

    return res.json({
      ok:    true,
      count: history.length,
      data:  history,
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/health
// Public — no auth required
// ────────────────────────────────────────────────────────────────────────────
router.get("/health", (_req, res) => {
  const totalUsers = [...engines.values()]
    .reduce((sum, userMap) => sum + userMap.size, 0)

  res.json({
    ok:         true,
    service:    "CyclicGuard Session API",
    engine:     "CPSE v1.0",
    status:     "RUNNING",
    workspaces: workspaces.size,
    users:      totalUsers,
  })
})

export default router
