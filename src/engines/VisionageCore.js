/**
 * VisionageCore v6
 *
 * المبدأ: Transition = Identity
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * الإصلاحات عن v5:
 *  1. Δθ يُحفظ أثناء Scan مباشرة — لا يُستنتج لاحقاً من theta
 *  2. Anchor بدل Node — تسمية واضحة
 *  3. Transition = { fromId, toId, deltaTheta, toFrames, toGps }
 *  4. visualMatch يُمرَّر من الخارج بعد حساب حقيقي
 *  5. اتجاه يمين/يسار مُصحَّح
 *  6. TransitionStore يقبل hydration من JSON خارجي
 *
 * Sections:
 *  1. CyclicEngine
 *  2. TransitionStore (Anchor + Transition)
 *  3. VisualMatcher
 *  4. NavigationState
 *  5. ScanMode
 *  6. GPSUtils
 *  7. VisionageCore
 */

// ════════════════════════════════════════════════════════════════
//  1. CyclicEngine
// ════════════════════════════════════════════════════════════════

class CyclicEngine {
  constructor(options = {}) {
    this._angle      = 0
    this._refAngle   = null
    this._history    = []
    this._globalLog  = []
    this._maxHistory = options.maxHistory ?? 500
  }

  _norm(v) { return ((v % 360) + 360) % 360 }

  signedDist(a, b) {
    const fwd = (this._norm(b) - this._norm(a) + 360) % 360
    return fwd > 180 ? fwd - 360 : fwd
  }

  dist(a, b) {
    const d = Math.abs(this._norm(a) - this._norm(b))
    return Math.min(d, 360 - d)
  }

  update(globalAngle) {
    const prev  = this._angle
    this._angle = this._norm(globalAngle)
    const entry = { angle: this._angle, prev, timestamp: Date.now() }
    this._history.push(entry)
    this._globalLog.push(entry)
    if (this._history.length > this._maxHistory) this._history.shift()
    if (this._globalLog.length > 10000) this._globalLog.shift()
    const localDelta = this._refAngle !== null
      ? this.signedDist(this._refAngle, this._angle) : 0
    return { angle: this._angle, localDelta }
  }

  getAngle()         { return this._angle }
  getLocalDelta()    {
    return this._refAngle !== null ? this.signedDist(this._refAngle, this._angle) : 0
  }
  setLocalRef(a)     { this._refAngle = this._norm(a ?? this._angle) }
  getHistory()       { return [...this._history] }
  getGlobalHistory() { return [...this._globalLog] }
  snapshot()         { return { angle: this._angle, refAngle: this._refAngle } }
  restore(s)         { this._angle = this._norm(s.angle ?? 0); this._refAngle = s.refAngle ?? null }
  reset()            { this._angle = 0; this._refAngle = null; this._history = [] }

  rebuildTransitions() {
    return this._globalLog.map((e, i) => ({
      index: i, angle: e.angle,
      delta: i === 0 ? 0 : this.signedDist(this._globalLog[i-1].angle, e.angle),
      timestamp: e.timestamp,
    }))
  }
}

// ════════════════════════════════════════════════════════════════
//  2. TransitionStore
//
//  Anchor     = reference point (has frames, gps — not a coordinate)
//  Transition = identity unit: { deltaTheta, toFrames, toGps }
//
//  Route = { anchors: [A,B,C], transitions: [T₁,T₂] }
//  where T₁ = A→B, T₂ = B→C
// ════════════════════════════════════════════════════════════════

class TransitionStore {
  constructor() {
    this._routes  = new Map()
    this._anchors = new Map()  // renamed from _points
  }

