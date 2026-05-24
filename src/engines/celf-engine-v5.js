// ═══════════════════════════════════════════════════════════════
//  celf-engine-v5.js — bridge to V6
//  يُصدّر CELF_Engine_V6 باسم CELF_Engine_AI_V5
//  حتى لا يحتاج process-text.route.js أي تغيير
// ═══════════════════════════════════════════════════════════════

export class CELF_Engine_AI_V5 {

  constructor(options = {}) {
    this.cycle       = options.cycle       ?? 360
    this.resolution  = options.resolution  ?? 360
    this.ringCount   = options.ringCount   ?? 5
    this.epsilon     = options.epsilon     ?? 1e-6

    this.diffusionRate   = options.diffusionRate   ?? 0.08
    this.constraintRate  = options.constraintRate  ?? 0.12
    this.recoveryRate    = options.recoveryRate    ?? 0.035
    this.attractorRate   = options.attractorRate   ?? 0.06
    this.attractorLimit  = options.attractorLimit  ?? 12

    this.semanticDimensions  = options.semanticDimensions  ?? 64
    this.activationThreshold = options.activationThreshold ?? 1e-4
    this.historyLimit        = options.historyLimit        ?? 128
    this.semanticMemoryLimit = options.semanticMemoryLimit ?? 96
    this.archiveLimit        = options.archiveLimit        ?? 128

    this.eta          = options.eta          ?? 0.01
    this.etaThreshold = options.etaThreshold ?? 0.05
    this.maxAttractors = this.attractorLimit

    const D = this.semanticDimensions
    const A = this.attractorLimit
    this.W = new Float32Array(D * A)
    for (let i = 0; i < this.W.length; i++)
      this.W[i] = (Math.random() - 0.5) * 0.01

    this.theta_vault     = options.theta_vault     ?? 0.35
    this.theta_attractor = options.theta_attractor ?? 1e-4

    this._lastPrediction     = new Float32Array(D)
    this._lastAttractorState = new Float32Array(A)
    this._lastVector         = new Float32Array(D)
    this._hasPrediction      = false
    this._lastCapsuleAlpha   = 0

    this.rings = Array.from({ length: this.ringCount }, (_, r) =>
      Array.from({ length: this.resolution }, (_, i) => ({
        r, i,
        theta            : (i / this.resolution) * this.cycle,
        p                : 1 / this.resolution,
        residual         : this.epsilon,
        pressure         : 0,
        memory           : 0,
        hysteresis       : 0,
        constraintDensity: 0,
        semanticTrace    : 0,
        intentTrace      : 0,
        credibility      : 1.0
      }))
    )

    this.massTarget = this._totalMass()
    this.vault      = new Map()

    this.state = {
      t             : 0,
      phase         : 'warmup',
      signature     : 0,
      cycleCount    : 0,
      lastTheta     : 0,
      lastIndex     : 0,
      lastDeltaTheta: 0,
      attractors    : [],
      history       : [],
      archive       : [],
      totalError    : 0,
      errorHistory  : [],
      learnCount    : 0
    }

    this.field = {
      signature         : 0,
      coherence         : 0,
      continuity        : 0,
      drift             : 0,
      momentum          : 0,
      resonance         : 0,
      persistence       : 0,
      emergence         : 0,
      topicPressure     : 0,
      semanticGrounding : 0,
      semanticCoherence : 0,
      intentPressure    : 0,
      executionReadiness: 0,
      recallPotential   : 0,
      noveltyPressure   : 0,
      localization      : 0,
      signalType        : 'noise',
      semanticMemory    : [],
      avgCredibility    : 1.0,
      predictionError   : 0,
      lastSourceWeight  : 1.0
    }

    this._metricsCache     = null
    this._metricsCacheTime = -1
  }

  // ── process ───────────────────────────────────────────────────

  process(input, options = {}) {
    this._metricsCache     = null
    this._metricsCacheTime = -1

    if (typeof options === 'number') options = { sourceWeight: options }
    const sourceWeight = this._clamp01(options.sourceWeight ?? 1.0)
    this.field.lastSourceWeight = sourceWeight

    const perturb  = this._perturb(input)
    const feedback = this._computeFeedback(perturb.vector)
    if (feedback.active) this._learn(feedback)

    const delta = this._buildDelta(perturb)
    this._applyDelta(delta, perturb, sourceWeight)
    this._conserveMass()
    this._updateCellDynamics()
    this._diffuse()
    this._updateAttractors(perturb)
    this._applyAttractors()
    this._updateSemanticField(perturb, feedback)
    this._predict()

    if (feedback.active && feedback.magnitude > this.theta_vault)
      this._storeCapsule(input, perturb, feedback)

    this._updatePhase()
    this._updateFieldIdentity()
    this._updateLocalization()

    const snap = this._snapshot(perturb, feedback)
    this._commit(snap)
    return snap
  }

