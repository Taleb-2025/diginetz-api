/**
 * VisionageCore v4
 * Fixes v3→v4:
 *  1. visualOK — correct logic: requires explicit match, not just absence of visual
 *  2. navigationTick — 3-condition advance: angle + visual + spatial proof
 *  3. LocalRef — local angle computation from reference point
 *  4. GlobalHistory — capped at 10000 entries
 *  5. GPS/motion as spatial proof inside tick
 */

// ════════════════════════════════════════════════════════════════
//  1. CyclicEngine
// ════════════════════════════════════════════════════════════════

class CyclicEngine {
  constructor(options = {}) {
    this._state     = 0
    this._history   = []
    this._maxHistory = options.maxHistory ?? 500
    this._globalHistory = []  // never cleared — for rebuildPath
  }

  _norm(v) { return ((v % 360) + 360) % 360 }

  update(angle) {
    const prev = this._state
    this._state = this._norm(angle)
    const entry = { angle: this._state, prev, timestamp: Date.now() }
    this._history.push(entry)
    this._globalHistory.push(entry)
    if (this._history.length > this._maxHistory) this._history.shift()
    if (this._globalHistory.length > 10000) this._globalHistory.shift()
    return { angle: this._state }
  }

  getAngle()        { return this._state }
  getHistory()      { return [...this._history] }
  getGlobalHistory(){ return [...this._globalHistory] }

  dist(a, b) {
    const d = Math.abs(this._norm(a) - this._norm(b))
    return Math.min(d, 360 - d)
  }

  signedDist(a, b) {
    const fwd = (this._norm(b) - this._norm(a) + 360) % 360
    return fwd > 180 ? fwd - 360 : fwd
  }

  /** Global direction — used for initial orientation only */
  getDirection(targetAngle, tolerance = 15) {
    const current = this._state
    const target  = this._norm(targetAngle)
    const signed  = this.signedDist(current, target)
    const abs     = Math.abs(signed)
    if (abs <= tolerance) return { action: 'aligned', degrees: signed, abs, instruction: 'Maintain heading', turn: 'none' }
    const turn = signed > 0 ? 'right' : 'left'
    const instruction = abs < 30 ? `Slight ${turn} — ${Math.round(abs)}°`
                      : abs < 120 ? `Turn ${turn} — ${Math.round(abs)}°`
                      : `Turn around — ${Math.round(abs)}°`
    return { action: 'turn', degrees: signed, abs, instruction, turn, current, target }
  }

  isAligned(angle, tolerance = 15) { return this.dist(this._state, angle) <= tolerance }

  reset(angle = 0) {
    this._state   = this._norm(angle)
    this._history = []
  }

  snapshot() { return { angle: this._state, timestamp: Date.now() } }
  restore(s) { this._state = this._norm(s.angle ?? 0) }

  /** Rebuild path from global history */
  rebuildPath() {
    return this._globalHistory.map((e, i) => ({
      index: i,
      angle: e.angle,
      delta: i === 0 ? 0 : this.signedDist(this._globalHistory[i-1].angle, e.angle),
      timestamp: e.timestamp,
    }))
  }
}

// ════════════════════════════════════════════════════════════════
//  2. VisualMatcher — 3-layer fingerprint
//     Layer 1: Color histogram  (30%)
//     Layer 2: Spatial grid     (45%)  ← layout/structure
//     Layer 3: Edge density     (25%)  ← texture/shape
// ════════════════════════════════════════════════════════════════

class VisualMatcher {
  constructor(options = {}) {
    this._threshold  = options.threshold  ?? 0.72
    this._size       = options.size       ?? 64
    this._wHistogram = options.wHistogram ?? 0.30
    this._wSpatial   = options.wSpatial   ?? 0.45
    this._wEdge      = options.wEdge      ?? 0.25
  }

  // Layer 1: Color histogram
  _histogram(data, total, bins = 16) {
    const h = new Float32Array(bins * 3)
    for (let i = 0; i < data.length; i += 4) {
      h[Math.floor(data[i]   / 256 * bins)]        += 1
      h[bins   + Math.floor(data[i+1] / 256 * bins)] += 1
      h[bins*2 + Math.floor(data[i+2] / 256 * bins)] += 1
    }
    for (let i = 0; i < h.length; i++) h[i] /= total
    return h
  }