  _id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,6)}` }

  // ── Anchors ─────────────────────────────────────────────────

  saveAnchor(data) {
    const a = {
      id:        data.id    ?? this._id('anc'),
      title:     data.title ?? 'Anchor',
      frames:    data.frames ?? [],   // for visual matching on arrival
      gps:       data.gps   ?? null,  // assistant only
      type:      data.type  ?? 'anchor',
      scope:     data.scope ?? 'personal',
      order:     data.order ?? 0,
      createdAt: Date.now(),
    }
    this._anchors.set(a.id, a)
    return a
  }

  getAnchor(id)   { return this._anchors.get(id) ?? null }
  getAllAnchors()  { return [...this._anchors.values()] }
  deleteAnchor(id){ this._anchors.delete(id) }

  // Backward compat — expose as points for visionage.route.js
  savePoint(data)  { return this.saveAnchor(data) }
  getPoint(id)     { return this.getAnchor(id) }
  getAllPoints()    { return this.getAllAnchors() }
  deletePoint(id)  { return this.deleteAnchor(id) }
  _points          = { get size() { return 0 } }  // dummy

  findNearestAnchor(theta, type = null) {
    const norm = v => ((v%360)+360)%360
    const ad   = (a,b) => { const d=Math.abs(norm(a)-norm(b)); return Math.min(d,360-d) }
    // Anchors don't store theta directly — find by order/gps
    // For backward compat, support theta on anchors if present
    let best = null, bestD = Infinity
    for (const a of this._anchors.values()) {
      if (type && a.type !== type) continue
      if (a.theta === undefined) continue
      const d = ad(theta, a.theta)
      if (d < bestD) { best = a; bestD = d }
    }
    return best ? { ...best, _angleDist: bestD } : null
  }

  // ── Routes ──────────────────────────────────────────────────

  /**
   * Save route with pre-computed transitions
   * transitions: [{ fromId, toId, deltaTheta, toFrames, toGps }]
   */
  saveRoute(data) {
    const r = {
      id:          data.id          ?? this._id('rt'),
      title:       data.title       ?? 'Route',
      description: data.description ?? '',
      // Anchors: reference points along the route
      anchors:     data.anchors     ?? [],
      // Transitions: the actual identity of the route
      transitions: data.transitions ?? [],
      // Legacy nodes field for visionage.route.js compatibility
      nodes:       data.nodes       ?? [],
      startId:     data.startId     ?? null,
      endId:       data.endId       ?? null,
      scope:       data.scope       ?? 'personal',
      published:   data.published   ?? false,
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    }
    this._routes.set(r.id, r)
    return r
  }

  getRoute(id)   { return this._routes.get(id) ?? null }
  getAllRoutes()  { return [...this._routes.values()] }
  deleteRoute(id){ this._routes.delete(id) }

  // Hydrate from server JSON (called after Railway loads visionage.json)
  hydrateRoutes(routes) {
    for (const r of routes) this._routes.set(r.id, r)
  }
  hydrateAnchors(anchors) {
    for (const a of anchors) this._anchors.set(a.id, a)
  }
  // Legacy compat
  restoreRoutes(routes)  { this.hydrateRoutes(routes) }
  restorePoints(points)  { this.hydrateAnchors(points) }
}

// ════════════════════════════════════════════════════════════════
//  3. VisualMatcher — 3-layer fingerprint
// ════════════════════════════════════════════════════════════════

class VisualMatcher {
  constructor(options = {}) {
    this._threshold = options.threshold ?? 0.72
    this._size      = options.size ?? 64
    this._wH = 0.30; this._wS = 0.45; this._wE = 0.25
  }

  _histogram(data, total, bins=16) {
    const h = new Float32Array(bins*3)
    for (let i=0;i<data.length;i+=4) {
      h[Math.floor(data[i]/256*bins)]+=1
      h[bins+Math.floor(data[i+1]/256*bins)]+=1
      h[bins*2+Math.floor(data[i+2]/256*bins)]+=1
    }
    for (let i=0;i<h.length;i++) h[i]/=total
    return h
  }
  _cmpH(h1,h2) {
    if(!h1||!h2||h1.length!==h2.length)return 0
    let s=0; for(let i=0;i<h1.length;i++) s+=Math.min(h1[i],h2[i]); return s
  }

  _spatialGrid(data,w,h,g=4) {
    const grid=new Float32Array(g*g), cnt=new Float32Array(g*g)
    const cw=Math.floor(w/g), ch=Math.floor(h/g)
    for(let py=0;py<h;py++) for(let px=0;px<w;px++) {
      const gx=Math.min(Math.floor(px/cw),g-1), gy=Math.min(Math.floor(py/ch),g-1)
      const i=(py*w+px)*4, b=(data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114)/255
      const gi=gy*g+gx; grid[gi]+=b; cnt[gi]++
    }
    for(let i=0;i<grid.length;i++) grid[i]/=(cnt[i]||1)
    return grid
  }
  _cmpS(g1,g2) {
    if(!g1||!g2||g1.length!==g2.length)return 0
    let s=0; for(let i=0;i<g1.length;i++) s+=Math.abs(g1[i]-g2[i])
    return Math.max(0,1-s/g1.length)
  }

  _edgeDensity(data,w,h,bs=8) {
    const gray=new Float32Array(w*h)
    for(let i=0;i<w*h;i++) gray[i]=(data[i*4]*77+data[i*4+1]*150+data[i*4+2]*29)/(255*256)
    const cols=Math.floor(w/bs), rows=Math.floor(h/bs), edges=new Float32Array(cols*rows)
    for(let br=0;br<rows;br++) for(let bc=0;bc<cols;bc++) {
      let sum=0, cnt=0
      for(let y=br*bs+1;y<(br+1)*bs-1;y++) for(let x=bc*bs+1;x<(bc+1)*bs-1;x++) {
        const gx=-gray[(y-1)*w+(x-1)]+gray[(y-1)*w+(x+1)]-2*gray[y*w+(x-1)]+2*gray[y*w+(x+1)]-gray[(y+1)*w+(x-1)]+gray[(y+1)*w+(x+1)]
        const gy=-gray[(y-1)*w+(x-1)]-2*gray[(y-1)*w+x]-gray[(y-1)*w+(x+1)]+gray[(y+1)*w+(x-1)]+2*gray[(y+1)*w+x]+gray[(y+1)*w+(x+1)]
        sum+=Math.sqrt(gx*gx+gy*gy); cnt++
      }
      edges[br*cols+bc]=cnt>0?sum/cnt:0
    }
    let mx=0; for(let i=0;i<edges.length;i++) if(edges[i]>mx) mx=edges[i]
    if(mx>0) for(let i=0;i<edges.length;i++) edges[i]/=mx
    return edges
  }
  _cmpE(e1,e2) {
    if(!e1||!e2||e1.length!==e2.length)return 0
    let s=0; for(let i=0;i<e1.length;i++) s+=Math.min(e1[i],e2[i])
    return s/e1.length
  }

  computeFingerprint(source) {
    let imageData, w, h
    if (source && source.data && source.width) {
      imageData=source; w=source.width; h=source.height
    } else if (source && source.getContext) {
      w=source.width; h=source.height
      imageData=source.getContext('2d').getImageData(0,0,w,h)
    } else return null
    const data=imageData.data, total=data.length/4
    return {
      histogram: this._histogram(data,total),
      spatial:   this._spatialGrid(data,w,h),
      edges:     this._edgeDensity(data,w,h),
    }
  }

  similarity(fp1, fp2) {
    if(!fp1||!fp2) return 0
    return this._cmpH(fp1.histogram,fp2.histogram)*this._wH +
           this._cmpS(fp1.spatial,fp2.spatial)*this._wS +
           this._cmpE(fp1.edges,fp2.edges)*this._wE
  }

  captureFrame(videoEl, size=this._size) {
    if(!videoEl||!videoEl.videoWidth) return null
    const c=Object.assign(document.createElement('canvas'),{width:size,height:size})
    c.getContext('2d').drawImage(videoEl,0,0,size,size)
    return { fingerprint:this.computeFingerprint(c), timestamp:Date.now() }
  }

  /** Match live fingerprint against saved frames array */
  matchFrames(liveFP, savedFrames=[]) {
    let best=null, bestSim=0
    for(let i=0;i<savedFrames.length;i++) {
      const fp=savedFrames[i].fingerprint ?? savedFrames[i]
      const sim=this.similarity(liveFP, fp)
      if(sim>bestSim){bestSim=sim;best={index:i,similarity:sim}}
    }
    return { matched:bestSim>=this._threshold, similarity:Math.round(bestSim*100)/100, best, threshold:this._threshold }
  }
}

// ════════════════════════════════════════════════════════════════
//  4. NavigationState — Transition = Identity
//
//  transitions[i] = { deltaTheta, toFrames, toGps }
//  At step i: user must rotate deltaTheta from localRef
//
//  Advance condition:
//    transError = signedDist(currentΔθ, expectedΔθ) ≤ tolerance
//    AND visualOK  (if toFrames exist — caller must pre-compute)
//    AND spatialProofOK
// ════════════════════════════════════════════════════════════════

class NavigationState {
  constructor(tolerance=15) {
    this._tolerance = tolerance
    this.reset()
  }

  reset() {
    this.active       = false
    this.routeId      = null
    this.anchors      = []
    this.transitions  = []
    this.currentIndex = 0
    this.status       = 'idle'
    this.message      = ''
    this.progress     = 0
    this.startedAt    = null
    this._localRef    = null
    this._globalLog   = []
    this._locating    = false  // true during first-anchor search
  }

  start(route) {
    if (!route) throw new Error('VISIONAGE_INVALID_ROUTE')

    // Support both new format (transitions[]) and legacy (nodes[])
    let anchors, transitions
    if (route.transitions?.length && route.transitions[0]?.deltaTheta !== undefined) {
      // New format: transitions = [{deltaTheta, toFrames, toGps}]
      anchors     = route.anchors     ?? []
      transitions = route.transitions
    } else if (route.nodes?.length >= 2) {
      // Legacy format: compute transitions from nodes
      const nodes = route.nodes.slice().sort((a,b)=>a.order-b.order)
      anchors = nodes
      transitions = []
      for (let i=1;i<nodes.length;i++) {
        const from=nodes[i-1].theta ?? 0, to=nodes[i].theta ?? 0
        const fwd=(((to-from)%360)+360)%360
        transitions.push({
          deltaTheta: fwd>180?fwd-360:fwd,
          toFrames:   nodes[i].frames ?? [],
          toGps:      nodes[i].gps ?? null,
          toTitle:    nodes[i].title ?? `Node ${i+1}`,
        })
      }
    } else {
      throw new Error('VISIONAGE_INVALID_ROUTE')
    }

    if (transitions.length < 1) throw new Error('VISIONAGE_INVALID_ROUTE')

    this.active       = true
    this.routeId      = route.id
    this.anchors      = anchors
    this.transitions  = transitions
    this.currentIndex = 0
    this.startedAt    = Date.now()
    this._localRef    = null
    this._globalLog   = []

    // Check if first anchor has frames → require visual confirmation
    const firstAnchor = anchors[0] ?? null
    const firstHasFrames = firstAnchor &&
      Array.isArray(firstAnchor.frames) && firstAnchor.frames.length > 0

    if (firstHasFrames) {
      // Phase 0: locating — must visually confirm start anchor
      this._locating = true
      this.status    = 'locating'
      this.progress  = 0
      this.message   = `Looking for ${firstAnchor.title ?? 'starting point'}…`
    } else {
      // No frames → skip locating, start immediately
      this._locating = false
      this.status    = 'navigating'
      this.progress  = 0
      this.message   = 'Navigation started'
    }
    return this._summary()
  }

  /**
   * Main tick
   *
   * @param {number} globalAngle   raw gyro 0-360
   * @param {object} visualMatch   pre-computed { matched, similarity } | null
   *   IMPORTANT: caller must compute this BEFORE calling tick:
   *   const liveFP = matcher.captureFrame(video).fingerprint
   *   const vMatch = matcher.matchFrames(liveFP, transitions[i].toFrames)
   * @param {object} opts          { gps, gpsTarget, gpsRadius, motionScore }
   */
  tick(globalAngle, visualMatch=null, opts={}) {
    if (!this.active) return null

    this._globalLog.push({ angle:globalAngle, timestamp:Date.now() })
    if (this._globalLog.length > 5000) this._globalLog.shift()

    if (this._localRef === null) this._localRef = globalAngle

    // ── Phase 0: LOCATING — find first anchor visually ───────────
    if (this._locating) {
      const firstAnchor = this.anchors[0]
      const visualConfirmed = visualMatch != null && visualMatch.matched === true
      const firstTitle = firstAnchor?.title ?? 'starting point'

      if (visualConfirmed) {
        // Found! Set localRef to current angle and begin navigation
        this._locating  = false
        this._localRef  = globalAngle
        this.status     = 'navigating'
        this.message    = `Found — ${firstTitle}`
        return { ...this._summary(), located: true, locatedTitle: firstTitle }
      }

      // Still searching
      const sim = visualMatch?.similarity ?? 0
      this.message = `Looking for ${firstTitle}… ${Math.round(sim*100)}%`
      return {
        ...this._summary(),
        locating:    true,
        similarity:  sim,
        instruction: `Find ${firstTitle} — point camera at starting location`,
      }
    }

    // Arrived at final anchor?
    if (this.currentIndex >= this.transitions.length) {
      this.status='arrived'; this.message='You have arrived'; this.progress=1.0
      return this._summary()
    }

    const T = this.transitions[this.currentIndex]

    // ── 1. Transition check ──────────────────────────────────
    // How much has user rotated from local ref?
    const currentΔθ  = this._signedDist(this._localRef, globalAngle)
    const expectedΔθ = T.deltaTheta
    // Error = how far current rotation is from expected
    const transError = this._signedDist(currentΔθ, expectedΔθ)
    const absError   = Math.abs(transError)
    const angleOK    = absError <= this._tolerance

    // ── 2. Visual check ──────────────────────────────────────
    // Caller pre-computes visualMatch before calling tick
    const hasFrames      = Array.isArray(T.toFrames) && T.toFrames.length > 0
    const visualConfirmed = visualMatch != null && visualMatch.matched === true
    const visualOK        = !hasFrames || visualConfirmed

    // ── 3. Spatial proof ─────────────────────────────────────
    const { gps=null, gpsTarget=null, gpsRadius=8, motionScore=null } = opts
    const gpsDist      = (gps && gpsTarget) ? this._haversine(gps,gpsTarget) : null
    const gpsNear      = gpsDist!==null && gpsDist<=gpsRadius
    const gpsAvailable = gps!==null && gpsTarget!==null
    const visualProof  = visualConfirmed
    // GPS if available, else visual if frames exist, else allow (simple route)
    const spatialProofOK = gpsAvailable ? gpsNear
                         : hasFrames    ? visualProof
                         : true

    // ── Instruction ──────────────────────────────────────────
    // FIX: sign correction
    // transError > 0 → currentΔθ < expectedΔθ → user needs to rotate MORE right
    // transError < 0 → currentΔθ > expectedΔθ → user needs to rotate MORE left
    let instruction, headingStatus
    if (angleOK) {
      instruction='Maintain heading — go forward'; headingStatus='aligned'
    } else {
      const turn = transError > 0 ? 'right' : 'left'  // FIX: was reversed
      instruction = absError < 30  ? `Slight ${turn} ${Math.round(absError)}°`
                  : absError < 120 ? `Turn ${turn} ${Math.round(absError)}°`
                  :                  `Turn around — ${Math.round(absError)}°`
      headingStatus = 'turning'
    }

    if (angleOK && visualOK && spatialProofOK) return this._advance(globalAngle)

    return {
      ...this._summary(),
      expectedDelta:  Math.round(expectedΔθ),
      currentDelta:   Math.round(currentΔθ),
      transError:     Math.round(transError),
      localDelta:     Math.round(transError),  // UI alias
      absLocalDelta:  Math.round(absError),
      headingStatus,
      instruction,
      visualMatch,
      checks: { angleOK, visualOK, spatialProofOK, gpsNear, gpsAvailable, visualConfirmed, hasFrames },
    }
  }

  _advance(globalAngle) {
    this.currentIndex++
    this._localRef = globalAngle  // next Δθ measured from here

    if (this.currentIndex >= this.transitions.length) {
      this.status='arrived'; this.progress=1.0
      this.message='You have arrived at your destination'
    } else {
      this.progress = this.currentIndex / this.transitions.length
      this.message  = `Step ${this.currentIndex + 1} of ${this.transitions.length + 1}`
      this.status   = 'navigating'
    }
    return { ...this._summary(), advanced:true }
  }

  _signedDist(a,b) { const fwd=(((b-a)%360)+360)%360; return fwd>180?fwd-360:fwd }
  _haversine(a,b) {
    const R=6371000,φ1=a.lat*Math.PI/180,φ2=b.lat*Math.PI/180
    const Δφ=(b.lat-a.lat)*Math.PI/180,Δλ=(b.lng-a.lng)*Math.PI/180
    const x=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))
  }

  markLost()  { this.status='lost'; this.message='Repositioning…'; return this._summary() }
  markFound() { this.status='navigating'; return this._summary() }
  rebuildPath() { return [...this._globalLog].reverse().map((e,i)=>({index:i,angle:e.angle,timestamp:e.timestamp})) }

  get currentAnchor() { return this.anchors[this.currentIndex] ?? null }
  get nextAnchor()    { return this.anchors[this.currentIndex+1] ?? null }
  get targetAnchor()  { return this.anchors[this.anchors.length-1] ?? null }
  // Legacy compat
  get currentPoint()  { return this.currentAnchor }
  get nextPoint()     { return this.nextAnchor }
  get targetPoint()   { return this.targetAnchor }

  _summary() {
    const T = this.transitions[this.currentIndex]
    return {
      active:        this.active,
      status:        this.status,   // 'locating' | 'navigating' | 'arrived'
      locating:      this._locating ?? false,
      progress:      Math.round(this.progress*100),
      message:       this.message,
      stepIndex:     this.currentIndex,
      totalSteps:    this.transitions.length + 1,
      currentPoint:  this.currentAnchor,
      nextPoint:     this.nextAnchor,
      targetPoint:   this.targetAnchor,
      expectedDelta: T ? Math.round(T.deltaTheta) : null,
    }
  }

  getSummary() { return this._summary() }
}

// ════════════════════════════════════════════════════════════════
//  5. ScanMode — records Δθ DURING scan, not post-computed
// ════════════════════════════════════════════════════════════════

class ScanMode {
  constructor(store, matcher) {
    this._store       = store
    this._matcher     = matcher
    this._active      = false
    this._anchors     = []      // reference points
    this._transitions = []      // [{deltaTheta, toFrames, toGps, toTitle}]
    this._lastGlobalAngle = null  // global angle at last anchor
    this._meta        = {}
  }

  get isActive() { return this._active }

  startScan(options={}) {
    if (this._active) throw new Error('VISIONAGE_SCAN_ALREADY_ACTIVE')
    this._active          = true
    this._anchors         = []
    this._transitions     = []
    this._lastGlobalAngle = null
    this._meta            = {
      title:       options.title       ?? 'Route',
      description: options.description ?? '',
      scope:       options.scope       ?? 'personal',
    }
    return { status:'scanning', message:'Move to first waypoint — tap Add Node' }
  }

  /**
   * Add anchor at current position
   * FIX: Δθ computed here from real globalAngle, not from stored theta
   *
   * @param {object} options
   *   options.globalAngle  — raw gyro angle NOW (not relative)
   *   options.frames       — visual fingerprints of THIS position
   *   options.gps          — GPS of THIS position
   *   options.title        — label
   */
  addAnchor(options={}) {
    const { globalAngle, frames=[], gps=null, title } = options
    const order = this._anchors.length

    // First anchor — just record position, no transition yet
    if (this._lastGlobalAngle === null) {
      this._lastGlobalAngle = globalAngle
      const anchor = this._store.saveAnchor({
        title:  title ?? 'Start',
        frames: [],    // start anchor has no arrival frames
        gps,
        order:  0,
        scope:  this._meta.scope,
      })
      this._anchors.push(anchor)
      return { anchor, totalAnchors:1, totalTransitions:0, status:'scanning' }
    }

    // Subsequent anchors — compute REAL Δθ from last global angle
    // FIX: this is the actual transition, computed during scan
    const raw = globalAngle - this._lastGlobalAngle
    const fwd = (raw % 360 + 360) % 360
    const deltaTheta = Math.round((fwd > 180 ? fwd - 360 : fwd) * 10) / 10

    const anchor = this._store.saveAnchor({
      title:  title ?? `Anchor ${order}`,
      frames,   // arrival frames for THIS anchor (used when approaching next time)
      gps,
      order,
      scope:  this._meta.scope,
    })

    // Create transition: how to GET TO this anchor from previous
    this._transitions.push({
      fromId:     this._anchors[this._anchors.length-1].id,
      toId:       anchor.id,
      deltaTheta,           // THE real Δθ — computed from actual gyro
      toFrames:   frames,   // frames at destination for visual match
      toGps:      gps,
      toTitle:    anchor.title,
    })

    this._anchors.push(anchor)
    this._lastGlobalAngle = globalAngle  // update for next transition

    return {
      anchor,
      deltaTheta,
      totalAnchors:     this._anchors.length,
      totalTransitions: this._transitions.length,
      status: 'scanning',
    }
  }

  async finishScan(options={}) {
    if (!this._active) throw new Error('VISIONAGE_SCAN_NOT_ACTIVE')
    if (this._transitions.length < 1) throw new Error('VISIONAGE_SCAN_NEEDS_MIN_2_NODES')

    // Build legacy nodes for backward compat with visionage.route.js
    const nodes = this._anchors.map((a,i) => ({
      pointId: a.id,
      order:   i,
      theta:   0,    // not used in v6
      title:   a.title,
      gps:     a.gps ?? null,
      frames:  a.frames ?? [],
    }))

    const route = this._store.saveRoute({
      ...this._meta,
      anchors:     this._anchors,
      transitions: this._transitions,
      nodes,                       // legacy compat
      startId: this._anchors[0].id,
      endId:   this._anchors[this._anchors.length-1].id,
      ...options,
    })

    this._active = false; this._anchors = []; this._transitions = []
    this._lastGlobalAngle = null
    return { route, message:`Route saved — ${route.transitions.length} transitions` }
  }

  cancelScan() {
    this._active=false; this._anchors=[]; this._transitions=[]; this._lastGlobalAngle=null
    return { status:'cancelled' }
  }

  getProgress() {
    return {
      active:      this._active,
      anchors:     this._anchors.length,
      transitions: this._transitions.length,
      meta:        this._meta,
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  6. GPSUtils — assistant only
// ════════════════════════════════════════════════════════════════

const GPSUtils = {
  distance(a,b) {
    if(!a||!b)return null
    const R=6371000,φ1=a.lat*Math.PI/180,φ2=b.lat*Math.PI/180
    const Δφ=(b.lat-a.lat)*Math.PI/180,Δλ=(b.lng-a.lng)*Math.PI/180
    const x=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))
  },
  bearing(a,b) {
    if(!a||!b)return null
    const φ1=a.lat*Math.PI/180,φ2=b.lat*Math.PI/180,Δλ=(b.lng-a.lng)*Math.PI/180
    const y=Math.sin(Δλ)*Math.cos(φ2)
    const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ)
    return((Math.atan2(y,x)*180/Math.PI)+360)%360
  },
  isNear(a,b,r=15){const d=GPSUtils.distance(a,b);return d!==null&&d<=r},
  getCurrentPosition(opts={}) {
    return new Promise((res,rej)=>{
      if(!navigator.geolocation){rej(new Error('GPS not available'));return}
      navigator.geolocation.getCurrentPosition(
        p=>res({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),
        rej,{enableHighAccuracy:true,timeout:8000,maximumAge:3000,...opts}
      )
    })
  },
}

// ════════════════════════════════════════════════════════════════
//  7. VisionageCore — unified public interface
// ════════════════════════════════════════════════════════════════

export class VisionageCore {
  constructor(options={}) {
    this._tolerance = options.tolerance ?? 15
    this._cyclic    = new CyclicEngine({ maxHistory: options.maxHistory ?? 500 })
    this._memory    = new TransitionStore()
    this._matcher   = new VisualMatcher({ threshold: options.matchThreshold ?? 0.72 })
    this._nav       = new NavigationState(this._tolerance)
    this._scan      = new ScanMode(this._memory, this._matcher)
    this._gps       = GPSUtils
    this._lastGPS   = null
    this._ready     = false
  }

  async init() { this._ready=true; return this }

  // ── Angle ─────────────────────────────────────────────────────
  update(angle)      { return this._cyclic.update(angle) }
  getAngle()         { return this._cyclic.getAngle() }
  getLocalDelta()    { return this._cyclic.getLocalDelta() }
  setLocalRef(a)     { this._cyclic.setLocalRef(a) }
  setTolerance(deg)  { this._tolerance=deg; this._nav._tolerance=deg; return this }
  snapshot()         { return this._cyclic.snapshot() }
  restore(s)         { this._cyclic.restore(s) }
  reset()            { this._cyclic.reset() }
  getHistory()       { return this._cyclic.getHistory() }
  getGlobalHistory() { return this._cyclic.getGlobalHistory() }
  rebuildPath()      { return this._cyclic.rebuildTransitions() }

  getDirection(targetAngle) {
    const current=this._cyclic.getAngle()
    const signed=this._cyclic.signedDist(current,targetAngle)
    const abs=Math.abs(signed)
    if(abs<=this._tolerance) return{action:'aligned',degrees:signed,abs,instruction:'Maintain heading',turn:'none'}
    const turn=signed>0?'right':'left'
    const instruction=abs<30?`Slight ${turn} ${Math.round(abs)}°`:abs<120?`Turn ${turn} ${Math.round(abs)}°`:`Turn around — ${Math.round(abs)}°`
    return{action:'turn',degrees:signed,abs,instruction,turn}
  }

  isAligned(angle) { return this._cyclic.dist(this._cyclic.getAngle(),angle)<=this._tolerance }

  // ── Anchors / Points (backward compat) ───────────────────────
  async savePoint(options={}) {
    return this._memory.saveAnchor({ ...options, gps:options.gps??this._lastGPS })
  }
  getPoint(id)          { return this._memory.getAnchor(id) }
  getPoints()           { return this._memory.getAllAnchors() }
  async deletePoint(id) { return this._memory.deleteAnchor(id) }

  // ── Routes ────────────────────────────────────────────────────
  getRoutes()           { return this._memory.getAllRoutes() }
  getRoute(id)          { return this._memory.getRoute(id) }
  async deleteRoute(id) { return this._memory.deleteRoute(id) }

  // ── Scan ──────────────────────────────────────────────────────
  startScan(options={}) { return this._scan.startScan(options) }

  /**
   * Add scan point — passes REAL global angle, not relative
   * FIX: Δθ computed in ScanMode from actual gyro readings
   */
  async addScanPoint(options={}) {
    const globalAngle = options.angle ?? this._cyclic.getAngle()
    return this._scan.addAnchor({
      globalAngle,
      frames: options.frames ?? [],
      gps:    options.gps    ?? this._lastGPS,
      title:  options.title,
    })
  }

  async finishScan(options={}) { return this._scan.finishScan(options) }
  cancelScan()       { return this._scan.cancelScan() }
  getScanProgress()  { return this._scan.getProgress() }
  get isScanning()   { return this._scan.isActive }

  // ── Navigation ────────────────────────────────────────────────
  startNavigation(routeId) {
    const route = this._memory.getRoute(routeId)
    if (!route) throw new Error('VISIONAGE_ROUTE_NOT_FOUND')
    const startAngle = this._cyclic.getAngle()
    this._cyclic.setLocalRef(startAngle)
    const result = this._nav.start(route)
    this._nav._localRef = startAngle  // sync nav localRef with cyclic
    return result
  }

  /**
   * Navigation tick
   * FIX: visual match computed HERE from live video, not passed as false
   * Caller should pass videoEl so we can compute real visual match
   *
   * @param {object} visualMatch  pre-computed or null
   * @param {object} opts         { motionScore, gpsRadius, videoEl }
   */
  navigationTick(visualMatch=null, opts={}) {
    if (!this._nav.active) return null

    const T = this._nav.transitions[this._nav.currentIndex]

    // FIX: if caller provides videoEl, compute visual match now
    let vMatch = visualMatch
    if (!vMatch && opts.videoEl && T?.toFrames?.length) {
      const frame = this._matcher.captureFrame(opts.videoEl)
      if (frame?.fingerprint) {
        vMatch = this._matcher.matchFrames(frame.fingerprint, T.toFrames)
      }
    }

    const gps      = this._lastGPS
    const gpsOK    = gps && (!gps.accuracy || gps.accuracy <= 20)
    const gpsTarget = T?.toGps ?? null

    return this._nav.tick(
      this._cyclic.getAngle(),
      vMatch,
      { gps: gpsOK?gps:null, gpsTarget, gpsRadius:opts.gpsRadius??8, motionScore:opts.motionScore??null }
    )
  }

  getNavState()       { return this._nav.getSummary() }
  stopNavigation()    { this._nav.reset(); return{status:'idle'} }
  advanceNavigation() { return this._nav._advance(this._cyclic.getAngle()) }
  rebuildNavPath()    { return this._nav.rebuildPath() }

  // ── Visual ────────────────────────────────────────────────────
  captureFrame(videoEl)              { return this._matcher.captureFrame(videoEl) }
  matchFrames(liveFP, savedFrames)   { return this._matcher.matchFrames(liveFP,savedFrames) }
  visualSimilarity(fp1,fp2)          { return this._matcher.similarity(fp1,fp2) }
  computeFingerprint(source)         { return this._matcher.computeFingerprint(source) }

  // ── GPS ───────────────────────────────────────────────────────
  async saveGPS()         { const g=await this._gps.getCurrentPosition(); this._lastGPS=g; return g }
  setGPS(gps)             { this._lastGPS=gps; return this }
  getLastGPS()            { return this._lastGPS }
  distanceToGPS(target)   { return this._gps.distance(this._lastGPS,target) }
  isNearGPS(target,r=15)  { return this._gps.isNear(this._lastGPS,target,r) }
  bearingToGPS(target)    { return this._gps.bearing(this._lastGPS,target) }

  // ── Memory restore from server ────────────────────────────────
  restoreFromServer(routes=[], anchors=[]) {
    this._memory.hydrateRoutes(routes)
    this._memory.hydrateAnchors(anchors)
    return this
  }

  async clearMemory() {
    this._memory._routes.clear()
    this._memory._anchors.clear()
  }
}

export { GPSUtils, VisualMatcher, ScanMode, NavigationState, CyclicEngine, TransitionStore }
export default VisionageCore
