/**
 * VisionageCore v2
 * Visual Navigation + Spatial Memory Engine
 *
 * Sections:
 *  1. CyclicEngine     — 360° angle management (direction only)
 *  2. SpiralMemory     — points + routes storage (IndexedDB)
 *  3. VisualMatcher    — camera frame comparison
 *  4. NavigationState  — routing + progress tracking
 *  5. VisionageCore    — unified public interface
 */

// ════════════════════════════════════════════════════════════════
//  1. CyclicEngine — direction only, no memory
// ════════════════════════════════════════════════════════════════

class CyclicEngine {
  #state; #cycle; #maxVelocity; #lastTimestamp; #history; #maxHistory

  constructor(options = {}) {
    this.#cycle       = 360
    this.#maxVelocity = Number.isFinite(options.maxVelocity) && options.maxVelocity > 0 ? options.maxVelocity : Infinity
    this.#state       = 0
    this.#lastTimestamp = Date.now()
    this.#history     = []
    this.#maxHistory  = options.maxHistory ?? 500
  }

  #norm(v) { return ((v % 360) + 360) % 360 }

  update(angle) {
    const now  = Date.now()
    const Δt   = Math.max(now - this.#lastTimestamp, 1)
    const prev = this.#state
    const next = this.#norm(angle)
    const step = this.signedDist(prev, next)
    const vel  = Math.abs(step) / Δt
    let clamped = step
    if (this.#maxVelocity !== Infinity && vel > this.#maxVelocity) {
      clamped = Math.sign(step) * this.#maxVelocity * Δt
    }
    this.#state = this.#norm(prev + clamped)
    this.#lastTimestamp = now
    this.#history.push({ angle: this.#state, timestamp: now })
    if (this.#history.length > this.#maxHistory) this.#history.shift()
    return { angle: this.#state, step: clamped, velocity: vel }
  }

  getAngle()   { return this.#state }
  getHistory() { return [...this.#history] }

  dist(a, b) {
    const d = Math.abs(this.#norm(a) - this.#norm(b))
    return Math.min(d, 360 - d)
  }

  signedDist(a, b) {
    const fwd = (this.#norm(b) - this.#norm(a) + 360) % 360
    return fwd > 180 ? fwd - 360 : fwd
  }

  /** Direction and human instruction from current to target */
  getDirection(targetAngle, tolerance = 15) {
    const current = this.#state
    const target  = this.#norm(targetAngle)
    const signed  = this.signedDist(current, target)
    const abs     = Math.abs(signed)

    if (abs <= tolerance) return { action: 'arrived', degrees: signed, abs, instruction: 'You have arrived', turn: 'none' }
    const turn = signed > 0 ? 'right' : 'left'
    const instruction =
      abs < 30  ? `Slight ${turn} — ${Math.round(abs)}°` :
      abs < 120 ? `Turn ${turn} — ${Math.round(abs)}°`   :
                  `Turn around — ${Math.round(abs)}°`
    return { action: 'turn', degrees: signed, abs, instruction, turn, current, target }
  }

  isAligned(angle, tolerance = 15) { return this.dist(this.#state, angle) <= tolerance }
  reset(angle = 0) { this.#state = this.#norm(angle); this.#history = [] }
  snapshot() { return { angle: this.#state, history: this.getHistory(), timestamp: Date.now() } }
  restore(snap) { this.#state = this.#norm(snap.angle ?? 0); this.#history = snap.history ?? [] }
}

// ════════════════════════════════════════════════════════════════
//  2. SpiralMemory — points + routes (IndexedDB)
// ════════════════════════════════════════════════════════════════

class SpiralMemory {
  constructor(options = {}) {
    this._dbName  = options.dbName ?? 'visionage-v2'
    this._version = 2
    this._stores  = { points: 'points', routes: 'routes' }
    this._points  = new Map()
    this._routes  = new Map()
    this._db      = null
    this._loaded  = false
  }

  async _openDB() {
    if (this._db) return this._db
    if (typeof indexedDB === 'undefined') return null
    const stores = this._stores
    return new Promise((res, rej) => {
      const req = indexedDB.open(this._dbName, this._version)
      req.onupgradeneeded = e => {
        const db = e.target.result
        for (const s of Object.values(stores)) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' })
        }
      }
      req.onsuccess = e => { this._db = e.target.result; res(this._db) }
      req.onerror   = e => rej(e.target.error)
    })
  }

  async _put(storeName, obj) {
    const db = await this._openDB(); if (!db) return
    return new Promise((res, rej) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(obj)
      tx.oncomplete = () => res()
      tx.onerror    = e => rej(e.target.error)
    })
  }

  async _del(storeName, id) {
    const db = await this._openDB(); if (!db) return
    return new Promise((res, rej) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).delete(id)
      tx.oncomplete = () => res()
      tx.onerror    = e => rej(e.target.error)
    })
  }

  async _getAll(storeName) {
    const db = await this._openDB(); if (!db) return []
    return new Promise((res, rej) => {
      const tx  = db.transaction(storeName, 'readonly')
      const req = tx.objectStore(storeName).getAll()
      req.onsuccess = e => res(e.target.result ?? [])
      req.onerror   = e => rej(e.target.error)
    })
  }

  async init() {
    if (this._loaded) return
    const [points, routes] = await Promise.all([
      this._getAll(this._stores.points),
      this._getAll(this._stores.routes),
    ])
    for (const p of points) this._points.set(p.id, p)
    for (const r of routes) this._routes.set(r.id, r)
    this._loaded = true
  }

  // ── Points ──

  async savePoint(data) {
    if (!this._loaded) await this.init()
    const p = {
      id:          data.id ?? `pt_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      title:       data.title       ?? 'Point',
      description: data.description ?? '',
      theta:       ((data.angle ?? 0) % 360 + 360) % 360,
      gps:         data.gps         ?? null,
      frames:      data.frames      ?? [],
      type:        data.type        ?? 'point',
      meta:        data.meta        ?? {},
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    }
    this._points.set(p.id, p)
    setTimeout(() => this._put(this._stores.points, p).catch(console.error), 0)
    return p
  }

  async deletePoint(id) {
    this._points.delete(id)
    setTimeout(() => this._del(this._stores.points, id).catch(console.error), 0)
  }

  getPoint(id) { return this._points.get(id) ?? null }
  getAllPoints() { return [...this._points.values()] }

  // ── Routes ──

  async saveRoute(data) {
    if (!this._loaded) await this.init()
    const r = {
      id:          data.id ?? `rt_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      title:       data.title       ?? 'Route',
      description: data.description ?? '',
      nodes:       data.nodes       ?? [],   // array of { pointId, order, theta, gps, frames }
      startId:     data.startId     ?? null,
      endId:       data.endId       ?? null,
      placeId:     data.placeId     ?? null, // mall / hospital / etc
      published:   data.published   ?? false,
      meta:        data.meta        ?? {},
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    }
    this._routes.set(r.id, r)
    setTimeout(() => this._put(this._stores.routes, r).catch(console.error), 0)
    return r
  }

  async deleteRoute(id) {
    this._routes.delete(id)
    setTimeout(() => this._del(this._stores.routes, id).catch(console.error), 0)
  }

  getRoute(id) { return this._routes.get(id) ?? null }
  getAllRoutes() { return [...this._routes.values()] }

  // ── Spatial search (angle-based) ──

  findNearestPoint(theta, options = {}) {
    const { type = null, maxDist = 180 } = options
    let best = null, bestDist = Infinity
    const norm = v => ((v % 360) + 360) % 360
    const angDist = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360-d) }
    for (const p of this._points.values()) {
      if (type && p.type !== type) continue
      const d = angDist(theta, p.theta)
      if (d < bestDist && d <= maxDist) { best = p; bestDist = d }
    }
    return best ? { ...best, _angleDist: bestDist } : null
  }

  findPointsNear(theta, options = {}) {
    const { maxDist = 45, type = null, limit = 5 } = options
    const norm = v => ((v % 360) + 360) % 360
    const angDist = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360-d) }
    return [...this._points.values()]
      .filter(p => (!type || p.type === type) && angDist(theta, p.theta) <= maxDist)
      .map(p => ({ ...p, _angleDist: angDist(theta, p.theta) }))
      .sort((a, b) => a._angleDist - b._angleDist)
      .slice(0, limit)
  }

  async clear() {
    this._points.clear(); this._routes.clear()
    const db = await this._openDB(); if (!db) return
    await Promise.all(Object.values(this._stores).map(s =>
      new Promise((res, rej) => { const tx=db.transaction(s,'readwrite'); tx.objectStore(s).clear(); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e.target.error) })
    ))
  }
}

// Workaround for pipeline operator not available — patch findPointsNear
SpiralMemory.prototype.findPointsNear = function(theta, options = {}) {
  const { maxDist = 45, type = null, limit = 5 } = options
  const norm    = v => ((v % 360) + 360) % 360
  const angDist = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360-d) }
  return [...this._points.values()]
    .filter(p => (!type || p.type === type) && angDist(theta, p.theta) <= maxDist)
    .map(p => ({ ...p, _angleDist: angDist(theta, p.theta) }))
    .sort((a, b) => a._angleDist - b._angleDist)
    .slice(0, limit)
}

// ════════════════════════════════════════════════════════════════
//  3. VisualMatcher — camera frame comparison
// ════════════════════════════════════════════════════════════════

class VisualMatcher {
  constructor(options = {}) {
    this._threshold = options.threshold ?? 0.72  // similarity threshold 0-1
    this._size      = options.size      ?? 64    // comparison resolution
  }

  /** Compute a compact histogram fingerprint from ImageData or canvas */
  computeFingerprint(source) {
    let imageData
    if (source instanceof ImageData) {
      imageData = source
    } else if (source && source.getContext) {
      // canvas element
      const ctx = source.getContext('2d')
      imageData = ctx.getImageData(0, 0, source.width, source.height)
    } else {
      return null
    }

    const data = imageData.data
    const bins = 16  // 16 bins per channel = 48 total
    const hist = new Float32Array(bins * 3)
    const total = data.length / 4

    for (let i = 0; i < data.length; i += 4) {
      hist[Math.floor(data[i]   / 256 * bins)]             += 1 // R
      hist[bins + Math.floor(data[i+1] / 256 * bins)]      += 1 // G
      hist[bins*2 + Math.floor(data[i+2] / 256 * bins)]    += 1 // B
    }
    // Normalize
    for (let i = 0; i < hist.length; i++) hist[i] /= total
    return hist
  }

  /** Capture a small canvas from video element for comparison */
  captureFrame(videoEl, size = this._size) {
    if (!videoEl || !videoEl.videoWidth) return null
    const c = Object.assign(document.createElement('canvas'), { width: size, height: size })
    const ctx = c.getContext('2d')
    ctx.drawImage(videoEl, 0, 0, size, size)
    return { canvas: c, fingerprint: this.computeFingerprint(c), timestamp: Date.now() }
  }

  /** Compare two fingerprints — returns similarity 0.0 to 1.0 */
  compare(fp1, fp2) {
    if (!fp1 || !fp2 || fp1.length !== fp2.length) return 0
    let dot = 0, n1 = 0, n2 = 0
    for (let i = 0; i < fp1.length; i++) {
      dot += fp1[i] * fp2[i]
      n1  += fp1[i] * fp1[i]
      n2  += fp2[i] * fp2[i]
    }
    const denom = Math.sqrt(n1) * Math.sqrt(n2)
    return denom === 0 ? 0 : dot / denom
  }

  /** Intersection similarity (alternative — good for histograms) */
  compareIntersection(fp1, fp2) {
    if (!fp1 || !fp2 || fp1.length !== fp2.length) return 0
    let s = 0
    for (let i = 0; i < fp1.length; i++) s += Math.min(fp1[i], fp2[i])
    return s  // already normalized 0-1
  }

  /** Match a live frame against an array of saved frames */
  matchFrames(liveFingerprint, savedFrames = []) {
    let best = null, bestSim = 0
    for (let i = 0; i < savedFrames.length; i++) {
      const f   = savedFrames[i]
      const fp  = f.fingerprint ?? f  // support raw fingerprint or frame object
      const sim = this.compareIntersection(liveFingerprint, fp instanceof Float32Array ? fp : new Float32Array(fp))
      if (sim > bestSim) { bestSim = sim; best = { index: i, similarity: sim, frame: f } }
    }
    return {
      matched:     bestSim >= this._threshold,
      similarity:  Math.round(bestSim * 100) / 100,
      best,
      threshold:   this._threshold,
    }
  }

  /** Capture 360° scan — returns array of {angle, fingerprint} */
  async scan360(videoEl, engineRef, stepDeg = 5) {
    const frames = []
    for (let deg = 0; deg < 360; deg += stepDeg) {
      const frame = this.captureFrame(videoEl)
      if (frame) frames.push({ angle: deg, fingerprint: Array.from(frame.fingerprint), timestamp: Date.now() })
      await new Promise(r => setTimeout(r, 50))  // brief pause between captures
    }
    return frames
  }
}

// ════════════════════════════════════════════════════════════════
//  4. NavigationState — routing + progress
// ════════════════════════════════════════════════════════════════

class NavigationState {
  constructor() {
    this.reset()
  }

  reset() {
    this.active        = false
    this.routeId       = null
    this.route         = null
    this.nodes         = []       // ordered array of route nodes
    this.currentIndex  = 0        // index in nodes array
    this.currentPoint  = null
    this.nextPoint     = null
    this.targetPoint   = null     // final destination
    this.progress      = 0        // 0.0 – 1.0
    this.status        = 'idle'   // idle | navigating | arrived | lost
    this.message       = ''
    this.startedAt     = null
  }

  start(route, memory) {
    if (!route || !route.nodes || route.nodes.length < 2) {
      throw new Error('VISIONAGE_INVALID_ROUTE')
    }
    this.active       = true
    this.routeId      = route.id
    this.route        = route
    this.nodes        = route.nodes.slice().sort((a, b) => a.order - b.order)
    this.currentIndex = 0
    this.currentPoint = this.nodes[0]
    this.nextPoint    = this.nodes[1]
    this.targetPoint  = this.nodes[this.nodes.length - 1]
    this.progress     = 0
    this.status       = 'navigating'
    this.startedAt    = Date.now()
    this.message      = 'Navigation started'
    return this._summary()
  }

  /** Call when user reaches currentPoint — advances to next node */
  advance() {
    if (!this.active) return null
    this.currentIndex++
    if (this.currentIndex >= this.nodes.length) {
      this.status   = 'arrived'
      this.progress = 1.0
      this.message  = 'You have arrived at your destination'
      return this._summary()
    }
    this.currentPoint = this.nodes[this.currentIndex]
    this.nextPoint    = this.nodes[this.currentIndex + 1] ?? null
    this.progress     = this.currentIndex / (this.nodes.length - 1)
    this.message      = `Step ${this.currentIndex + 1} of ${this.nodes.length}`
    return this._summary()
  }

  markLost() { this.status = 'lost'; this.message = 'Repositioning…'; return this._summary() }
  markFound() { this.status = 'navigating'; return this._summary() }

  _summary() {
    return {
      active:       this.active,
      status:       this.status,
      progress:     Math.round(this.progress * 100),
      message:      this.message,
      currentPoint: this.currentPoint,
      nextPoint:    this.nextPoint,
      targetPoint:  this.targetPoint,
      stepIndex:    this.currentIndex,
      totalSteps:   this.nodes.length,
    }
  }

  getSummary() { return this._summary() }
}

// ════════════════════════════════════════════════════════════════
//  5. GPS Utilities
// ════════════════════════════════════════════════════════════════

const GPSUtils = {
  /** Haversine distance in meters */
  distance(gps1, gps2) {
    if (!gps1 || !gps2) return null
    const R  = 6371000
    const φ1 = gps1.lat * Math.PI / 180, φ2 = gps2.lat * Math.PI / 180
    const Δφ = (gps2.lat - gps1.lat) * Math.PI / 180
    const Δλ = (gps2.lng - gps1.lng) * Math.PI / 180
    const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  },

  /** Bearing from gps1 to gps2 in degrees (0-360) */
  bearing(gps1, gps2) {
    if (!gps1 || !gps2) return null
    const φ1 = gps1.lat * Math.PI / 180, φ2 = gps2.lat * Math.PI / 180
    const Δλ = (gps2.lng - gps1.lng) * Math.PI / 180
    const y  = Math.sin(Δλ) * Math.cos(φ2)
    const x  = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ)
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
  },

  /** Get current GPS position (Promise) */
  getCurrentPosition(options = {}) {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) { rej(new Error('GPS not available')); return }
      navigator.geolocation.getCurrentPosition(
        pos => res({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        err => rej(err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 3000, ...options }
      )
    })
  },

  /** Is user within radius meters of target GPS */
  isNear(userGPS, targetGPS, radiusMeters = 15) {
    const d = GPSUtils.distance(userGPS, targetGPS)
    return d !== null && d <= radiusMeters
  },
}

// ════════════════════════════════════════════════════════════════
//  6. ScanMode — record a visual route step by step
// ════════════════════════════════════════════════════════════════

class ScanMode {
  constructor(memory, matcher) {
    this._memory  = memory
    this._matcher = matcher
    this._active  = false
    this._nodes   = []
    this._routeMeta = {}
  }

