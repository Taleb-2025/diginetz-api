/**
 * cycleguard-session.route.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CyclicGuard Session — API Route (v2.0 — Production / Horizontally Scalable)
 * Powered by CyclicProcessorEngine (CPSE v1.0)
 *
 * Architecture v2.0:
 *   ✅ Stateless engine  — snapshot في Redis، يُبنى عند الطلب ويُدمر بعده
 *   ✅ Redis             — sessions، public tokens، rate limiting
 *   ✅ BullMQ            — webhook queue غير متزامن
 *   ✅ Data plane خفيف   — /track بدون منطق ثقيل
 *   ✅ Token rotation    — expiration صارم + origin binding
 *   ✅ Horizontal ready  — لا state محلي أبداً
 *
 * ENV المطلوبة:
 *   REDIS_URL        — redis://...
 *   REDIS_QUEUE_URL  — (اختياري، يرث REDIS_URL)
 *
 * Endpoints:
 *   POST /api/cg-session/register        — تسجيل workspace
 *   POST /api/cg-session/public-token    — public token للمتصفح
 *   POST /api/cg-session/track           — إرسال events (data plane)
 *   GET  /api/cg-session/trust/:userId   — trust score سريع
 *   GET  /api/cg-session/users           — كل المستخدمين
 *   POST /api/cg-session/learn           — تعليم الأنماط
 *   POST /api/cg-session/reset/:userId   — إعادة ضبط المحرك
 *   GET  /api/cg-session/history/:userId — سجل الأحداث
 *   GET  /api/cg-session/health          — فحص الحالة
 */

import { Router }                from "express"
import { randomBytes }           from "crypto"
import { createClient }          from "redis"
import { Queue, Worker }         from "bullmq"
import { CyclicProcessorEngine } from "../engines/CyclicProcessorEngine.js"

const router = Router()

// ─────────────────────────────────────────────────────────────────────────────
// Redis clients
// ─────────────────────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

// Main client — sessions, snapshots, tokens, workspaces
const redis = createClient({ url: REDIS_URL })
redis.on("error", e => console.error("[CG Redis]", e.message))
await redis.connect()

// BullMQ requires a separate connection
const queueRedis = { url: process.env.REDIS_QUEUE_URL || REDIS_URL }

// ─────────────────────────────────────────────────────────────────────────────
// BullMQ — Webhook Queue
// ─────────────────────────────────────────────────────────────────────────────
const webhookQueue = new Queue("cg-webhooks", { connection: queueRedis })