  // ── perturb ───────────────────────────────────────────────────

  _perturb(input) {
    const text = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    let h1 = 2166136261, h2 = 16777619, h3 = 374761393
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      h1 ^= c; h1 = Math.imul(h1, 16777619)
      h2  = Math.imul(h2 ^ c, 2246822519)
      h3  = Math.imul(h3 + c, 3266489917)
    }
    h1 = Math.abs(h1 >>> 0)
    h2 = Math.abs(h2 >>> 0)
    h3 = Math.abs(h3 >>> 0)

    const code      = /```|function|class|const|let|var|=>|import|export/.test(text) ? 1 : 0
    const question  = /[?؟]|كيف|ماذا|لماذا|هل|what|why|how|where/i.test(text) ? 1 : 0
    const error     = /error|fail|exception|خطأ|فشل/i.test(text) ? 1 : 0
    const command   = /اكتب|أنشئ|build|create|fix|write|generate/i.test(text) ? 1 : 0
    const data      = /json|api|server|database|vector|metric/i.test(text) ? 1 : 0
    const emotional = /ألم|خوف|قلق|good|bad|worry|fear/i.test(text) ? 1 : 0
    const reasoning = /theory|concept|logic|architecture|نظرية|فلسفة/i.test(text) ? 1 : 0

    const words   = text.split(/\s+/).filter(Boolean)
    const unique  = new Set(words.map(w => w.toLowerCase()))
    const lexical = this._clamp01(unique.size / Math.max(words.length, 1))
    const length  = this._clamp01(text.length / 2000)

    const vector    = this.semanticVector(text, h1, h2, h3)
    const intensity = this._clamp01(
      length * 0.20 + lexical * 0.20 + code * 0.15 +
      command * 0.15 + error * 0.15 + data * 0.10 + question * 0.05
    )

    const theta = ((h1 % this.resolution) / this.resolution) * this.cycle
    const index = this._thetaToIndex(theta)

    return {
      text, h1, h2, h3, vector, intensity, theta, index,
      semantic: {
        code, question, error, command, data, emotional, reasoning,
        lexical, length,
        lexicalDensity: lexical,
        lengthScore: length,
        intent: {
          ask: question, execute: command, diagnose: error,
          reason: reasoning, code, data
        }
      },
      words: words.length,
      sourceWeight: 1.0
    }
  }

  // ── semanticVector (public — V5 API) ──────────────────────────

  semanticVector(text, h1, h2, h3) {
    const D      = this.semanticDimensions
    const vec    = new Float32Array(D)
    const tokens = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean)

    if (!h1) {
      let hh1 = 2166136261, hh2 = 16777619, hh3 = 374761393
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        hh1 ^= c; hh1 = Math.imul(hh1, 16777619)
        hh2  = Math.imul(hh2 ^ c, 2246822519)
        hh3  = Math.imul(hh3 + c, 3266489917)
      }
      h1 = Math.abs(hh1 >>> 0)
      h2 = Math.abs(hh2 >>> 0)
      h3 = Math.abs(hh3 >>> 0)
    }

    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti]
      let tw = 2166136261
      for (let ci = 0; ci < token.length; ci++) {
        tw ^= token.charCodeAt(ci)
        tw  = Math.imul(tw, 16777619)
      }
      tw = Math.abs(tw >>> 0)
      const w = 1.0 / Math.sqrt(ti + 1)
      vec[(Math.abs(Math.imul(tw ^ h1, 16777619))  >>> 0) % D] += w
      vec[(Math.abs(Math.imul(tw ^ h2, 2246822519)) >>> 0) % D] += w * 0.6
      vec[(Math.abs(Math.imul(tw ^ h3, 3266489917)) >>> 0) % D] += w * 0.4
    }

    let norm = 0
    for (let i = 0; i < D; i++) norm += vec[i] * vec[i]
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < D; i++) vec[i] = Math.fround(vec[i] / norm)
    return vec
  }

  // ── cosineSimilarity (public — V5 API) ────────────────────────

  cosineSimilarity(a, b) {
    return this._cosine(a, b)
  }

  // ── routeContext (public — V5 API) ────────────────────────────

  routeContext(query, limit = 5) {
    const text   = typeof query === 'string' ? query : JSON.stringify(query ?? '')
    const vector = this.semanticVector(text)
    const memory = this.field.semanticMemory

    if (!memory.length) return []

    const items = memory
      .map(item => {
        const sim   = this._cosine(vector, item.vector ?? new Float32Array(0))
        const theta = this._round4(item.theta ?? 0)
        return { t: item.t, theta, score: this._round4(sim), phase: item.phase }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    const hit = this._retrieveVaultHit(vector)
    if (hit) return { items, vaultHit: hit }
    return items
  }

  _retrieveVaultHit(vector) {
    let best = null, bestScore = -1
    for (const [, cap] of this.vault) {
      const sim   = this._cosine(vector, cap.vector ?? new Float32Array(0))
      const reinf = this._clamp01((cap.reinforcement ?? 0) / 10)
      const score = sim * 0.70 + reinf * 0.30
      if (score > bestScore && score > 0.25) {
        bestScore = score
        best = {
          compressed:    cap.text?.slice(0, 80) ?? '',
          score:         this._round4(score),
          phiOrbit:      this._round4(cap.theta ?? 0),
          reinforcement: cap.reinforcement ?? 0
        }
      }
    }
    return best
  }

  // ── buildFieldPrompt (public — V5 API) ────────────────────────

  buildFieldPrompt() {
    return {
      zone:           this.state.phase,
      pressure:       this._round4(this.field.topicPressure),
      continuity:     this._round4(this.field.continuity),
      phase:          this.state.phase,
      resonance:      this._round4(this.field.resonance),
      coherence:      this._round4(this.field.coherence),
      drift:          this._round4(this.field.drift),
      attractorCount: this.state.attractors.length,
      vaultSize:      this.vault.size
    }
  }

  // ── buildCognitiveTarget (public — V5 API) ────────────────────

  buildCognitiveTarget(query, index = null) {
    const userIntent = this._extractUserIntent(query)
    const fieldState = {
      phase:              this.state.phase,
      continuity:         this.field.continuity,
      coherence:          this.field.coherence,
      drift:              this.field.drift,
      semanticGrounding:  this.field.semanticGrounding,
      noveltyPressure:    this.field.noveltyPressure,
      executionReadiness: this.field.executionReadiness,
      recallPotential:    this.field.recallPotential,
      intentPressure:     this.field.intentPressure,
      avgCredibility:     this.field.avgCredibility ?? 1.0,
      vaultSize:          this.vault.size
    }

    const cognitiveMode =
      fieldState.executionReadiness > 0.65 ? 'technical'   :
      fieldState.intentPressure     > 0.60 ? 'analytical'  :
      fieldState.noveltyPressure    > 0.65 ? 'exploratory' :
      'general'

    return {
      focus:         { mode: userIntent.mode, depth: userIntent.depth, what: userIntent.entities },
      cognitiveMode,
      userIntent,
      fieldState,
      _meta: { t: this.state.t, vaultSize: this.vault.size, deepAnalysis: userIntent.depth === 'deep' }
    }
  }

  _extractUserIntent(query) {
    const text = String(query ?? '').toLowerCase()
    const mode =
      /اشرح|explain|how does|what is|ما هو/i.test(text) ? 'explain'   :
      /اكتب|build|create|generate|implement/i.test(text) ? 'implement' :
      /اصلح|fix|debug|error|خطأ/i.test(text)             ? 'debug'     :
      /صمم|design|architecture/i.test(text)               ? 'design'    :
      'general'
    const depth =
      /بالتفصيل|detailed|full|complete/i.test(text) ? 'deep'    :
      /باختصار|brief|quick/i.test(text)              ? 'surface' :
      'balanced'
    const entityPattern = /\b([A-Z][a-zA-Z]{3,}|[a-z]{4,}(?:Context|Builder|Engine|Index|Layer|Vault))\b/g
    const entities = []
    let m
    while ((m = entityPattern.exec(query)) !== null)
      if (!entities.includes(m[1])) entities.push(m[1])
    return { mode, depth, entities, rawQuery: query }
  }

  // ── getSummary (public — V5 API) ──────────────────────────────

  getSummary() {
    return {
      version:        'CELF-V5-bridge',
      phase:          this.state.phase,
      t:              this.state.t,
      field:          this.field,
      metrics:        this._metrics(),
      attractorCount: this.state.attractors.length,
      vaultSize:      this.vault.size
    }
  }

  // ── getActiveCapsules (public — V5 API) ───────────────────────

  getActiveCapsules() {
    return [...this.vault.values()].slice(0, 4)
  }

  // ── storeOrUpdateCapsule (public — V5 API) ────────────────────

  storeOrUpdateCapsule(text, perturbation) {
    const t    = String(text ?? '')
    if (t.length < 10) return null
    let cs = 2166136261
    for (let i = 0; i < t.length; i++) {
      cs ^= t.charCodeAt(i); cs = Math.imul(cs, 16777619)
    }
    const checksum = Math.abs(cs >>> 0).toString(16)
    for (const [id, cap] of this.vault) {
      if (cap.checksum === checksum) {
        cap.reinforcement = (cap.reinforcement ?? 0) + 0.08
        cap.version       = (cap.version ?? 1) + 1
        return id
      }
    }
    const id     = `cap_${this.state.t}_${checksum.slice(0, 6)}`
    const vector = perturbation?.semantic?.vector ?? this.semanticVector(t)
    this.vault.set(id, {
      id, text: t.slice(0, 200), checksum, vector,
      phase: this.state.phase, t: this.state.t,
      theta: this._round4(this.field.signature * 1.618033988749895 % this.cycle),
      reinforcement: 0, version: 1
    })
    if (this.vault.size > 256) {
      const sorted = [...this.vault.entries()].sort(([,a],[,b]) => a.reinforcement - b.reinforcement)
      for (const [id] of sorted.slice(0, this.vault.size - 256)) this.vault.delete(id)
    }
    return id
  }

  // ── feedback ──────────────────────────────────────────────────

  _computeFeedback(currentVector) {
    if (!this._hasPrediction) {
      this._lastVector.set(currentVector)
      return { active: false, error: new Float32Array(this.semanticDimensions), magnitude: 0, quality: 1 }
    }
    const D          = this.semanticDimensions
    const similarity = this._cosine(currentVector, this._lastPrediction)
    const magnitude  = this._clamp01(1 - similarity)
    const error      = new Float32Array(D)
    for (let i = 0; i < D; i++) error[i] = currentVector[i] - this._lastPrediction[i]
    this._lastVector.set(currentVector)
    return { active: true, error, magnitude: this._round4(magnitude), quality: this._round4(similarity) }
  }

  _learn(feedback) {
    const D = this.semanticDimensions, A = this.maxAttractors
    const e = feedback.error, a = this._lastAttractorState
    for (let d = 0; d < D; d++)
      for (let j = 0; j < A; j++)
        this.W[d * A + j] += this.eta * e[d] * a[j]
    const decay = 1 - this.eta * 0.001
    for (let i = 0; i < this.W.length; i++) this.W[i] *= decay
    this.theta_vault = this._clamp01(
      this.theta_vault + this.etaThreshold * (feedback.magnitude - this.theta_vault)
    )
    this.state.errorHistory.push(feedback.magnitude)
    if (this.state.errorHistory.length > 32) this.state.errorHistory.shift()
    this.state.totalError += feedback.magnitude
    this.state.learnCount++
    this.field.predictionError = this._round4(feedback.magnitude)
  }

  // ── field dynamics ────────────────────────────────────────────

  _buildDelta(perturb) {
    const phi     = 1.618033988749895
    const nextSig = this._containTheta(
      this.state.signature * phi + perturb.theta + perturb.intensity * this.cycle * 0.22
    )
    const wrapped = Math.abs(this._signedIndexDist(this.state.lastIndex, perturb.index)) > this.resolution / 2
    if (wrapped) this.state.cycleCount++
    this.state.signature     = nextSig
    this.state.lastTheta     = perturb.theta
    this.state.lastIndex     = perturb.index
    this.state.lastDeltaTheta = this._indexToTheta(this._signedIndexDist(this.state.lastIndex, perturb.index))
    return {
      index: perturb.index, intensity: perturb.intensity, signature: nextSig,
      ringVector: Array.from({ length: this.ringCount }, (_, r) =>
        this._clamp01(perturb.intensity * ((r + 1) / this.ringCount))
      )
    }
  }

  _applyDelta(delta, perturb, sourceWeight = 1.0) {
    const radius = Math.max(2, Math.floor(3 + delta.intensity * 32))
    const semW   = this._clamp01(
      perturb.semantic.code * 0.20 + perturb.semantic.command * 0.20 +
      perturb.semantic.error * 0.18 + perturb.semantic.data * 0.15 +
      perturb.semantic.lexical * 0.15 + perturb.semantic.length * 0.12
    )
    for (let r = 0; r < this.ringCount; r++) {
      const rd = delta.ringVector[r]
      for (let i = 0; i < this.resolution; i++) {
        const cell = this.rings[r][i]
        const d    = this._circularIndexDist(i, delta.index)
        const prox = this._clamp01(1 - d / radius)
        const pressure  = this._clamp01(rd * 0.45 + semW * 0.30 + (1 - prox) * 0.25)
        const density   = cell.constraintDensity
        const expansion = prox * rd * this.recoveryRate * (1 - pressure) * (1 - density) * (1 + semW * 0.20) * sourceWeight
        const narrowing = pressure * this.constraintRate * (1 - prox * 0.5) * (1 + density)
        cell.pressure      = pressure
        cell.p             = this._clampP(cell.p + expansion - narrowing)
        cell.memory        = this._clamp01(cell.memory * 0.985 + prox * rd * 0.013 * sourceWeight)
        cell.hysteresis    = this._clamp01(cell.hysteresis * 0.995 + prox * rd * 0.005)
        cell.semanticTrace = this._clamp01(cell.semanticTrace * 0.992 + prox * semW * 0.008 * sourceWeight)
      }
    }
  }

  _conserveMass() {
    const cells = []
    for (const ring of this.rings) for (const c of ring) cells.push(c)
    const floor   = this.epsilon * cells.length
    const target  = Math.max(this.massTarget, floor + this.epsilon)
    const current = cells.reduce((s, c) => s + Math.max(0, c.p - this.epsilon), 0)
    if (current < this.epsilon) {
      const memSum = cells.reduce((s, c) => s + Math.max(this.epsilon, c.memory + c.semanticTrace), 0)
      for (const c of cells)
        c.p = this.epsilon + ((target - floor) * Math.max(this.epsilon, c.memory + c.semanticTrace) / memSum)
      return
    }
    const factor = Math.max(0, target - floor) / current
    for (const c of cells) c.p = this.epsilon + Math.max(0, c.p - this.epsilon) * factor
  }

  _updateCellDynamics() {
    for (const ring of this.rings) {
      for (const cell of ring) {
        const baseline = 1 / this.resolution
        cell.elasticStrain = this._clamp01(Math.abs(cell.p - baseline) * cell.hysteresis * 0.3)
        cell.p = this._clampP(cell.p - cell.elasticStrain * this.recoveryRate * 0.5)
        cell.constraintDensity = this._clamp01(
          cell.constraintDensity * 0.995 + cell.pressure * 0.0026 +
          cell.memory * 0.0017 + cell.semanticTrace * 0.0007
        )
        cell.credibility = this._clamp01(cell.credibility * 0.99 + (1 - this.field.predictionError) * 0.01)
      }
    }
  }

  _diffuse() {
    const next = this.rings.map(ring => ring.map(c => c.p))
    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        const cell  = this.rings[r][i]
        const left  = this.rings[r][this._wrapI(i - 1)].p
        const right = this.rings[r][this._wrapI(i + 1)].p
        const up    = this.rings[this._wrapR(r - 1)][i].p
        const down  = this.rings[this._wrapR(r + 1)][i].p
        const lap   = (left + right - 2 * cell.p) * 0.70 + (up + down - 2 * cell.p) * 0.30
        const R     = (1 - cell.constraintDensity) * (1 - cell.semanticTrace * 0.25) * (1 - cell.hysteresis * 0.30)
        next[r][i]  = this._clampP(cell.p + this.diffusionRate * R * lap)
      }
    }
    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++)
        this.rings[r][i].p = next[r][i]
  }

  _updateAttractors(perturb) {
    const candidates = []
    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        const c     = this.rings[r][i]
        const score = this._clamp01(
          c.p * 0.40 + c.memory * 0.20 + c.semanticTrace * 0.15 +
          c.constraintDensity * 0.10 + c.credibility * 0.15
        )
        if (score > this.theta_attractor)
          candidates.push({ r, i, theta: c.theta, strength: score, memory: c.memory,
            semanticWeight: c.semanticTrace, intentWeight: c.intentTrace ?? 0,
            credibility: c.credibility, emergentCredibility: c.credibility,
            constraintDensity: c.constraintDensity,
            vector: perturb.vector.slice() })
      }
    }
    candidates.sort((a, b) => b.strength - a.strength)
    const selected = []
    for (const c of candidates) {
      if (!selected.some(a => a.r === c.r && this._circularIndexDist(a.i, c.i) < 6))
        selected.push(c)
      if (selected.length >= this.attractorLimit) break
    }
    this.state.attractors = selected.map(a => ({
      ...a,
      stability  : this._clamp01(a.strength),
      orbitTheta : this._containTheta(a.theta + this.state.lastDeltaTheta * this.attractorRate)
    }))
  }

  _applyAttractors() {
    for (const a of this.state.attractors) {
      const center = this._thetaToIndex(a.orbitTheta ?? a.theta)
      const radius = Math.max(2, Math.floor(4 + a.stability * 18))
      for (let di = -radius; di <= radius; di++) {
        const idx  = this._wrapI(center + di)
        const prox = this._clamp01(1 - Math.abs(di) / (radius + 1))
        const cell = this.rings[a.r][idx]
        const pull = this.attractorRate * a.stability * prox * (1 - cell.pressure)
        cell.p             = this._clampP(cell.p + pull)
        cell.memory        = this._clamp01(cell.memory + pull * 0.1)
        cell.semanticTrace = this._clamp01(cell.semanticTrace + pull * 0.04)
      }
    }
  }

  _updateSemanticField(perturb, feedback) {
    const last  = this.field.semanticMemory.at(-1)
    const simil = last ? this._cosine(perturb.vector, last.vector) : 0
    const novel = this._clamp01(1 - simil)
    const grounding = this._clamp01(
      perturb.semantic.lexical * 0.30 + perturb.semantic.length * 0.15 +
      perturb.semantic.code * 0.20 + perturb.semantic.data * 0.20 + perturb.semantic.command * 0.15
    )
    const intent = this._clamp01(
      perturb.semantic.command * 0.30 + perturb.semantic.error * 0.25 +
      perturb.semantic.question * 0.20 + perturb.semantic.code * 0.25
    )
    this.field.semanticGrounding  = this._round4(this.field.semanticGrounding  * 0.86 + grounding * 0.14)
    this.field.semanticCoherence  = this._round4(this.field.semanticCoherence  * 0.82 + simil     * 0.18)
    this.field.intentPressure     = this._round4(this.field.intentPressure     * 0.78 + intent    * 0.22)
    this.field.noveltyPressure    = this._round4(this.field.noveltyPressure    * 0.80 + novel     * 0.20)
    this.field.executionReadiness = this._round4(this._clamp01(
      perturb.semantic.command * 0.40 + perturb.semantic.code * 0.30 + this.field.coherence * 0.30
    ))
    this.field.recallPotential = this._round4(this._clamp01(
      simil * 0.40 + this.field.persistence * 0.30 + this.field.continuity * 0.30
    ))
    const creds = this.state.attractors.map(a => a.emergentCredibility ?? 1)
    this.field.avgCredibility = creds.length
      ? this._round4(creds.reduce((s, v) => s + v, 0) / creds.length) : 1.0
    this.field.semanticMemory.push({
      t: this.state.t, theta: this._round4(this.state.lastTheta),
      vector: perturb.vector.slice(), grounding,
      coherence: this.field.semanticCoherence, novelty: this.field.noveltyPressure,
      phase: this.state.phase, predictionError: feedback.magnitude
    })
    if (this.field.semanticMemory.length > this.semanticMemoryLimit)
      this.field.semanticMemory.shift()
  }

  _predict() {
    const D = this.semanticDimensions, A = this.maxAttractors
    const a = new Float32Array(A)
    for (let j = 0; j < Math.min(this.state.attractors.length, A); j++)
      a[j] = this.state.attractors[j].strength ?? 0
    let aNorm = 0
    for (let j = 0; j < A; j++) aNorm += a[j] * a[j]
    aNorm = Math.sqrt(aNorm) || 1
    for (let j = 0; j < A; j++) a[j] /= aNorm
    const pred = new Float32Array(D)
    for (let d = 0; d < D; d++) {
      let sum = 0
      for (let j = 0; j < A; j++) sum += this.W[d * A + j] * a[j]
      pred[d] = sum
    }
    let pNorm = 0
    for (let i = 0; i < D; i++) pNorm += pred[i] * pred[i]
    pNorm = Math.sqrt(pNorm) || 1
    for (let i = 0; i < D; i++) pred[i] = Math.fround(pred[i] / pNorm)
    this._lastPrediction.set(pred)
    this._lastAttractorState.set(a)
    this._hasPrediction = true
  }

  _storeCapsule(input, perturb, feedback) {
    const text = String(input ?? '')
    if (text.length < 10) return
    let cs = 2166136261
    for (let i = 0; i < text.length; i++) { cs ^= text.charCodeAt(i); cs = Math.imul(cs, 16777619) }
    const checksum = Math.abs(cs >>> 0).toString(16)
    for (const [, cap] of this.vault) {
      if (cap.checksum === checksum) {
        cap.reinforcement = (cap.reinforcement ?? 0) + 0.1
        cap.version = (cap.version ?? 1) + 1
        return
      }
    }
    const id = `cap_${this.state.t}_${checksum.slice(0, 6)}`
    this.vault.set(id, {
      id, text: text.slice(0, 200), checksum, vector: perturb.vector.slice(),
      phase: this.state.phase, t: this.state.t, error: feedback.magnitude,
      theta: this._round4(this.field.signature * 1.618033988749895 % this.cycle),
      reinforcement: 0, version: 1
    })
    if (this.vault.size > 256) {
      const sorted = [...this.vault.entries()].sort(([,a],[,b]) => a.reinforcement - b.reinforcement)
      for (const [id] of sorted.slice(0, this.vault.size - 256)) this.vault.delete(id)
    }
  }

  _updatePhase() {
    const m = this._metrics()
    let phase = 'stable'
    if (this.state.t < 8)                                                            phase = 'warmup'
    else if (m.entropy > 0.72 && m.aliveRatio < 0.30)                               phase = 'noise'
    else if (m.pressure > 0.70 && m.entropy > 0.65)                                 phase = 'turbulent'
    else if (m.aliveRatio < 0.25)                                                    phase = 'compressed'
    else if (m.attractorStr > 0.72 && m.drift < 0.20 && this.field.semanticCoherence > 0.45) phase = 'locked'
    else if (m.drift > 0.55 || this.field.noveltyPressure > 0.72)                   phase = 'drift'
    else if (m.residual > 0.55 && m.attractorStr > 0.50)                            phase = 'emergent'
    else if (m.pressure > 0.45 || this.field.intentPressure > 0.60)                 phase = 'metastable'
    this.state.phase = phase
  }

  _updateFieldIdentity() {
    const m = this._metrics(), phi = 1.618033988749895
    this.field.signature = this._containTheta(
      this.field.signature * phi + this.state.signature +
      m.entropy * this.cycle * 0.20 + m.attractorStr * this.cycle * 0.14
    )
    this.field.coherence   = this._round4(this._clamp01((1 - m.drift) * 0.35 + m.attractorStr * 0.30 + (1 - m.pressure) * 0.20 + this.field.semanticCoherence * 0.15))
    this.field.continuity  = this._round4(this._clamp01(m.residual * 0.35 + m.attractorStr * 0.25 + (1 - m.drift) * 0.20 + this.field.semanticGrounding * 0.20))
    this.field.drift       = this._round4(m.drift)
    this.field.momentum    = this._round4(this._clamp01(Math.abs(this.state.lastDeltaTheta) / (this.cycle * 0.5)))
    this.field.resonance   = this._round4(this._clamp01(m.entropy * 0.25 + m.attractorStr * 0.30 + m.residual * 0.20 + this.field.semanticCoherence * 0.25))
    this.field.topicPressure = this._round4(m.pressure)
    this.field.persistence = this._round4(this._clamp01(this.field.persistence * 0.92 + this.field.continuity * 0.08))
    this.field.emergence   = this._round4(this._clamp01(m.residual * 0.25 + m.entropy * 0.20 + m.attractorStr * 0.30 + this.field.noveltyPressure * 0.25))
  }

  _updateLocalization() {
    let maxP = 0, sumP = 0
    for (const ring of this.rings) for (const c of ring) { sumP += c.p; if (c.p > maxP) maxP = c.p }
    this.field.localization = this._round4(sumP > 0 ? maxP / sumP : 0)
    this.field.signalType   = this.field.localization > 0.012 ? 'signal' : 'noise'
  }

  _snapshot(perturb, feedback) {
    const m = this._metrics()
    return {
      version: 'CELF-V5',
      t: this.state.t,
      phase: this.state.phase,
      field: {
        signature: this._round4(this.field.signature),
        coherence: this.field.coherence, continuity: this.field.continuity,
        drift: this.field.drift, momentum: this.field.momentum,
        resonance: this.field.resonance, persistence: this.field.persistence,
        emergence: this.field.emergence, topicPressure: this.field.topicPressure,
        semanticGrounding: this.field.semanticGrounding,
        semanticCoherence: this.field.semanticCoherence,
        intentPressure: this.field.intentPressure,
        executionReadiness: this.field.executionReadiness,
        recallPotential: this.field.recallPotential,
        noveltyPressure: this.field.noveltyPressure,
        localization: this.field.localization,
        signalType: this.field.signalType,
        avgCredibility: this.field.avgCredibility ?? 1.0,
        predictionError: this.field.predictionError,
        lastSourceWeight: this.field.lastSourceWeight ?? 1.0
      },
      perturbation: {
        length: perturb.words, numeric: 0, rupture: 0, spread: perturb.words,
        sourceWeight: 1.0,
        semantic: {
          words: perturb.words, unique: 0,
          lexicalDensity: perturb.semantic.lexical,
          code: perturb.semantic.code, question: perturb.semantic.question,
          error: perturb.semantic.error, command: perturb.semantic.command,
          reasoning: perturb.semantic.reasoning ?? 0,
          emotional: perturb.semantic.emotional ?? 0,
          data: perturb.semantic.data,
          intent: perturb.semantic.intent
        }
      },
      metrics: m,
      attractors: this.state.attractors.slice(0, 6).map(a => ({
        r: a.r, i: a.i,
        theta: this._round4(a.theta), orbitTheta: this._round4(a.orbitTheta ?? a.theta),
        strength: this._round4(a.strength), stability: this._round4(a.stability),
        constraintDensity: this._round4(a.constraintDensity ?? 0),
        semanticWeight: this._round4(a.semanticWeight ?? 0),
        intentWeight: this._round4(a.intentWeight ?? 0),
        credibility: this._round4(a.credibility ?? 1.0),
        emergentCredibility: this._round4(a.emergentCredibility ?? 1.0)
      })),
      control: {
        mode: this.state.phase === 'drift' ? 'clarify' : 'balance',
        executionReadiness: this.field.executionReadiness,
        recallPotential: this.field.recallPotential,
        semanticGrounding: this.field.semanticGrounding,
        signalType: this.field.signalType
      },
      signal: {
        localization: this.field.localization,
        signalType: this.field.signalType,
        sourceWeight: this.field.lastSourceWeight ?? 1.0
      }
    }
  }

  _commit(snap) {
    this.state.history.push({
      t: snap.t, phase: snap.phase,
      drift: snap.field.drift, coherence: snap.field.coherence,
      error: this.field.predictionError
    })
    if (this.state.history.length > this.historyLimit) this.state.history.shift()
    this.state.t++
  }

  _metrics() {
    if (this._metricsCache !== null && this._metricsCacheTime === this.state.t)
      return this._metricsCache

    const ps = [], prs = [], res = [], sem = []
    for (const ring of this.rings)
      for (const c of ring) {
        ps.push(c.p); prs.push(c.pressure)
        res.push(c.residual ?? c.memory); sem.push(c.semanticTrace)
      }

    const mean    = ps.reduce((s, v) => s + v, 0) / ps.length
    const entropy = this._entropy(ps)
    const prev    = this.state.history.at(-1)
    const drift   = prev
      ? this._clamp01(Math.abs((prev.coherence ?? 0) - this.field.coherence) + Math.abs(prev.drift ?? 0))
      : 0

    const result = {
      mean:        this._round4(mean),
      entropy:     this._round4(entropy),
      pressure:    this._round4(prs.reduce((s, v) => s + v, 0) / prs.length),
      residual:    this._round4(res.reduce((s, v) => s + v, 0) / res.length),
      residualMass:this._round4(res.reduce((s, v) => s + v, 0) / res.length),
      aliveRatio:  this._round4(ps.filter(v => v > this.activationThreshold).length / ps.length),
      attractorStr:       this._round4(this.state.attractors.length
        ? this.state.attractors.reduce((s, a) => s + (a.stability ?? 0), 0) / this.state.attractors.length : 0),
      attractorStrength:  this._round4(this.state.attractors.length
        ? this.state.attractors.reduce((s, a) => s + (a.stability ?? 0), 0) / this.state.attractors.length : 0),
      drift:       this._round4(drift),
      semanticMass:this._round4(sem.reduce((s, v) => s + v, 0) / sem.length),
      fieldCurvature: this._round4(sem.reduce((s, v) => s + v, 0) / sem.length),
      totalMass:   this._round4(this._totalMass())
    }

    this._metricsCache     = result
    this._metricsCacheTime = this.state.t
    return result
  }

  _entropy(values) {
    const sum = values.reduce((s, v) => s + v, 0)
    if (sum <= 0) return 0
    let h = 0
    for (const v of values) { const p = v / sum; if (p > 0) h -= p * Math.log(p) }
    return this._clamp01(h / Math.log(values.length))
  }

  _cosine(a, b) {
    const n = Math.min(a.length, b.length)
    if (!n) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
    return (na > 0 && nb > 0) ? this._clamp01(dot / (Math.sqrt(na) * Math.sqrt(nb))) : 0
  }

  _totalMass() {
    let s = 0
    for (const ring of this.rings) for (const c of ring) s += c.p
    return s
  }

  _containTheta(v)         { return ((Number(v) % this.cycle) + this.cycle) % this.cycle }
  _thetaToIndex(theta)     { return Math.floor((this._containTheta(theta) / this.cycle) * this.resolution) % this.resolution }
  _indexToTheta(d)         { return (d / this.resolution) * this.cycle }
  _wrapI(i)                { return ((i % this.resolution) + this.resolution) % this.resolution }
  _wrapR(r)                { return ((r % this.ringCount)  + this.ringCount)  % this.ringCount  }
  _circularIndexDist(a, b) { const d = Math.abs(a - b); return Math.min(d, this.resolution - d) }
  _signedIndexDist(a, b)   { const f = (b - a + this.resolution) % this.resolution; return f > this.resolution / 2 ? f - this.resolution : f }
  _clamp01(v)              { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0 }
  _clampP(v)               { const n = Number(v); return Number.isFinite(n) ? Math.max(this.epsilon, n) : this.epsilon }
  _round4(v)               { return Math.round(Number(v || 0) * 10000) / 10000 }
}