  get isActive() { return this._active }

  /** Begin recording a new route */
  startScan(options = {}) {
    if (this._active) throw new Error('VISIONAGE_SCAN_ALREADY_ACTIVE')
    this._active    = true
    this._nodes     = []
    this._routeMeta = { title: options.title ?? 'New Route', description: options.description ?? '', placeId: options.placeId ?? null, meta: options.meta ?? {} }
    return { status: 'scanning', message: 'Scan started — move to record points' }
  }

  /** Add a waypoint during scanning */
  async addScanPoint(options = {}) {
    if (!this._active) throw new Error('VISIONAGE_SCAN_NOT_ACTIVE')
    const { angle, title = `Node ${this._nodes.length + 1}`, frames = [], gps = null, meta = {} } = options

    // Save point to memory
    const point = await this._memory.savePoint({ title, angle, frames, gps, type: 'node', meta })

    const node = {
      pointId: point.id,
      order:   this._nodes.length,
      theta:   point.theta,
      gps:     gps,
      frames:  frames,
      title,
    }
    this._nodes.push(node)
    return { node, totalNodes: this._nodes.length, status: 'scanning', message: `Node ${this._nodes.length} recorded` }
  }

  /** Finish scan and save route */
  async finishScan(options = {}) {
    if (!this._active) throw new Error('VISIONAGE_SCAN_NOT_ACTIVE')
    if (this._nodes.length < 2) throw new Error('VISIONAGE_SCAN_NEEDS_MIN_2_NODES')

    const route = await this._memory.saveRoute({
      ...this._routeMeta,
      nodes:   this._nodes,
      startId: this._nodes[0].pointId,
      endId:   this._nodes[this._nodes.length - 1].pointId,
      ...options,
    })

    this._active = false
    const nodes  = [...this._nodes]
    this._nodes  = []
    return { route, nodes, message: `Route saved with ${nodes.length} nodes` }
  }