  _cmpHistogram(h1, h2) {
    if (!h1 || !h2 || h1.length !== h2.length) return 0
    let s = 0; for (let i = 0; i < h1.length; i++) s += Math.min(h1[i], h2[i])
    return s
  }

  // Layer 2: Spatial grid (4×4 brightness)
  _spatialGrid(data, w, h, g = 4) {
    const grid = new Float32Array(g * g), cnt = new Float32Array(g * g)
    const cw = Math.floor(w / g), ch = Math.floor(h / g)
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const gx = Math.min(Math.floor(px / cw), g-1)
        const gy = Math.min(Math.floor(py / ch), g-1)
        const i  = (py * w + px) * 4
        const b  = (data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114) / 255
        const gi = gy * g + gx
        grid[gi] += b; cnt[gi]++
      }
    }
    for (let i = 0; i < grid.length; i++) grid[i] /= (cnt[i] || 1)
    return grid
  }

  _cmpSpatial(g1, g2) {
    if (!g1 || !g2 || g1.length !== g2.length) return 0
    let s = 0; for (let i = 0; i < g1.length; i++) s += Math.abs(g1[i] - g2[i])
    return Math.max(0, 1 - s / g1.length)
  }

  // Layer 3: Sobel edge density (8×8 blocks)
  _edgeDensity(data, w, h, bs = 8) {
    const gray = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++)
      gray[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) / (255*256)

    const cols = Math.floor(w / bs), rows = Math.floor(h / bs)
    const edges = new Float32Array(cols * rows)

    for (let br = 0; br < rows; br++) {
      for (let bc = 0; bc < cols; bc++) {
        let sum = 0, cnt = 0
        for (let y = br*bs+1; y < (br+1)*bs-1; y++) {
          for (let x = bc*bs+1; x < (bc+1)*bs-1; x++) {
            const gx = -gray[(y-1)*w+(x-1)] + gray[(y-1)*w+(x+1)]
                      - 2*gray[y*w+(x-1)]   + 2*gray[y*w+(x+1)]
                      - gray[(y+1)*w+(x-1)] + gray[(y+1)*w+(x+1)]
            const gy = -gray[(y-1)*w+(x-1)] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)]
                      + gray[(y+1)*w+(x-1)] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+(x+1)]
            sum += Math.sqrt(gx*gx + gy*gy); cnt++
          }
        }
        edges[br*cols + bc] = cnt > 0 ? sum / cnt : 0
      }
    }
    let mx = 0; for (let i = 0; i < edges.length; i++) if (edges[i] > mx) mx = edges[i]
    if (mx > 0) for (let i = 0; i < edges.length; i++) edges[i] /= mx
    return edges
  }

  _cmpEdge(e1, e2) {
    if (!e1 || !e2 || e1.length !== e2.length) return 0
    let s = 0; for (let i = 0; i < e1.length; i++) s += Math.min(e1[i], e2[i])
    return s / e1.length
  }

  // Combined fingerprint
  computeFingerprint(source) {
    let imageData, w, h
    if (source && source.data && source.width && source.height) {
      // Accepts ImageData, FakeImageData, or any {data,width,height} object
      imageData = source; w = source.width; h = source.height
    } else if (source && source.getContext) {
      w = source.width; h = source.height
      imageData = source.getContext('2d').getImageData(0, 0, w, h)
    } else return null

    const data = imageData.data, total = data.length / 4
    return {
      histogram: this._histogram(data, total),
      spatial:   this._spatialGrid(data, w, h),
      edges:     this._edgeDensity(data, w, h),
    }
  }

  // Combined similarity (0-1)
  similarity(fp1, fp2) {
    if (!fp1 || !fp2) return 0
    return (
      this._cmpHistogram(fp1.histogram, fp2.histogram) * this._wHistogram +
      this._cmpSpatial(fp1.spatial, fp2.spatial)       * this._wSpatial  +
      this._cmpEdge(fp1.edges, fp2.edges)               * this._wEdge
    )
  }

  captureFrame(videoEl, size = this._size) {
    if (!videoEl || !videoEl.videoWidth) return null
    const c = Object.assign(document.createElement('canvas'), { width: size, height: size })
    c.getContext('2d').drawImage(videoEl, 0, 0, size, size)
    return { fingerprint: this.computeFingerprint(c), timestamp: Date.now() }
  }

  matchFrames(liveFP, savedFrames = []) {
    let best = null, bestSim = 0
    for (let i = 0; i < savedFrames.length; i++) {
      const fp  = savedFrames[i].fingerprint ?? savedFrames[i]
      const sim = this.similarity(liveFP, fp)
      if (sim > bestSim) { bestSim = sim; best = { index: i, similarity: sim } }
    }
    return { matched: bestSim >= this._threshold, similarity: Math.round(bestSim*100)/100, best, threshold: this._threshold }
  }

  // Real scan session — driven by actual gyro angle
  createScanSession(stepDeg = 5) {
    const captured   = new Set()
    const frames     = []
    const totalBuckets = Math.floor(360 / stepDeg)

    return {
      /** Call from deviceorientation handler with real gyro angle */
      onAngle(currentAngle, videoEl, matcher) {
        if (!videoEl || !videoEl.videoWidth) return null
        const bucket = Math.floor(((currentAngle % 360) + 360) % 360 / stepDeg)
        if (captured.has(bucket)) return null
        captured.add(bucket)
        const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 })
        c.getContext('2d').drawImage(videoEl, 0, 0, 64, 64)
        const frame = { angle: bucket * stepDeg, fingerprint: matcher.computeFingerprint(c), timestamp: Date.now() }
        frames.push(frame)
        const progress = Math.round(captured.size / totalBuckets * 100)
        return { frame, progress, done: captured.size >= totalBuckets, captured: captured.size, total: totalBuckets }
      },
      getFrames:   () => [...frames],
      getProgress: () => Math.round(captured.size / totalBuckets * 100),
      isDone:      () => captured.size >= totalBuckets,
      reset()      { captured.clear(); frames.length = 0 },
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  3. NavigationState — local/global separation
//
//  Local:  currentAngle = 0°, target = Δθ
//          → "Maintain heading" or "Slight right +20°"
//  Global: θ₀→θ₁→θ₂ history never erased
//
//  Advance condition:
//    |Δθ_local| ≤ tolerance  AND  visualMatch (if frames exist)
//    NOT just angle — user must physically face the direction
// ════════════════════════════════════════════════════════════════

