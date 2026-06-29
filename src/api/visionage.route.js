/**
 * visionage.route.js  v2
 * Visionage Navigation API — DigiNetz Engine Suite
 *
 * Storage: JSON file on Railway Volume (persistent)
 *          In-memory sessions (VisionageCore per user)
 */

import express from 'express'
import fs      from 'fs'
import path    from 'path'
import { fileURLToPath } from 'url'
import { VisionageCore } from '../engines/VisionageCore.js'

const router  = express.Router()
const __dir   = path.dirname(fileURLToPath(import.meta.url))

// FIX: use Railway Volume mount path for persistent storage
const DATA_DIR  = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ?? path.join(__dir, '../../data')
const DATA_FILE = path.join(DATA_DIR, 'visionage.json')

console.log('[visionage] DATA_DIR:', DATA_DIR)

// ── JSON Storage ──────────────────────────────────────────────────────────────
let _store = { routes: {}, points: {} }
let _savePending = false

function _loadStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    if (fs.existsSync(DATA_FILE)) {
      _store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
      console.log('[visionage] store loaded — routes sessions:', Object.keys(_store.routes).length)
    } else {
      console.log('[visionage] no store file yet — starting fresh')
    }
  } catch(e) {
    console.warn('[visionage] store load failed:', e.message)
    _store = { routes: {}, points: {} }
  }
}

function _saveStore() {
  if (_savePending) return
  _savePending = true
  setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(DATA_FILE, JSON.stringify(_store), 'utf8')
    } catch(e) {
      console.warn('[visionage] store save failed:', e.message)
    }
    _savePending = false
  }, 500)
}

function _getRoutes(sid)  { return _store.routes[sid]  || [] }
function _getPoints(sid)  { return _store.points[sid]  || [] }

function _saveRoute(sid, route) {
  if (!_store.routes[sid]) _store.routes[sid] = []
  const idx = _store.routes[sid].findIndex(r => r.id === route.id)
  if (idx >= 0) _store.routes[sid][idx] = route
  else          _store.routes[sid].push(route)
  _saveStore()
}

function _savePoint(sid, point) {
  if (!_store.points[sid]) _store.points[sid] = []
  const idx = _store.points[sid].findIndex(p => p.id === point.id)
  if (idx >= 0) _store.points[sid][idx] = point
  else          _store.points[sid].push(point)
  _saveStore()
}

function _deleteSession(sid) {
  delete _store.routes[sid]
  delete _store.points[sid]
  _saveStore()
}

_loadStore()

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const _ipReq     = new Map()
const _IP_WIN    = 60_000
const _IP_MAX    = 80
const _BURST_WIN = 5_000
const _BURST_MAX = 15

router.use((req, res, next) => {
  const ip    = req.ip || req.socket?.remoteAddress || 'unknown'
  const now   = Date.now()
  const entry = _ipReq.get(ip) || { times: [] }
  entry.times = entry.times.filter(t => now - t < _IP_WIN)
  const burst = entry.times.filter(t => now - t < _BURST_WIN).length
  if (burst >= _BURST_MAX)            return res.status(429).json({ error: 'rate_limit_burst', retryAfter: 5 })
  if (entry.times.length >= _IP_MAX)  return res.status(429).json({ error: 'rate_limit', retryAfter: 60 })
  entry.times.push(now)
  _ipReq.set(ip, entry)
  if (_ipReq.size > 5000) {
    for (const [k, v] of _ipReq)
      if (v.times.every(t => now - t > _IP_WIN)) _ipReq.delete(k)
  }
  next()
})

// ── In-Memory Sessions ────────────────────────────────────────────────────────
const sessions    = new Map()
const lock        = new Set()
const SESSION_TTL = 2 * 60 * 60 * 1000  // 2h

setInterval(() => {
  const now = Date.now()
  for (const [sid, s] of sessions)
    if (now - s.lastActive > SESSION_TTL) {
      sessions.delete(sid)
      console.log(`[visionage] session expired: ${sid.slice(-8)}`)
    }
}, 30 * 60 * 1000)