  /** Cancel without saving */
  cancelScan() {
    this._active = false; this._nodes = []
    return { status: 'cancelled' }
  }

  getProgress() {
    return { active: this._active, nodes: this._nodes.length, meta: this._routeMeta }
  }
}

// ════════════════════════════════════════════════════════════════
//  7. VisionageCore — unified public interface
// ════════════════════════════════════════════════════════════════

export class VisionageCore {
  constructor(options = {}) {
    this._tolerance = options.tolerance ?? 15  // degrees

    // Internal modules
    this._cyclic  = new CyclicEngine({ maxVelocity: options.maxVelocity ?? Infinity, maxHistory: options.maxHistory ?? 500 })
    this._memory  = new SpiralMemory({ dbName: options.dbName ?? 'visionage-v2' })
    this._matcher = new VisualMatcher({ threshold: options.matchThreshold ?? 0.72 })
    this._nav     = new NavigationState()
    this._scan    = new ScanMode(this._memory, this._matcher)
    this._gps     = GPSUtils

    this._ready   = false
    this._lastGPS = null
  }

  // ── Init ──────────────────────────────────────────────────────

  async init() {
    await this._memory.init()
    this._ready = true
    return this
  }

  // ── Angle / Direction ─────────────────────────────────────────

  /** Feed gyroscope angle — call on every deviceorientation event */
  update(angle) {
    return this._cyclic.update(angle)
  }