class NavigationState {
  constructor(tolerance = 15) {
    this._tolerance = tolerance
    this.reset()
  }

  reset() {
    this.active        = false
    this.routeId       = null
    this.nodes         = []
    this.currentIndex  = 0
    this.status        = 'idle'
    this.message       = ''
    this.progress      = 0
    this.startedAt     = null
    // Local reference: reset at each node
    this._localRef     = 0   // global angle when this node was reached
    // Global angle log
    this._globalLog    = []  // [{angle, timestamp}]
  }

  // ── Start ──────────────────────────────────────────────────

  start(route) {
    if (!route?.nodes?.length || route.nodes.length < 2)
      throw new Error('VISIONAGE_INVALID_ROUTE')
    this.active       = true
    this.routeId      = route.id
    this.nodes        = route.nodes.slice().sort((a, b) => a.order - b.order)
    this.currentIndex = 0
    this.status       = 'navigating'
    this.startedAt    = Date.now()
    this.message      = 'Navigation started'
    this.progress     = 0
    this._localRef    = null  // set on first angle feed
    this._globalLog   = []
    return this._summary()
  }

  // ── Feed angle from gyro ────────────────────────────────────

  /**
   * Main tick — call from deviceorientation or setInterval (~1s)
   *
   * @param {number} globalAngle   raw gyro angle 0-360
   * @param {object} visualMatch   { matched:bool, similarity:number } | null
   * @param {object} opts
   *   opts.gps         { lat, lng } current GPS (optional)
   *   opts.gpsTarget   { lat, lng } next node GPS (optional)
   *   opts.gpsRadius   number meters (default 8)
   *   opts.motionScore number 0–1 user movement confidence (optional)
   *
   * Advance requires ALL of:
   *   1. angleOK  — heading within tolerance (local ref)
   *   2. visualOK — visual match IF next node has saved frames
   *   3. spatialProofOK — GPS near OR motion detected
   *      (when neither available, visual alone acts as proof)
   */
  tick(globalAngle, visualMatch = null, opts = {}) {
    if (!this.active) return null

    // Record global log (capped at 5000)
    this._globalLog.push({ angle: globalAngle, timestamp: Date.now() })
    if (this._globalLog.length > 5000) this._globalLog.shift()

    // Set local reference on first tick after node advance
    if (this._localRef === null) this._localRef = globalAngle

    const nextNode = this.nodes[this.currentIndex + 1] ?? null

    if (!nextNode) {
      this.status = 'arrived'; this.message = 'You have arrived'; this.progress = 1.0
      return this._summary()
    }

    // ── 1. Angle check ──
    // Δθ: signed distance from current heading to next node (global)
    // localCurrent/localTarget: display-only, show rotation since last node
    const Δθ           = this._signedDist(globalAngle, nextNode.theta)
    const absΔθ        = Math.abs(Δθ)
    const angleOK      = absΔθ <= this._tolerance
    // Display: how much rotated since last node (local reference)
    const localCurrent = this._localRef !== null ? this._signedDist(this._localRef, globalAngle) : 0
    const localTarget  = this._localRef !== null ? this._signedDist(this._localRef, nextNode.theta) : Δθ

    // ── 2. Visual check ──
    // visualOK = true ONLY if:
    //   a) next node has no saved frames (no visual data to check), OR
    //   b) visualMatch is explicitly provided AND matched===true
    const nextHasFrames = Array.isArray(nextNode.frames) && nextNode.frames.length > 0
    const visualOK      = !nextHasFrames || (visualMatch != null && visualMatch.matched === true)

    // ── 3. Spatial proof ──
    const { gps = null, gpsTarget = null, gpsRadius = 8, motionScore = null } = opts
    const gpsDist    = (gps && gpsTarget) ? this._haversine(gps, gpsTarget) : null
    const gpsNear    = gpsDist !== null && gpsDist <= gpsRadius
    // motionScore: advisory only, never confirms arrival alone
    const hasMotion      = motionScore !== null && motionScore > 0.3
    const gpsAvailable   = gps !== null && gpsTarget !== null
    const noSpatialData  = !gpsAvailable
    // spatialProofOK rules:
    //   GPS available → must be near (only reliable proof indoors)
    //   No GPS + next node has frames → require visual match (matched===true)
    //   No GPS + no frames → allow angle-only (simple personal route, no scan data)
    const visualConfirmed = visualMatch != null && visualMatch.matched === true
    const spatialProofOK  = gpsAvailable
      ? gpsNear
      : (nextHasFrames ? visualConfirmed : true)

    // ── Heading instruction ──
    let instruction, headingStatus
    if (angleOK) {
      instruction = 'Maintain heading — go forward'; headingStatus = 'aligned'
    } else {
      const turn  = Δθ > 0 ? 'right' : 'left'
      instruction = absΔθ < 30
        ? `Slight ${turn} ${Math.round(absΔθ)}° — then go forward`
        : absΔθ < 120
          ? `Turn ${turn} ${Math.round(absΔθ)}°`
          : `Turn around — ${Math.round(absΔθ)}°`
      headingStatus = 'turning'
    }

    // ── Advance decision ──
    if (angleOK && visualOK && spatialProofOK) return this._advance(globalAngle)

    return {
      ...this._summary(),
      localDelta: Math.round(Δθ), absLocalDelta: Math.round(absΔθ),
      localCurrent: Math.round(localCurrent), localTarget: Math.round(localTarget),
      headingStatus, instruction, visualMatch,
      checks: { angleOK, visualOK, spatialProofOK, gpsNear, hasMotion, noSpatialData, gpsAvailable, visualConfirmed, nextHasFrames },
      gpsAccuracyWarning: (gps && gps.accuracy && gps.accuracy > 20) ? `GPS accuracy ${Math.round(gps.accuracy)}m — too low, ignored` : null,
      nextNode,
    }
  }