async function getCore(sid) {
  if (!sessions.has(sid)) {
    const core = new VisionageCore({ tolerance: 15, matchThreshold: 0.70, dbName: null })
    core._ready = true
    const savedRoutes = _getRoutes(sid)
    const savedPoints = _getPoints(sid)
    for (const r of savedRoutes) core._memory._routes.set(r.id, r)
    for (const p of savedPoints) {
      if (core._memory._anchors) core._memory._anchors.set(p.id, p)
      else if (core._memory._points) core._memory._points.set(p.id, p)
    }
    core._memory._loaded = true
    sessions.set(sid, { core, lastActive: Date.now() })
    console.log(`[visionage] new session: ${sid.slice(-8)} routes:${savedRoutes.length} points:${savedPoints.length}`)
  }
  sessions.get(sid).lastActive = Date.now()
  return sessions.get(sid).core
}

// ── Validation ────────────────────────────────────────────────────────────────
function validSid(sid) { return typeof sid === 'string' && sid.length > 4 && sid.length < 80 }

function requireSession(req, res, next) {
  const sid = req.body?.sessionId || req.params?.id || req.query?.sessionId
  if (!sid || !validSid(sid)) return res.status(400).json({ error: 'missing_or_invalid_session_id' })
  req.sid = sid
  next()
}

// ── Serializers ───────────────────────────────────────────────────────────────
function serRoute(r) {
  return {
    id:          r.id,
    title:       r.title,
    scope:       r.scope,
    direction:   r.direction ?? 'forward',
    published:   r.published,
    nodeCount:   r.nodes?.length ?? r.anchors?.length ?? 0,
    transitions: (r.transitions ?? []).map(t => ({
      fromId:     t.fromId,
      toId:       t.toId,
      deltaTheta: t.deltaTheta,
      toGps:      t.toGps ?? null,
      toTitle:    t.toTitle ?? null,
      toFrames:   Array.isArray(t.toFrames) && t.toFrames.length > 0
        ? t.toFrames.slice(0, 1)
        : [],
    })),
    nodes: (r.nodes ?? r.anchors ?? []).map(n => ({
      pointId:   n.pointId ?? n.id,
      order:     n.order,
      theta:     n.theta ?? 0,
      title:     n.title ?? n.label ?? ('Node '+(n.order+1)),
      gps:       n.gps ?? null,
      frames:    Array.isArray(n.frames) ? n.frames.slice(0,1) : [],
      hasFrames: Array.isArray(n.frames) && n.frames.length > 0,
    })),
    createdAt: r.createdAt,
  }
}

function serPoint(p) {
  return {
    id:        p.id,
    title:     p.title,
    theta:     p.theta,
    gps:       p.gps ?? null,
    type:      p.type,
    scope:     p.scope,
    hasFrames: Array.isArray(p.frames) && p.frames.length > 0,
    createdAt: p.createdAt,
  }
}

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ ok: true, engine: 'VisionageCore', sessions: sessions.size, version: '2.0', storage: 'json', dataDir: DATA_DIR })
})