  /** Get current device angle */
  getAngle() { return this._cyclic.getAngle() }

  /** Direction instruction from current angle to target */
  getDirection(targetAngle) {
    return this._cyclic.getDirection(targetAngle, this._tolerance)
  }

  /** Is device aligned with target angle (within tolerance) */
  isAligned(angle) { return this._cyclic.isAligned(angle, this._tolerance) }

  /** Set angle tolerance in degrees */
  setTolerance(deg) { this._tolerance = deg; return this }

  // ── Memory — Points ───────────────────────────────────────────

  /** Save current position as a named point */
  async savePoint(options = {}) {
    if (!this._ready) await this.init()
    return this._memory.savePoint({ angle: this._cyclic.getAngle(), gps: this._lastGPS, ...options })
  }

  /** Get a point by ID */
  getPoint(id) { return this._memory.getPoint(id) }

  /** All saved points */
  getPoints() { return this._memory.getAllPoints() }

  /** Delete a point */
  async deletePoint(id) { return this._memory.deletePoint(id) }

  /** Find nearest point to current angle */
  findNearest(type = null) {
    return this._memory.findNearestPoint(this._cyclic.getAngle(), { type })
  }

  /** Navigate to a saved point — returns direction */
  navigateTo(pointId) {
    const p = this._memory.getPoint(pointId)
    if (!p) return null
    return this.getDirection(p.theta)
  }