  // ── Haversine inside tick ─────────────────────────────────────
  _haversine(a, b) {
    const R=6371000, φ1=a.lat*Math.PI/180, φ2=b.lat*Math.PI/180
    const Δφ=(b.lat-a.lat)*Math.PI/180, Δλ=(b.lng-a.lng)*Math.PI/180
    const x=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))
  }

  // ── Advance to next node ────────────────────────────────────

  _advance(globalAngle) {
    this.currentIndex++
    this._localRef = globalAngle  // new local reference = 0°

    if (this.currentIndex >= this.nodes.length - 1) {
      this.status   = 'arrived'
      this.progress = 1.0
      this.message  = 'You have arrived at your destination'
    } else {
      this.progress = this.currentIndex / (this.nodes.length - 1)
      this.message  = `Step ${this.currentIndex + 1} of ${this.nodes.length}`
      this.status   = 'navigating'
    }
    return { ...this._summary(), advanced: true, checks: null }
  }

  markLost()  { this.status = 'lost';      this.message = 'Repositioning…'; return this._summary() }
  markFound() { this.status = 'navigating';                                  return this._summary() }

  // ── Rebuild reverse path ────────────────────────────────────

  rebuildPath() {
    return this._globalLog.slice().reverse().map((e, i) => ({
      index:     i,
      angle:     e.angle,
      timestamp: e.timestamp,
    }))
  }

  // ── Helpers ─────────────────────────────────────────────────

  _signedDist(a, b) {
    const fwd = (((b - a) % 360) + 360) % 360
    return fwd > 180 ? fwd - 360 : fwd
  }

  get currentPoint() { return this.nodes[this.currentIndex] ?? null }
  get nextPoint()    { return this.nodes[this.currentIndex + 1] ?? null }
  get targetPoint()  { return this.nodes[this.nodes.length - 1] ?? null }

  _summary() {
    return {
      active:       this.active,
      status:       this.status,
      progress:     Math.round(this.progress * 100),
      message:      this.message,
      stepIndex:    this.currentIndex,
      totalSteps:   this.nodes.length,
      currentPoint: this.currentPoint,
      nextPoint:    this.nextPoint,
      targetPoint:  this.targetPoint,
    }
  }

  getSummary() { return this._summary() }
}