// Worker — processes webhook jobs asynchronously
const webhookWorker = new Worker("cg-webhooks", async job => {
  const { url, payload } = job.data
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Webhook failed: ${res.status}`)
}, {
  connection: queueRedis,
  concurrency: 10,
})

webhookWorker.on("failed", (job, err) => {
  console.error(`[CG Webhook] Job ${job?.id} failed:`, err.message)
})

// ─────────────────────────────────────────────────────────────────────────────
// TTL constants
// ─────────────────────────────────────────────────────────────────────────────
const TTL = {
  WORKSPACE:   86400,      // 24h
  SNAPSHOT:    14400,      // 4h
  PUB_TOKEN:   3600,       // 1h
  RATE_WINDOW: 60,         // 1 min
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────────────────────────────────────────
const KEY = {
  workspace:  k  => `cg:ws:${k}`,
  snapshot:   (k, u) => `cg:snap:${k}:${u}`,
  pubToken:   t  => `cg:tok:${t}`,
  rateLimit:  k  => `cg:rl:${k}`,
  userIndex:  k  => `cg:users:${k}`,   // SET of userIds per workspace
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace storage
// ─────────────────────────────────────────────────────────────────────────────
async function storeWorkspace(apiKey, data) {
  await redis.setEx(KEY.workspace(apiKey), TTL.WORKSPACE, JSON.stringify(data))
}

async function fetchWorkspace(apiKey) {
  const raw = await redis.get(KEY.workspace(apiKey))
  return raw ? JSON.parse(raw) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Stateless Engine — snapshot في Redis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildEngine(snapshot?)
 * يبني engine جديد ويستعيد الـ snapshot إن وجد.
 */
function buildEngine(snapshot = null, options = {}) {
  const engine = new CyclicProcessorEngine({
    cycle:        360,
    step:         1,
    initialState: 0,
    maxVelocity:  Infinity,
    maxHistory:   100,          // مضغوط — 100 بدل 500
    analyzer: {
      baseThreshold:    options.baseThreshold    ?? 40,
      historyWindow:    options.historyWindow    ?? 20,
      trendBufferSize:  options.trendBufferSize  ?? 5,
      scoreHistorySize: options.scoreHistorySize ?? 10,
      intervalMs:       options.intervalMs       ?? 3600000,
    }
  })
  if (snapshot) engine.restore(snapshot)
  return engine
}

/**
 * loadSnapshot(apiKey, userId)
 * يجلب الـ snapshot من Redis.
 */
async function loadSnapshot(apiKey, userId) {
  const raw = await redis.get(KEY.snapshot(apiKey, userId))
  return raw ? JSON.parse(raw) : null
}

/**
 * saveSnapshot(apiKey, userId, engine, meta)
 * يحفظ snapshot + meta في Redis.
 */
async function saveSnapshot(apiKey, userId, engine, meta = {}) {
  const data = {
    snapshot:   engine.snapshot(),
    eventCount: meta.eventCount ?? 0,
    createdAt:  meta.createdAt  ?? Date.now(),
    lastUsed:   Date.now(),
  }
  await redis.setEx(KEY.snapshot(apiKey, userId), TTL.SNAPSHOT, JSON.stringify(data))
  // أضف userId لـ index المستخدمين
  await redis.sAdd(KEY.userIndex(apiKey), userId)
  await redis.expire(KEY.userIndex(apiKey), TTL.WORKSPACE)
}

/**
 * withEngine(apiKey, userId, fn)
 * Pattern: جلب snapshot → بناء engine → تنفيذ fn → حفظ snapshot → تدمير engine
 */
async function withEngine(apiKey, userId, fn) {
  const stored = await loadSnapshot(apiKey, userId)
  const engine = buildEngine(stored?.snapshot ?? null)
  const meta   = {
    eventCount: stored?.eventCount ?? 0,
    createdAt:  stored?.createdAt  ?? Date.now(),
    lastUsed:   Date.now(),
  }

  const result = await fn(engine, meta)

  await saveSnapshot(apiKey, userId, engine, meta)

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// eventsToValue — Data Plane (خفيف)
// ─────────────────────────────────────────────────────────────────────────────
function validateEvents(events) {
  if (!Array.isArray(events)) return []
  const ONE_HOUR_AGO = Date.now() - 3_600_000
  return events.filter(e => {
    if (typeof e.type !== "string" || !e.type.trim()) return false
    if (e.timestamp !== undefined) {
      if (!Number.isFinite(e.timestamp))        return false
      if (e.timestamp < ONE_HOUR_AGO)           return false
      if (e.timestamp > Date.now() + 5000)      return false
    }
    if (e.speed !== undefined && (!Number.isFinite(e.speed) || e.speed < 0)) return false
    return true
  })
}

function eventsToValue(events, customWeights = {}) {
  if (!Array.isArray(events) || events.length === 0) return 0

  const RISK_WEIGHTS = {
    export: 1.0, download: 0.9, delete: 0.9, admin: 0.8,
    bulk: 0.8, payment: 0.8, navigation: 0.2, click: 0.15,
    keypress: 0.1, scroll: 0.05, other: 0.3,
    ...customWeights,
  }

  const timestamps = events.map(e => e.timestamp).filter(Number.isFinite).sort((a, b) => a - b)

  // Speed
  let speedScore = 0
  if (timestamps.length >= 2) {
    const span = Math.max(timestamps.at(-1) - timestamps[0], 1)
    speedScore  = Math.min(1, (events.length / span) * 1000 / 10)
  }

  // Risk
  const riskScore = Math.min(1,
    events.reduce((s, e) => {
      const w = RISK_WEIGHTS[(e.type ?? "other").toLowerCase()] ?? RISK_WEIGHTS.other
      const sp = Number.isFinite(e.speed) ? Math.min(e.speed / 20, 1) : 0
      return s + w + sp * 0.3
    }, 0) / events.length
  )

  // Burst (from 2 events)
  let burstScore = 0
  if (timestamps.length >= 2) {
    let maxBurst = 0
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1]
      if (gap < 500) maxBurst = Math.max(maxBurst, 2 / Math.max(gap / 1000, 0.001))
    }
    for (let i = 2; i < timestamps.length; i++) {
      const win = timestamps[i] - timestamps[i - 2]
      if (win < 2000) maxBurst = Math.max(maxBurst, 3 / Math.max(win / 1000, 0.001))
    }
    burstScore = Math.min(1, maxBurst / 15)
  }

  // Device change
  const devices    = [...new Set(events.map(e => e.device).filter(Boolean))]
  const deviceFlag = devices.length > 1 ? 0.8 : 0

  const combined = speedScore * 0.30 + riskScore * 0.35 + burstScore * 0.25 + deviceFlag * 0.10
  return Math.round(combined * 360)
}

function buildTrustScore(report) {
  return Math.max(0, Math.min(100, 100 - (report.severity ?? 0)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Queue helper
// ─────────────────────────────────────────────────────────────────────────────
async function enqueueWebhook(url, payload) {
  if (!url) return
  await webhookQueue.add("webhook", { url, payload }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail:     200,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────
function generateApiKey()     { return "cg_live_" + randomBytes(16).toString("hex") }
function generatePublicToken() { return "cg_pub_"  + randomBytes(16).toString("hex") }

async function storePubToken(token, apiKey, origin, ip) {
  const data = { apiKey, origin: origin ?? null, ip: ip ?? null, createdAt: Date.now() }
  await redis.setEx(KEY.pubToken(token), TTL.PUB_TOKEN, JSON.stringify(data))
}

async function fetchPubToken(token) {
  const raw = await redis.get(KEY.pubToken(token))
  return raw ? JSON.parse(raw) : null
}

async function deletePubToken(token) {
  await redis.del(KEY.pubToken(token))
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter — Sliding Window في Redis
// ─────────────────────────────────────────────────────────────────────────────
function rateLimit(maxPerMinute = 120) {
  return async (req, res, next) => {
    const key = KEY.rateLimit(req.apiKey ?? req.ip)
    const now = Date.now()

    const pipe    = redis.multi()
    pipe.zRemRangeByScore(key, 0, now - 60_000)
    pipe.zCard(key)
    pipe.zAdd(key, [{ score: now, value: now.toString() }])
    pipe.expire(key, TTL.RATE_WINDOW + 5)

    const results = await pipe.exec()
    const count   = results[1]

    if (count >= maxPerMinute) {
      return res.status(429).json({
        ok: false, error: "CGS_RATE_LIMIT",
        msg: `Rate limit exceeded: max ${maxPerMinute} req/min`,
      })
    }
    next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: CORS per-workspace origin
// ─────────────────────────────────────────────────────────────────────────────
router.use(async (req, res, next) => {
  const origin = req.headers.origin
  if (!origin) return next()

  res.setHeader("Access-Control-Allow-Origin",  origin)
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-cg-api-key, x-cg-pub-token")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  if (req.method === "OPTIONS") return res.sendStatus(204)

  // للـ pub token — تحقق من origin
  const token = req.headers["x-cg-pub-token"]
  if (token) {
    const tokenMeta = await fetchPubToken(token)
    if (tokenMeta?.origin && tokenMeta.origin !== origin) {
      return res.status(403).json({ ok: false, error: "CGS_ORIGIN_MISMATCH", msg: "Token origin mismatch" })
    }
  }

  next()
})

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: API Key
// ─────────────────────────────────────────────────────────────────────────────
async function requireApiKey(req, res, next) {
  const key = req.headers["x-cg-api-key"]
  if (!key) return res.status(401).json({ ok: false, error: "CGS_MISSING_API_KEY", msg: "Header x-cg-api-key is required" })

  const ws = await fetchWorkspace(key)
  if (!ws)  return res.status(403).json({ ok: false, error: "CGS_INVALID_API_KEY",  msg: "Invalid or expired API key" })

  ws.lastUsed = Date.now()
  await storeWorkspace(key, ws)
  req.apiKey    = key
  req.workspace = ws
  next()
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Public Token أو API Key
// ─────────────────────────────────────────────────────────────────────────────
async function requirePubToken(req, res, next) {
  if (req.headers["x-cg-api-key"]) return requireApiKey(req, res, next)

  const token = req.headers["x-cg-pub-token"]
  if (!token) return res.status(401).json({ ok: false, error: "CGS_MISSING_TOKEN", msg: "x-cg-api-key or x-cg-pub-token required" })

  const tokenMeta = await fetchPubToken(token)
  if (!tokenMeta)  return res.status(403).json({ ok: false, error: "CGS_INVALID_PUB_TOKEN", msg: "Invalid or expired token" })

  // IP binding check
  const clientIp = req.ip
  if (tokenMeta.ip && tokenMeta.ip !== clientIp) {
    await deletePubToken(token)
    return res.status(403).json({ ok: false, error: "CGS_TOKEN_IP_MISMATCH", msg: "Token IP mismatch — revoked" })
  }

  const ws = await fetchWorkspace(tokenMeta.apiKey)
  if (!ws) return res.status(403).json({ ok: false, error: "CGS_WORKSPACE_GONE", msg: "Workspace no longer exists" })

  req.apiKey    = tokenMeta.apiKey
  req.workspace = ws
  next()
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: userId
// ─────────────────────────────────────────────────────────────────────────────
function requireUserId(req, res, next) {
  const userId = req.body?.userId || req.params?.userId
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    return res.status(400).json({ ok: false, error: "CGS_MISSING_USER_ID", msg: "userId is required" })
  }
  req.userId = userId.trim().substring(0, 128)
  next()
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/register
// ─────────────────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { name, domain, plan, webhookUrl, riskWeights, allowedOrigins } = req.body ?? {}
    if (!name   || typeof name   !== "string") return res.status(400).json({ ok: false, error: "CGS_MISSING_NAME",   msg: "body.name is required" })
    if (!domain || typeof domain !== "string") return res.status(400).json({ ok: false, error: "CGS_MISSING_DOMAIN", msg: "body.domain is required" })

    const apiKey = generateApiKey()
    const meta   = {
      apiKey,
      name:           name.trim(),
      domain:         domain.trim(),
      plan:           plan ?? "starter",
      webhookUrl:     webhookUrl     ?? null,
      riskWeights:    riskWeights    ?? {},
      allowedOrigins: allowedOrigins ?? [domain.trim()],
      createdAt:      Date.now(),
      lastUsed:       Date.now(),
    }

    await storeWorkspace(apiKey, meta)

    const snippet = `
<!-- CyclicGuard Session v2.0 -->
<script>
(function() {
  var CG = {
    _token: null,
    baseUrl: "https://diginetz-api-production.up.railway.app/api/cg-session",
    userId: null, buffer: [], flushMs: 5000,

    identify: function(userId) {
      this.userId = userId;
      var self = this;
      fetch("/api/cg-pub-token", { method: "POST" })
        .then(function(r) { return r.json(); })
        .then(function(d) { if (d.token) { self._token = d.token; self._start(); } });
    },

    track: function(type, target, extra) {
      if (!this.userId || !this._token) return;
      this.buffer.push(Object.assign({ type: type, target: target || "",
        timestamp: Date.now(), device: navigator.userAgent.substring(0,80), speed: 0 }, extra || {}));
    },

    _start: function() {
      var self = this;
      setInterval(function() { self._flush(); }, self.flushMs);
      self._auto();
    },

    _flush: function() {
      if (!this._token || !this.buffer.length) return;
      var ev = this.buffer.splice(0);
      var self = this;
      fetch(this.baseUrl + "/track", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cg-pub-token": this._token },
        body: JSON.stringify({ userId: this.userId, events: ev })
      }).catch(function() { self.buffer.unshift.apply(self.buffer, ev); });
    },

    _auto: function() {
      var self = this; var c = 0; var last = Date.now();
      document.addEventListener("click", function(e) {
        var now = Date.now();
        self.track("click", e.target?.tagName||"", { speed: ++c/Math.max((now-last)/1000,0.1) });
        last = now; c = 0;
      });
      window.addEventListener("popstate", function() { self.track("navigation", location.pathname); });
      document.addEventListener("keypress", function() { self.track("keypress","",{speed:++c}); });
    }
  };
  window.CyclicGuard = CG;
})();
<\/script>`.trim()

    return res.status(201).json({
      ok: true, msg: "Workspace registered",
      data: { apiKey, workspace: meta, snippet,
        quickStart: {
          step1: "Add snippet to <head>",
          step2: "Expose POST /api/cg-pub-token on your backend",
          step3: "Call CyclicGuard.identify(userId) after login",
          step4: "Monitor at GET /api/cg-session/trust/:userId",
          security: "Never expose cg_live_xxx in client code",
        }
      }
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/public-token
// Header: x-cg-api-key
// ─────────────────────────────────────────────────────────────────────────────
router.post("/public-token", requireApiKey, rateLimit(60), async (req, res) => {
  try {
    const token  = generatePublicToken()
    const origin = req.headers.origin ?? null
    const ip     = req.ip

    await storePubToken(token, req.apiKey, origin, ip)

    return res.json({ ok: true, data: { token, expiresIn: TTL.PUB_TOKEN, type: "cg_pub" } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/track  ← DATA PLANE (خفيف)
// Header: x-cg-api-key OR x-cg-pub-token
// Body:   { userId, events[] }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/track", requirePubToken, rateLimit(200), requireUserId, async (req, res) => {
  try {
    const rawEvents = req.body?.events
    const events    = validateEvents(rawEvents)

    if (!events.length)    return res.status(400).json({ ok: false, error: "CGS_NO_VALID_EVENTS", msg: "No valid events" })
    if (events.length > 500) return res.status(400).json({ ok: false, error: "CGS_TOO_MANY_EVENTS", msg: "Max 500 events" })

    const customWeights = req.workspace.riskWeights ?? {}
    const value         = eventsToValue(events, customWeights)

    // ── withEngine: جلب snapshot → تحليل → حفظ snapshot → تدمير engine ──
    const { report, trust, meta } = await withEngine(req.apiKey, req.userId, async (engine, meta) => {
      const report = engine.analyze(value)
      const trust  = buildTrustScore(report)
      meta.eventCount += events.length
      return { report, trust, meta }
    })

    // Webhook — غير متزامن عبر BullMQ
    if (report.status === "CRITICAL" && req.workspace.webhookUrl) {
      await enqueueWebhook(req.workspace.webhookUrl, {
        event:     "CRITICAL_DETECTED",
        workspace: req.workspace.name,
        userId:    req.userId,
        trust,
        severity:  report.severity,
        reason:    report.explain?.reason ?? "—",
        trend:     report.trend,
        timestamp: Date.now(),
      })
    }

    return res.json({
      ok: true,
      data: {
        userId:         req.userId,
        trust,
        status:         report.status,
        health:         report.health,
        severity:       report.severity,
        trend:          report.trend,
        explain:        report.explain,
        containment:    report.containment,
        behaviorVector: report.behaviorVector,
        forecast:       report.forecast,
        eventCount:     meta.eventCount,
        droppedEvents:  (rawEvents?.length ?? 0) - events.length,
        raw:            report,
      }
    })

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/trust/:userId
// ─────────────────────────────────────────────────────────────────────────────
router.get("/trust/:userId", requireApiKey, rateLimit(300), requireUserId, async (req, res) => {
  try {
    const stored = await loadSnapshot(req.apiKey, req.userId)
    if (!stored) return res.json({ ok: true, data: { userId: req.userId, trust: null, status: "UNKNOWN", msg: "No data yet" } })

    // بناء engine مؤقت لقراءة الـ severity فقط
    const engine   = buildEngine(stored.snapshot)
    const severity = engine.getAnalyzerSeverity()
    const trust    = severity.ready ? Math.max(0, 100 - (severity.severity ?? 0)) : null

    return res.json({
      ok: true,
      data: {
        userId:     req.userId,
        trust,
        severity:   severity.severity,
        trend:      severity.trend,
        ready:      severity.ready,
        eventCount: stored.eventCount,
        lastUsed:   stored.lastUsed,
      }
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/users
// ─────────────────────────────────────────────────────────────────────────────
router.get("/users", requireApiKey, rateLimit(60), async (req, res) => {
  try {
    const userIds = await redis.sMembers(KEY.userIndex(req.apiKey))
    if (!userIds.length) return res.json({ ok: true, count: 0, data: [] })

    const users = []
    for (const userId of userIds) {
      const stored = await loadSnapshot(req.apiKey, userId)
      if (!stored) continue

      const engine   = buildEngine(stored.snapshot)
      const severity = engine.getAnalyzerSeverity()
      const trust    = severity.ready ? Math.max(0, 100 - (severity.severity ?? 0)) : null

      users.push({
        userId,
        trust,
        severity:   severity.severity,
        trend:      severity.trend,
        ready:      severity.ready,
        eventCount: stored.eventCount,
        lastUsed:   stored.lastUsed,
        createdAt:  stored.createdAt,
      })
    }

    users.sort((a, b) => (a.trust ?? 101) - (b.trust ?? 101))
    return res.json({ ok: true, count: users.length, data: users })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/learn
// ─────────────────────────────────────────────────────────────────────────────
router.post("/learn", requireApiKey, rateLimit(30), requireUserId, async (req, res) => {
  try {
    const { values } = req.body ?? {}
    if (!Array.isArray(values) || values.length < 2) {
      return res.status(400).json({ ok: false, error: "CGS_INVALID_LEARN_VALUES", msg: "values must be array of >= 2 numbers" })
    }

    await withEngine(req.apiKey, req.userId, async (engine, meta) => {
      engine.learnPattern(values.map(Number))
      return {}
    })

    return res.json({ ok: true, msg: `Pattern learned for ${req.userId}`, data: { userId: req.userId, learned: values.length } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cg-session/reset/:userId
// ─────────────────────────────────────────────────────────────────────────────
router.post("/reset/:userId", requireApiKey, rateLimit(60), requireUserId, async (req, res) => {
  try {
    // حذف snapshot من Redis = reset كامل
    await redis.del(KEY.snapshot(req.apiKey, req.userId))
    await redis.sRem(KEY.userIndex(req.apiKey), req.userId)

    return res.json({ ok: true, msg: `Engine reset for ${req.userId}`, data: { userId: req.userId } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/history/:userId
// ─────────────────────────────────────────────────────────────────────────────
router.get("/history/:userId", requireApiKey, rateLimit(60), requireUserId, async (req, res) => {
  try {
    const stored = await loadSnapshot(req.apiKey, req.userId)
    if (!stored) return res.json({ ok: true, count: 0, data: [] })

    const limit   = Math.min(parseInt(req.query.limit) || 50, 100)
    const engine  = buildEngine(stored.snapshot)
    const history = engine.getHistory().slice(-limit)

    return res.json({ ok: true, count: history.length, data: history })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cg-session/health
// ─────────────────────────────────────────────────────────────────────────────
router.get("/health", async (_req, res) => {
  try {
    await redis.ping()
    const queueStats = await webhookQueue.getJobCounts()
    return res.json({
      ok:        true,
      service:   "CyclicGuard Session API",
      version:   "2.0.0",
      engine:    "CPSE v1.0",
      status:    "RUNNING",
      storage:   "redis",
      stateless: true,
      queue:     queueStats,
    })
  } catch (err) {
    return res.status(503).json({ ok: false, error: "Redis unreachable", detail: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`[CyclicGuard] ${signal} — shutting down`)
  await webhookWorker.close()
  await webhookQueue.close()
  await redis.quit()
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))

export default router