  // ── Memory — Routes ───────────────────────────────────────────

  /** Get all saved routes */
  getRoutes() { return this._memory.getAllRoutes() }

  /** Get route by ID */
  getRoute(id) { return this._memory.getRoute(id) }

  /** Delete a route */
  async deleteRoute(id) { return this._memory.deleteRoute(id) }

  // ── Scan Mode ─────────────────────────────────────────────────

  /** Start recording a route */
  startScan(options = {}) { return this._scan.startScan(options) }

  /** Add waypoint during scan */
  async addScanPoint(options = {}) {
    const angle  = options.angle  ?? this._cyclic.getAngle()
    const gps    = options.gps    ?? this._lastGPS
    return this._scan.addScanPoint({ ...options, angle, gps })
  }

  /** Finish scan and save route */
  async finishScan(options = {}) { return this._scan.finishScan(options) }

  /** Cancel scan */
  cancelScan() { return this._scan.cancelScan() }

  /** Scan progress */
  getScanProgress() { return this._scan.getProgress() }

  get isScanning() { return this._scan.isActive }

  // ── Navigation ────────────────────────────────────────────────

  /** Start navigation along a route */
  startNavigation(routeId) {
    const route = this._memory.getRoute(routeId)
    if (!route) throw new Error('VISIONAGE_ROUTE_NOT_FOUND')
    return this._nav.start(route, this._memory)
  }