// ── POST /update ──────────────────────────────────────────────────────────────
router.post('/update', requireSession, async (req, res) => {
  const { angle } = req.body
  if (!Number.isFinite(angle)) return res.status(400).json({ error: 'invalid_angle' })
  try {
    const core = await getCore(req.sid)
    const r    = core.update(angle)
    res.json({ ok: true, angle: r.angle })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /scan/start ──────────────────────────────────────────────────────────
router.post('/scan/start', requireSession, async (req, res) => {
  const { title = 'New Route', scope = 'personal', stepDeg = 5, direction = 'forward' } = req.body
  const sid = req.sid
  if (lock.has(sid)) return res.status(429).json({ error: 'request_in_progress' })
  lock.add(sid)
  try {
    const core = await getCore(sid)
    const r    = core.startScan({ title, scope, stepDeg, direction })
    res.json({ ok: true, ...r })
  } catch(e) { res.status(500).json({ error: e.message }) }
  finally { lock.delete(sid) }
})

// ── POST /scan/node ───────────────────────────────────────────────────────────
router.post('/scan/node', requireSession, async (req, res) => {
  const { angle, globalAngle, title, gps = null, frames = [] } = req.body
  const rawAngle = Number.isFinite(globalAngle) ? globalAngle
                 : Number.isFinite(angle)       ? angle : null
  if (rawAngle === null) return res.status(400).json({ error: 'invalid_angle' })
  const sid = req.sid
  if (lock.has(sid)) return res.status(429).json({ error: 'request_in_progress' })
  lock.add(sid)
  try {
    const core = await getCore(sid)
    core.update(rawAngle)
    const r = await core.addScanPoint({ angle: rawAngle, title, gps, frames })
    const anchorId = r.anchor?.id ?? r.node?.pointId
    if (anchorId) {
      const anchor = core._memory.getAnchor?.(anchorId) ?? core._memory.getPoint?.(anchorId)
      if (anchor) _savePoint(sid, anchor)
    }
    const logAngle = r.deltaTheta !== undefined ? `Δθ=${r.deltaTheta}°` : `@${Math.round(rawAngle)}°`
    console.log(`[visionage:${sid.slice(-8)}] anchor: ${title ?? 'Node'} ${logAngle}`)
    res.json({
      ok:               true,
      node:             r.anchor ?? r.node,
      anchor:           r.anchor ?? r.node,
      totalNodes:       r.totalAnchors ?? r.totalNodes ?? 0,
      totalAnchors:     r.totalAnchors ?? r.totalNodes ?? 0,
      totalTransitions: r.totalTransitions ?? 0,
      deltaTheta:       r.deltaTheta ?? null,
    })
  } catch(e) { res.status(500).json({ error: e.message }) }
  finally { lock.delete(sid) }
})

// ── POST /scan/finish ─────────────────────────────────────────────────────────
router.post('/scan/finish', requireSession, async (req, res) => {
  const { title } = req.body
  const sid = req.sid
  if (lock.has(sid)) return res.status(429).json({ error: 'request_in_progress' })
  lock.add(sid)
  try {
    const core = await getCore(sid)
    const r    = await core.finishScan({ title })
    _saveRoute(sid, r.route)
    const tCount = r.route.transitions?.length ?? (r.route.nodes?.length - 1) ?? 0
    console.log(`[visionage:${sid.slice(-8)}] route saved: "${r.route.title}" (${tCount} transitions)`)
    res.json({ ok: true, route: serRoute(r.route) })
  } catch(e) { res.status(400).json({ error: e.message }) }
  finally { lock.delete(sid) }
})

// ── POST /scan/auto-node ─────────────────────────────────────────────────────
// Called every GPS tick during auto-scan
// Server decides whether to save anchor based on Δθ + distance
router.post('/scan/auto-node', requireSession, async (req, res) => {
  const { angle, globalAngle, gps = null, frames = [],
          deltaThreshold = 20, distThreshold = 100 } = req.body
  const rawAngle = Number.isFinite(globalAngle) ? globalAngle
                 : Number.isFinite(angle)       ? angle : null
  if (rawAngle === null) return res.status(400).json({ error: 'invalid_angle' })
  const sid = req.sid
  if (lock.has(sid)) return res.status(429).json({ error: 'request_in_progress' })
  lock.add(sid)
  try {
    const core = await getCore(sid)
    core.update(rawAngle)
    const r = core.addAutoAnchor({
      angle: rawAngle,
      gps,
      frames,
      deltaThreshold,
      distThreshold,
    })
    // If anchor was saved — persist it
    if (r.saved && r.anchor) {
      const anchor = core._memory.getAnchor?.(r.anchor.id)
      if (anchor) _savePoint(sid, anchor)
      console.log(`[visionage:${sid.slice(-8)}] auto-anchor: ${r.anchor.title} reason:${r.reason} Δθ:${r.deltaTheta}° dist:${r.dist??'?'}m`)
    }
    res.json({ ok: true, ...r })
  } catch(e) { res.status(500).json({ error: e.message }) }
  finally { lock.delete(sid) }
})

// ── POST /scan/cancel ─────────────────────────────────────────────────────────
router.post('/scan/cancel', requireSession, async (req, res) => {
  try {
    const core = await getCore(req.sid)
    res.json({ ok: true, ...core.cancelScan() })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /navigate/start ──────────────────────────────────────────────────────
router.post('/navigate/start', requireSession, async (req, res) => {
  const { routeId, startAngle } = req.body
  if (!routeId) return res.status(400).json({ error: 'missing_route_id' })
  try {
    const core = await getCore(req.sid)
    if (Number.isFinite(startAngle)) {
      core.update(startAngle)
      core.setLocalRef(startAngle)
    }
    const state = core.startNavigation(routeId)
    console.log(`[visionage:${req.sid.slice(-8)}] nav started: ${routeId} localRef:${startAngle ?? 'auto'}°`)
    res.json({ ok: true, state })
  } catch(e) { res.status(400).json({ error: e.message }) }
})

// ── POST /navigate/tick ───────────────────────────────────────────────────────
router.post('/navigate/tick', requireSession, async (req, res) => {
  const { angle, fingerprint = null, visualMatch: clientMatch = null,
          gps = null, motionScore = null, gpsRadius = 8 } = req.body
  if (!Number.isFinite(angle)) return res.status(400).json({ error: 'invalid_angle' })
  const sid = req.sid
  if (lock.has(sid)) return res.status(429).json({ error: 'request_in_progress' })
  lock.add(sid)
  try {
    const core = await getCore(sid)
    core.update(angle)
    const gpsOK = gps && (!gps.accuracy || gps.accuracy <= 20)
    if (gpsOK) core.setGPS(gps)
    let visualMatch = clientMatch
    if (fingerprint && !visualMatch) {
      const navState = core._nav
      if (navState._locating) {
        const firstAnchor = navState.anchors?.[0]
        const firstFrames = firstAnchor?.frames ?? []
        if (firstFrames.length > 0) {
          visualMatch = core.matchFrames(fingerprint, firstFrames)
        }
      } else {
        const T = navState.transitions?.[navState.currentIndex]
        if (T && Array.isArray(T.toFrames) && T.toFrames.length > 0) {
          visualMatch = core.matchFrames(fingerprint, T.toFrames)
        }
      }
    }
    const state = core.navigationTick(visualMatch, { motionScore, gpsRadius })
    res.json({ ok: true, state, angle: core.getAngle() })
  } catch(e) { res.status(500).json({ error: e.message }) }
  finally { lock.delete(sid) }
})

// ── POST /navigate/stop ───────────────────────────────────────────────────────
router.post('/navigate/stop', requireSession, async (req, res) => {
  try {
    const core = await getCore(req.sid)
    res.json({ ok: true, ...core.stopNavigation() })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /navigate/arrived ────────────────────────────────────────────────────
router.post('/navigate/arrived', requireSession, async (req, res) => {
  try {
    const core  = await getCore(req.sid)
    const state = core.advanceNavigation()
    res.json({ ok: true, state })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /routes ───────────────────────────────────────────────────────────────
router.get('/routes', requireSession, async (req, res) => {
  try {
    const core   = await getCore(req.sid)
    const routes = core.getRoutes().map(serRoute)
    res.json({ ok: true, routes, count: routes.length })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── GET /points ───────────────────────────────────────────────────────────────
router.get('/points', requireSession, async (req, res) => {
  try {
    const core   = await getCore(req.sid)
    const points = core.getPoints().map(serPoint)
    res.json({ ok: true, points, count: points.length })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── POST /point/save ──────────────────────────────────────────────────────────
router.post('/point/save', requireSession, async (req, res) => {
  const { angle, title = 'Point', gps = null, frames = [], type = 'point', scope = 'personal' } = req.body
  if (!Number.isFinite(angle)) return res.status(400).json({ error: 'invalid_angle' })
  const sid = req.sid
  try {
    const core  = await getCore(sid)
    core.update(angle)
    const point = await core.savePoint({ title, gps, frames, type, scope })
    _savePoint(sid, point)
    console.log(`[visionage:${sid.slice(-8)}] point saved: "${point.title}"`)
    res.json({ ok: true, point: serPoint(point) })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── DELETE /route/:id ─────────────────────────────────────────────────────────
router.delete('/route/:id', requireSession, async (req, res) => {
  const routeId = req.params.id
  if (!routeId) return res.status(400).json({ error: 'missing_route_id' })
  try {
    const core = await getCore(req.sid)
    await core.deleteRoute(routeId)
    if (!_store.routes[req.sid]) _store.routes[req.sid] = []
    _store.routes[req.sid] = _store.routes[req.sid].filter(r => r.id !== routeId)
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(DATA_FILE, JSON.stringify(_store), 'utf8')
    } catch(e) { console.warn('[visionage] immediate save failed:', e.message) }
    console.log(`[visionage:${req.sid.slice(-8)}] route deleted: ${routeId}`)
    res.json({ ok: true, deleted: routeId })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── DELETE /session/:id ───────────────────────────────────────────────────────
router.delete('/session/:id', (req, res) => {
  const sid = req.params.id
  if (!validSid(sid)) return res.status(400).json({ error: 'invalid_session_id' })
  sessions.delete(sid)
  lock.delete(sid)
  _deleteSession(sid)
  console.log(`[visionage] session deleted: ${sid.slice(-8)}`)
  res.json({ ok: true })
})

export default router