// ════════════════════════════════════════════════════════════════
//  4. SpiralMemory — points + routes (IndexedDB)
// ════════════════════════════════════════════════════════════════

class SpiralMemory {
  constructor(options = {}) {
    this._dbName  = options.dbName ?? 'visionage-v3'
    this._version = 3
    this._stores  = ['points', 'routes']
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
        for (const s of stores) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' })
      }
      req.onsuccess = e => { this._db = e.target.result; res(this._db) }
      req.onerror   = e => rej(e.target.error)
    })
  }

  async _put(store, obj) {
    const db = await this._openDB(); if (!db) return
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(obj)
      tx.oncomplete = () => res(); tx.onerror = e => rej(e.target.error)
    })
  }

  async _del(store, id) {
    const db = await this._openDB(); if (!db) return
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).delete(id)
      tx.oncomplete = () => res(); tx.onerror = e => rej(e.target.error)
    })
  }

  async _getAll(store) {
    const db = await this._openDB(); if (!db) return []
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll()
      req.onsuccess = e => res(e.target.result ?? [])
      req.onerror   = e => rej(e.target.error)
    })
  }

  async init() {
    if (this._loaded) return
    const [pts, rts] = await Promise.all([this._getAll('points'), this._getAll('routes')])
    for (const p of pts) this._points.set(p.id, p)
    for (const r of rts) this._routes.set(r.id, r)
    this._loaded = true
  }

  _id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}` }
  _norm(v)    { return ((v % 360) + 360) % 360 }

  async savePoint(data) {
    if (!this._loaded) await this.init()
    const p = {
      id:          data.id        ?? this._id('pt'),
      title:       data.title     ?? 'Point',
      description: data.description ?? '',
      theta:       this._norm(data.angle ?? 0),
      gps:         data.gps       ?? null,
      frames:      data.frames    ?? [],  // [{fingerprint, angle, timestamp}]
      type:        data.type      ?? 'point',
      scope:       data.scope     ?? 'personal',  // personal | published | merchant
      meta:        data.meta      ?? {},
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    }
    this._points.set(p.id, p)
    setTimeout(() => this._put('points', p).catch(console.error), 0)
    return p
  }

  async deletePoint(id) {
    this._points.delete(id)
    setTimeout(() => this._del('points', id).catch(console.error), 0)
  }

  getPoint(id)   { return this._points.get(id) ?? null }
  getAllPoints()  { return [...this._points.values()] }

  async saveRoute(data) {
    if (!this._loaded) await this.init()
    const r = {
      id:          data.id          ?? this._id('rt'),
      title:       data.title       ?? 'Route',
      description: data.description ?? '',
      nodes:       data.nodes       ?? [],
      startId:     data.startId     ?? null,
      endId:       data.endId       ?? null,
      placeId:     data.placeId     ?? null,
      scope:       data.scope       ?? 'personal',  // personal | published | merchant
      published:   data.published   ?? false,
      meta:        data.meta        ?? {},
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    }
    this._routes.set(r.id, r)
    setTimeout(() => this._put('routes', r).catch(console.error), 0)
    return r
  }

  async deleteRoute(id) {
    this._routes.delete(id)
    setTimeout(() => this._del('routes', id).catch(console.error), 0)
  }

  getRoute(id)   { return this._routes.get(id) ?? null }
  getAllRoutes()  { return [...this._routes.values()] }

  findNearestPoint(theta, options = {}) {
    const { type = null, maxDist = 180 } = options
    let best = null, bestD = Infinity
    const norm = v => ((v%360)+360)%360
    const ad   = (a, b) => { const d = Math.abs(norm(a)-norm(b)); return Math.min(d, 360-d) }
    for (const p of this._points.values()) {
      if (type && p.type !== type) continue
      const d = ad(theta, p.theta)
      if (d < bestD && d <= maxDist) { best = p; bestD = d }
    }
    return best ? { ...best, _angleDist: bestD } : null
  }

  async clear() {
    this._points.clear(); this._routes.clear()
    const db = await this._openDB(); if (!db) return
    await Promise.all(this._stores.map(s => new Promise((res, rej) => {
      const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).clear()
      tx.oncomplete = () => res(); tx.onerror = e => rej(e.target.error)
    })))
  }
}

// ════════════════════════════════════════════════════════════════
//  5. GPS Utilities
// ════════════════════════════════════════════════════════════════

const GPSUtils = {
  distance(a, b) {
    if (!a || !b) return null
    const R=6371000, φ1=a.lat*Math.PI/180, φ2=b.lat*Math.PI/180
    const Δφ=(b.lat-a.lat)*Math.PI/180, Δλ=(b.lng-a.lng)*Math.PI/180
    const x=Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
  },
  bearing(a, b) {
    if (!a || !b) return null
    const φ1=a.lat*Math.PI/180, φ2=b.lat*Math.PI/180, Δλ=(b.lng-a.lng)*Math.PI/180
    const y=Math.sin(Δλ)*Math.cos(φ2)
    const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ)
    return ((Math.atan2(y,x)*180/Math.PI)+360)%360
  },
  isNear(a, b, r=15) { const d=GPSUtils.distance(a,b); return d!==null && d<=r },
  getCurrentPosition(opts={}) {
    return new Promise((res,rej) => {
      if (!navigator.geolocation) { rej(new Error('GPS not available')); return }
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        rej, { enableHighAccuracy:true, timeout:8000, maximumAge:3000, ...opts }
      )
    })
  },
}

// ════════════════════════════════════════════════════════════════
//  6. ScanMode
// ════════════════════════════════════════════════════════════════

class ScanMode {
  constructor(memory, matcher) {
    this._memory  = memory
    this._matcher = matcher
    this._active  = false
    this._nodes   = []
    this._meta    = {}
    this._session = null
  }

  get isActive() { return this._active }

  startScan(options = {}) {
    if (this._active) throw new Error('VISIONAGE_SCAN_ALREADY_ACTIVE')
    this._active  = true
    this._nodes   = []
    this._meta    = { title: options.title ?? 'Route', description: options.description ?? '', placeId: options.placeId ?? null, scope: options.scope ?? 'personal' }
    this._session = this._matcher.createScanSession(options.stepDeg ?? 5)
    return { status: 'scanning', message: 'Move device to record' }
  }

  /** Feed gyro angle during scan — captures frame when new bucket reached */
  onScanAngle(currentAngle, videoEl) {
    if (!this._active || !this._session) return null
    return this._session.onAngle(currentAngle, videoEl, this._matcher)
  }

  async addScanPoint(options = {}) {
    if (!this._active) throw new Error('VISIONAGE_SCAN_NOT_ACTIVE')
    const frames = this._session ? this._session.getFrames() : []
    const point  = await this._memory.savePoint({
      title:  options.title ?? `Node ${this._nodes.length + 1}`,
      angle:  options.angle,
      gps:    options.gps ?? null,
      frames: frames.slice(),  // snapshot current frames
      type:   'node',
      scope:  this._meta.scope,
    })
    const node = { pointId: point.id, order: this._nodes.length, theta: point.theta, gps: point.gps, frames: point.frames, title: point.title }
    this._nodes.push(node)
    // Reset session frames for next node
    if (this._session) this._session.reset()
    return { node, totalNodes: this._nodes.length, status: 'scanning' }
  }

  async finishScan(options = {}) {
    if (!this._active) throw new Error('VISIONAGE_SCAN_NOT_ACTIVE')
    if (this._nodes.length < 2) throw new Error('VISIONAGE_SCAN_NEEDS_MIN_2_NODES')
    const route = await this._memory.saveRoute({
      ...this._meta, nodes: this._nodes,
      startId: this._nodes[0].pointId,
      endId:   this._nodes[this._nodes.length-1].pointId,
      ...options,
    })
    this._active = false; this._nodes = []; this._session = null
    return { route, message: `Route saved with ${route.nodes.length} nodes` }
  }

  cancelScan() { this._active = false; this._nodes = []; this._session = null; return { status: 'cancelled' } }
  getProgress() { return { active: this._active, nodes: this._nodes.length, scanProgress: this._session?.getProgress() ?? 0 } }
}

// ════════════════════════════════════════════════════════════════
//  7. VisionageCore — unified public interface
// ════════════════════════════════════════════════════════════════

export class VisionageCore {
  constructor(options = {}) {
    this._tolerance = options.tolerance ?? 15
    this._cyclic    = new CyclicEngine({ maxHistory: options.maxHistory ?? 500 })
    this._memory    = new SpiralMemory({ dbName: options.dbName ?? 'visionage-v3' })
    this._matcher   = new VisualMatcher({ threshold: options.matchThreshold ?? 0.72 })
    this._nav       = new NavigationState(this._tolerance)
    this._scan      = new ScanMode(this._memory, this._matcher)
    this._gps       = GPSUtils
    this._lastGPS   = null
    this._ready     = false
  }

  async init() { await this._memory.init(); this._ready = true; return this }

  // ── Angle ──────────────────────────────────────────────────

  update(angle) { return this._cyclic.update(angle) }
  getAngle()    { return this._cyclic.getAngle() }
  getDirection(targetAngle) { return this._cyclic.getDirection(targetAngle, this._tolerance) }
  isAligned(angle)          { return this._cyclic.isAligned(angle, this._tolerance) }
  setTolerance(deg)         { this._tolerance = deg; this._nav._tolerance = deg; return this }
  rebuildPath()             { return this._cyclic.rebuildPath() }

  // ── Points ─────────────────────────────────────────────────

  async savePoint(options = {}) {
    if (!this._ready) await this.init()
    return this._memory.savePoint({ angle: this._cyclic.getAngle(), gps: this._lastGPS, ...options })
  }
  getPoint(id)       { return this._memory.getPoint(id) }
  getPoints()        { return this._memory.getAllPoints() }
  async deletePoint(id) { return this._memory.deletePoint(id) }
  findNearest(type=null) { return this._memory.findNearestPoint(this._cyclic.getAngle(), { type }) }
  navigateTo(pointId) {
    const p = this._memory.getPoint(pointId); if (!p) return null
    return this._cyclic.getDirection(p.theta, this._tolerance)
  }

  // ── Routes ─────────────────────────────────────────────────

  getRoutes()           { return this._memory.getAllRoutes() }
  getRoute(id)          { return this._memory.getRoute(id) }
  async deleteRoute(id) { return this._memory.deleteRoute(id) }

  // ── Scan ───────────────────────────────────────────────────

  startScan(options = {}) { return this._scan.startScan(options) }
  async addScanPoint(options = {}) {
    return this._scan.addScanPoint({ angle: this._cyclic.getAngle(), gps: this._lastGPS, ...options })
  }
  async finishScan(options = {}) { return this._scan.finishScan(options) }
  cancelScan()       { return this._scan.cancelScan() }
  getScanProgress()  { return this._scan.getProgress() }
  get isScanning()   { return this._scan.isActive }

  /** Call from deviceorientation during scan */
  onScanAngle(videoEl) { return this._scan.onScanAngle(this._cyclic.getAngle(), videoEl) }

  // ── Navigation ─────────────────────────────────────────────

  startNavigation(routeId) {
    const route = this._memory.getRoute(routeId)
    if (!route) throw new Error('VISIONAGE_ROUTE_NOT_FOUND')
    return this._nav.start(route)
  }

  /**
   * Main navigation tick — call from deviceorientation or setInterval (~1s)
   *
   * @param {object} visualMatch  { matched:bool, similarity:number } | null
   * @param {object} opts
   *   opts.motionScore  number 0–1  — from accelerometer (optional)
   *   opts.gpsRadius    number meters for GPS threshold (default 8)
   *
   * GPS is taken from this._lastGPS (set via setGPS/saveGPS).
   * nextNode.gps is taken from the route node if saved during scan.
   */
  navigationTick(visualMatch = null, opts = {}) {
    if (!this._nav.active) return null

    const nextNode = this._nav.nextPoint
    const gps      = this._lastGPS

    // Only use GPS if accuracy is acceptable (≤ 20m)
    const gpsOK    = gps && (!gps.accuracy || gps.accuracy <= 20)
    const gpsTarget = nextNode?.gps ?? null
    // Pass accuracy warning back to caller
    const accuracyWarn = (gps && gps.accuracy && gps.accuracy > 20)
      ? `GPS accuracy ${Math.round(gps.accuracy)}m — too low, ignored` : null

    const result = this._nav.tick(
      this._cyclic.getAngle(),
      visualMatch,
      {
        gps:         gpsOK ? gps : null,
        gpsTarget:   gpsTarget,
        gpsRadius:   opts.gpsRadius    ?? 8,
        motionScore: opts.motionScore  ?? null,
      }
    )
    if (result && accuracyWarn) result.gpsAccuracyWarning = accuracyWarn
    return result
  }

  getNavState()     { return this._nav.getSummary() }
  stopNavigation()  { this._nav.reset(); return { status: 'idle' } }
  markLost()        { return this._nav.markLost() }
  markFound()       { return this._nav.markFound() }
  rebuildNavPath()  { return this._nav.rebuildPath() }

  // ── Visual ─────────────────────────────────────────────────

  captureFrame(videoEl)                  { return this._matcher.captureFrame(videoEl) }
  matchFrames(liveFP, savedFrames)       { return this._matcher.matchFrames(liveFP, savedFrames) }
  matchPoint(liveFP, pointId) {
    const p = this._memory.getPoint(pointId)
    if (!p || !p.frames?.length) return { matched: false, similarity: 0 }
    return this._matcher.matchFrames(liveFP, p.frames)
  }
  visualSimilarity(fp1, fp2)             { return this._matcher.similarity(fp1, fp2) }
  createScanSession(stepDeg = 5)         { return this._matcher.createScanSession(stepDeg) }

  // ── GPS ────────────────────────────────────────────────────

  async saveGPS() {
    const gps = await this._gps.getCurrentPosition()
    this._lastGPS = gps; return gps
  }
  setGPS(gps)              { this._lastGPS = gps; return this }
  getLastGPS()             { return this._lastGPS }
  distanceToGPS(target)    { return this._gps.distance(this._lastGPS, target) }
  isNearGPS(target, r=15)  { return this._gps.isNear(this._lastGPS, target, r) }
  bearingToGPS(target)     { return this._gps.bearing(this._lastGPS, target) }

  // ── History ────────────────────────────────────────────────

  getHistory()       { return this._cyclic.getHistory() }
  getGlobalHistory() { return this._cyclic.getGlobalHistory() }
  snapshot()         { return this._cyclic.snapshot() }
  restore(s)         { return this._cyclic.restore(s) }
  reset(angle)       { return this._cyclic.reset(angle) }
  async clearMemory(){ return this._memory.clear() }
}

export { GPSUtils, VisualMatcher, ScanMode, NavigationState, CyclicEngine }
export default VisionageCore