  /** Advance to next node (call when user reaches current node) */
  advanceNavigation() { return this._nav.advance() }

  /** Get current navigation state */
  getNavState() { return this._nav.getSummary() }

  /** Stop navigation */
  stopNavigation() { this._nav.reset(); return { status: 'idle' } }

  /** Real-time navigation step — call from update loop */
  navigationTick() {
    if (!this._nav.active) return null
    const state = this._nav.getSummary()
    if (state.status === 'arrived') return state

    const nextNode = this._nav.nextPoint
    if (!nextNode) return state

    const dir = this.getDirection(nextNode.theta)
    if (dir.action === 'arrived') {
      return this._nav.advance()
    }
    return { ...state, direction: dir }
  }

  // ── Visual Matching ───────────────────────────────────────────

  /** Capture frame from video element */
  captureFrame(videoEl) { return this._matcher.captureFrame(videoEl) }

  /** Match live camera fingerprint against saved frames */
  matchFrames(liveFingerprint, savedFrames) {
    return this._matcher.matchFrames(liveFingerprint, savedFrames)
  }

  /** Match live camera against a saved point's frames */
  matchPoint(liveFingerprint, pointId) {
    const p = this._memory.getPoint(pointId)
    if (!p || !p.frames?.length) return { matched: false, similarity: 0 }
    return this._matcher.matchFrames(liveFingerprint, p.frames)
  }

  /** Scan surroundings and match against all saved points */
  findByVisual(liveFingerprint, options = {}) {
    const { threshold = this._matcher._threshold } = options
    const results = []
    for (const p of this._memory.getAllPoints()) {
      if (!p.frames?.length) continue
      const match = this._matcher.matchFrames(liveFingerprint, p.frames)
      if (match.similarity >= threshold) results.push({ point: p, ...match })
    }
    return results.sort((a, b) => b.similarity - a.similarity)
  }

  // ── GPS ───────────────────────────────────────────────────────

  /** Get current GPS position and store it */
  async saveGPS() {
    const gps = await this._gps.getCurrentPosition()
    this._lastGPS = gps
    return gps
  }

  /** Last known GPS */
  getLastGPS() { return this._lastGPS }

  /** Set GPS manually (from external listener) */
  setGPS(gps) { this._lastGPS = gps; return this }

  /** Distance to GPS coordinate in meters */
  distanceToGPS(targetGPS) { return this._gps.distance(this._lastGPS, targetGPS) }

  /** Is user within radiusMeters of target GPS */
  isNearGPS(targetGPS, radiusMeters = 15) { return this._gps.isNear(this._lastGPS, targetGPS, radiusMeters) }

  /** Bearing to target GPS (0-360°) */
  bearingToGPS(targetGPS) { return this._gps.bearing(this._lastGPS, targetGPS) }

  // ── History ───────────────────────────────────────────────────

  getHistory()   { return this._cyclic.getHistory() }
  snapshot()     { return this._cyclic.snapshot() }
  restore(snap)  { return this._cyclic.restore(snap) }
  reset(angle)   { return this._cyclic.reset(angle) }

  // ── Memory Utilities ──────────────────────────────────────────

  async clearMemory() { return this._memory.clear() }
}

export { GPSUtils, VisualMatcher, ScanMode, NavigationState }
export default VisionageCore
