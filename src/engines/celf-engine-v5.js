export class CELF_Engine_AI_V5 {
  constructor(options = {}) {
    this.cycle                = options.cycle                ?? 360
    this.resolution           = options.resolution           ?? 360
    this.ringCount            = options.ringCount            ?? 5
    this.epsilon              = options.epsilon              ?? 1e-6
    this.activationThreshold  = options.activationThreshold  ?? this.epsilon * 100
    this.diffusionRate        = options.diffusionRate        ?? 0.08
    this.constraintRate       = options.constraintRate       ?? 0.12
    this.recoveryRate         = options.recoveryRate         ?? 0.035
    this.attractorRate        = options.attractorRate        ?? 0.06
    this.attractorLimit       = options.attractorLimit       ?? 12
    this.historyLimit         = options.historyLimit         ?? 512
    this.archiveLimit         = options.archiveLimit         ?? 512
    this.semanticMemoryLimit  = options.semanticMemoryLimit  ?? 256
    this.semanticDimensions   = options.semanticDimensions   ?? 64
    this.routingLimit         = options.routingLimit         ?? 8
    this.massTarget           = options.massTarget           ?? null
    this.localizationThreshold   = options.localizationThreshold   ?? 0.012
    this.decayRate               = options.decayRate               ?? 0.25
    this.contradictionThreshold  = options.contradictionThreshold  ?? 0.22
    this.credibilityLearningRate = options.credibilityLearningRate ?? 0.08
    this.manifoldDimensions      = options.manifoldDimensions      ?? 32
    this.metaAttractorThreshold  = options.metaAttractorThreshold  ?? 0.65

    // ─── Vault Topology ───────────────────────────────────────────
    this.hexVault          = new Map()   // capsuleId → capsule
    this.vaultLimit        = options.vaultLimit        ?? 512
    this.vaultStoreThresh  = options.vaultStoreThresh  ?? 0.42
    this.vaultActivThresh  = options.vaultActivThresh  ?? 0.62
    this.vaultRetrThresh   = options.vaultRetrThresh   ?? 0.35

    this.field = {
      signature: 0, continuity: 0, coherence: 0,
      drift: 0, momentum: 0, resonance: 0,
      phaseHistory: [], attractorTrace: [],
      topicPressure: 0, lastStablePhase: 'warmup',
      persistence: 0, emergence: 0,
      semanticGrounding: 0, semanticCoherence: 0,
      intentPressure: 0, executionReadiness: 0,
      recallPotential: 0, routingPressure: 0,
      compressionPressure: 0, noveltyPressure: 0,
      semanticMemory: [], archivedContinuity: [],
      localization: 0, coherenceRadius: 0,
      signalType: 'noise', lastSourceWeight: 1.0,
      manifold:    new Float32Array(this.manifoldDimensions * this.manifoldDimensions),
      manifoldAge: new Float32Array(this.manifoldDimensions * this.manifoldDimensions),
      metaAttractors: [],
      avgFieldCredibility: 1.0
    }

    this.rings = Array.from({ length: this.ringCount }, (_, r) =>
      Array.from({ length: this.resolution }, (_, i) => ({
        r, i,
        theta: (i / this.resolution) * this.cycle,
        p: 1 / this.resolution,
        residual: this.epsilon,
        pressure: 0, memory: 0,
        hysteresis: 0, elasticStrain: 0,
        constraintDensity: 0, semanticTrace: 0,
        intentTrace: 0, active: true, credibility: 1.0
      }))
    )

    this.state = {
      t: 0, phase: 'warmup', signature: 0,
      cycleCount: 0, lastTheta: 0, lastIndex: 0,
      lastDeltaTheta: 0, totalMass: this.totalMass(),
      attractors: [], history: [], archive: [],
      lastSourceWeight: 1.0,
      lastPerturbationVector: new Float32Array(this.semanticDimensions),
      attractorCredibilityLog: []
    }

    this.massTarget = this.massTarget ?? this.state.totalMass
  }

  // ═══════════════════════════════════════════════════════════════
  //  VAULT TOPOLOGY — قانون التغليف والاسترجاع
  // ═══════════════════════════════════════════════════════════════

  generatePhiOrbit() {
    const phi = 1.618033988749895
    return this.containTheta(
      this.field.signature * phi +
      this.state.lastTheta * 0.5
    )
  }

  #compressSource(text) {
    // ضغط دلالي: إزالة الحشو، الحفاظ على الجوهر
    const words = String(text).split(/\s+/).filter(Boolean)
    const stopwords = new Set(['the','a','an','is','are','was','were','be','been','being',
      'have','has','had','do','does','did','will','would','could','should','may',
      'might','shall','of','in','on','at','to','for','by','from','with','and','or'])
    const meaningful = words.filter((w, i) => i < 3 || !stopwords.has(w.toLowerCase()))
    return meaningful.slice(0, 40).join(' ')
  }

  #checksum(text) {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h  = Math.imul(h, 16777619)
    }
    return Math.abs(h >>> 0).toString(16)
  }

  shouldStoreCapsule(text, perturbation) {
    if (!text || text.length < 20) return false

    const s = perturbation.semantic
    const fieldWeight = this.clamp01(
      s.code      * 0.25 +
      s.data      * 0.20 +
      s.reasoning * 0.20 +
      s.command   * 0.15 +
      s.question  * 0.10 +
      s.error     * 0.10
    )

    const semanticWeight = this.clamp01(
      s.lexicalDensity * 0.35 +
      s.lengthScore    * 0.15 +
      (this.field.semanticGrounding ?? 0) * 0.30 +
      (this.field.coherence         ?? 0) * 0.20
    )

    const importance = semanticWeight * 0.55 + fieldWeight * 0.45
    return importance > this.vaultStoreThresh
  }

  storeOrUpdateCapsule(text, perturbation) {
    const checksum = this.#checksum(text)

    // هل موجودة بالفعل؟
    for (const [id, cap] of this.hexVault) {
      if (cap.source.checksum === checksum) {
        // تحديث بدون تغيير المحتوى أو phiOrbit
        cap.reinforcement   = (cap.reinforcement ?? 0) + 0.08
        cap.version         = (cap.version ?? 1) + 1
        cap.lastResonance   = this.field.resonance
        cap.previousHash    = cap.currentHash
        cap.currentHash     = checksum
        return id
      }
    }

    // كبسولة جديدة
    const id = `cap_${this.state.t}_${Math.abs(Math.imul(perturbation.h1, 1234567)) % 99999}`
    const phiOrbit = this.generatePhiOrbit()   // ثابت للأبد

    const capsule = {
      id,
      source: {
        compressed: this.#compressSource(text),
        checksum,
        sealed:     true,    // قفل 1
        persistent: true     // قفل 2
      },
      suspended:   true,     // نائمة دائماً
      attached:    false,
      fieldLocked: true,     // قفل 3 — الحقل لا يكتب عليها
      phiOrbit,              // ثابت للأبد
      createdAt:   this.state.t,
      version:     1,
      reinforcement: 0,
      lastResonance: this.field.resonance,
      currentHash:   checksum,
      previousHash:  null,
      semanticVector: perturbation.semantic.vector.slice(),
      phase:          this.state.phase,
      coherence:      this.field.coherence,
      grounding:      this.field.semanticGrounding,
      needScore:      this.field.intentPressure
    }

    this.hexVault.set(id, capsule)
    this.cleanupCapsules()
    return id
  }

  shouldActivateCapsule(capsule) {
    const phi   = 1.618033988749895
    const t     = this.state.t
    const orbit = capsule.phiOrbit

    // التوافق مع الحقل الحالي
    const orbitDist  = Math.abs(((orbit - this.field.signature + this.cycle) % this.cycle))
    const orbitAlign = this.clamp01(1 - Math.min(orbitDist, this.cycle - orbitDist) / (this.cycle * 0.5))

    // التوافق الذهبي
    const phiAlignment = this.clamp01(
      Math.abs(Math.sin((orbit * phi) % Math.PI))
    )

    // مدى الحاجة
    const need = this.clamp01(this.field.intentPressure * 0.5 + this.field.recallPotential * 0.5)

    // التماسك
    const coherence = capsule.coherence ?? 0

    // التعزيز
    const reinforcement = this.clamp01((capsule.reinforcement ?? 0) / 10)

    // التشابه الدلالي مع آخر input
    const lastMem = this.field.semanticMemory.at(-1)
    const semantic = lastMem
      ? this.cosineSimilarity(capsule.semanticVector, lastMem.vector ?? new Float32Array(0))
      : 0

    const R = this.clamp01(
      semantic       * 0.38 +
      orbitAlign     * 0.18 +
      phiAlignment   * 0.18 +
      reinforcement  * 0.10 +
      need           * 0.10 +
      coherence      * 0.06
    )

    return R > this.vaultActivThresh
  }

  retrieveCapsule(query, queryVector) {
    let best = null, bestScore = -1

    for (const [id, cap] of this.hexVault) {
      if (!cap.source?.sealed) continue

      const similarity     = this.cosineSimilarity(queryVector, cap.semanticVector)
      const reinforcement  = this.clamp01((cap.reinforcement ?? 0) / 10)
      const phiAlignment   = this.clamp01(
        Math.abs(Math.sin((cap.phiOrbit * 1.618033988749895) % Math.PI))
      )
      const orbitDist      = Math.abs(((cap.phiOrbit - this.field.signature + this.cycle) % this.cycle))
      const orbitScore     = this.clamp01(1 - Math.min(orbitDist, this.cycle - orbitDist) / (this.cycle * 0.5))
      const integrity      = (cap.source.sealed && cap.source.persistent) ? 1.0 : 0.0

      const score = this.clamp01(
        similarity    * 0.40 +
        orbitScore    * 0.20 +
        phiAlignment  * 0.15 +
        reinforcement * 0.15 +
        integrity     * 0.10
      )

      if (score > bestScore && score >= this.vaultRetrThresh) {
        bestScore = score
        best = { capsule: cap, score }
      }
    }

    return best
  }

  getActiveCapsules() {
    const active = []
    for (const [id, cap] of this.hexVault) {
      if (this.shouldActivateCapsule(cap)) {
        // تصحى لحظياً ثم تعود للنوم
        cap.attached = true
        active.push({ ...cap, _activationScore: true })
        cap.attached = false
      }
    }
    return active
  }

  cleanupCapsules() {
    if (this.hexVault.size <= this.vaultLimit) return

    // احذف الأقل تعزيزاً
    const sorted = [...this.hexVault.entries()]
      .sort(([, a], [, b]) => (a.reinforcement ?? 0) - (b.reinforcement ?? 0))

    const toDelete = sorted.slice(0, this.hexVault.size - this.vaultLimit)
    for (const [id] of toDelete) this.hexVault.delete(id)
  }

  // ═══════════════════════════════════════════════════════════════
  //  CORE ENGINE PROCESS
  // ═══════════════════════════════════════════════════════════════

  process(input, options = {}) {
    this._metricsCache     = null
    this._metricsCacheTime = -1

    if (typeof options === 'number') options = { sourceWeight: options }
    const sourceWeight = this.clamp01(options.sourceWeight ?? 1.0)
    this.state.lastSourceWeight = sourceWeight
    this.field.lastSourceWeight = sourceWeight

    const perturbation = this.perturb(input)
    perturbation.sourceWeight = sourceWeight

    const delta     = this.deltaP(perturbation)
    const contained = this.containDelta(delta)

    this.applyDelta(contained, perturbation)
    this.diffuse()
    this.applyAttractors()
    this.conserveMass()
    this.updateAttractors(perturbation)
    this.updateResiduals()
    this.updateConstraintDensity()
    this.updateActivity()
    this.updatePhase()
    this.updateFieldIdentity()
    this.updateSemanticField(perturbation)
    this.updateSignalMetrics()
    this.updateManifold(perturbation)
    this.updateEmergentCredibility(perturbation)
    this.updateRecursiveCognition()

    // ── Vault: تخزين إذا مهم ──────────────────────────────────────
    const signal = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    if (this.shouldStoreCapsule(signal, perturbation)) {
      this.storeOrUpdateCapsule(signal, perturbation)
    }

    this.state.lastPerturbationVector = perturbation.semantic.vector.slice()

    const snapshot = this.snapshot(perturbation, delta, contained)
    this.commit(snapshot)

    return snapshot
  }

  perturb(input) {
    const signal =
      typeof input === 'string'
        ? input
        : JSON.stringify(input ?? '')

    let h1 = 2166136261
    let h2 = 16777619
    let h3 = 374761393

    for (let i = 0; i < signal.length; i++) {
      const c = signal.charCodeAt(i)
      h1 ^= c
      h1  = Math.imul(h1, 16777619)
      h2  = Math.imul(h2 ^ c, 2246822519)
      h3  = Math.imul(h3 + c, 3266489917)
    }

    const length   = signal.length
    const numeric  = (signal.match(/-?\d+(\.\d+)?/g) ?? []).length
    const rupture  = (signal.match(/[!?@#]{2,}|ERROR|timeout|retry|fail|panic|فشل|خطأ/gi) ?? []).length
    const spread   = new Set(signal.split(/\s+/).filter(Boolean)).size
    const semantic = this.extractSemantic(input, signal, h1, h2, h3)

    return {
      signal, length, numeric, rupture, spread, semantic,
      h1: Math.abs(h1 >>> 0),
      h2: Math.abs(h2 >>> 0),
      h3: Math.abs(h3 >>> 0),
      timestamp: Date.now(),
      sourceWeight: 1.0
    }
  }

  extractSemantic(input, signal, h1 = 0, h2 = 0, h3 = 0) {
    const text   = String(signal ?? '')
    const words  = text.toLowerCase().split(/\s+/).filter(Boolean)
    const unique = new Set(words)
    const code      = /```|function|class|const|let|var|=>|import|export|return|{|}/i.test(text) ? 1 : 0
    const question  = /[?؟]|كيف|ماذا|لماذا|هل|where|what|why|how/i.test(text) ? 1 : 0
    const error     = /error|fail|timeout|panic|exception|خطأ|فشل/i.test(text) ? 1 : 0
    const command   = /اكتب|عدل|انزل|اصنع|احذف|أضف|build|create|fix|write|generate/i.test(text) ? 1 : 0
    const reasoning = /نظرية|فلسفة|معنى|concept|theory|reason|logic|architecture/i.test(text) ? 1 : 0
    const emotional = /ألم|خوف|قلق|ممتاز|جميل|سيء|good|bad|worry|fear/i.test(text) ? 1 : 0
    const data      = /json|api|server|tokens|logs|database|vector|embedding|metric|cpu|latency/i.test(text) ? 1 : 0
    const lengthScore    = this.clamp01(text.length / 2000)
    const lexicalDensity = this.clamp01(unique.size / Math.max(words.length, 1))
    const vector         = this.semanticVector(text, h1, h2, h3)

    return {
      vector,
      words: words.length,
      unique: unique.size,
      lexicalDensity: this.round4(lexicalDensity),
      lengthScore:    this.round4(lengthScore),
      code, question, error, command, reasoning, emotional, data,
      intent: { ask: question, execute: command, diagnose: error, reason: reasoning, code, data }
    }
  }

  semanticVector(text, h1 = 0, h2 = 0, h3 = 0) {
    const D      = this.semanticDimensions
    const vector = new Float32Array(D)
    const s      = String(text ?? '').toLowerCase()
    const tokens = s.split(/\s+/).filter(Boolean)

    if (tokens.length === 0) {
      for (let i = 0; i < Math.min(s.length, 64); i++) {
        const c = s.charCodeAt(i)
        const a = (Math.abs(Math.imul(c ^ h1 ^ i, 16777619)) >>> 0) % D
        vector[a] += 1 / (i + 1)
      }
    } else {
      for (let ti = 0; ti < tokens.length; ti++) {
        const token = tokens[ti]
        let tw = 2166136261
        for (let ci = 0; ci < token.length; ci++) {
          tw ^= token.charCodeAt(ci)
          tw  = Math.imul(tw, 16777619)
        }
        tw = Math.abs(tw >>> 0)

        const posHash = (Math.imul(ti + 1, 2654435761) >>> 0)
        const a = (Math.abs(Math.imul(tw ^ h1 ^ posHash, 16777619))  >>> 0) % D
        const b = (Math.abs(Math.imul(tw ^ h2,           2246822519)) >>> 0) % D
        const c = (Math.abs(Math.imul(tw ^ h3,           3266489917)) >>> 0) % D
        const weight = 1.0 / Math.sqrt(ti + 1)
        vector[a] += weight
        vector[b] += weight * 0.6
        vector[c] += weight * 0.4

        if (ti + 1 < tokens.length) {
          let bw = 2166136261
          const bigram = token + ' ' + tokens[ti + 1]
          for (let ci2 = 0; ci2 < bigram.length; ci2++) {
            bw ^= bigram.charCodeAt(ci2)
            bw  = Math.imul(bw, 16777619)
          }
          bw = Math.abs(bw >>> 0)
          const ba = (Math.abs(Math.imul(bw ^ h1, 16777619)) >>> 0) % D
          vector[ba] += weight * 0.3
        }
      }
    }

    let norm = 0
    for (let i = 0; i < D; i++) norm += vector[i] * vector[i]
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < D; i++) vector[i] = Math.fround(vector[i] / norm)
    return vector
  }

  deltaP(p) {
    const volume   = this.clamp01(p.length / 800)
    const rupture  = this.clamp01(p.rupture / 12)
    const numeric  = this.clamp01(p.numeric / 12)
    const variety  = this.clamp01(p.spread / 64)
    const semanticWeight = this.clamp01(
      p.semantic.code      * 0.18 +
      p.semantic.question  * 0.10 +
      p.semantic.error     * 0.18 +
      p.semantic.command   * 0.14 +
      p.semantic.reasoning * 0.15 +
      p.semantic.data      * 0.12 +
      p.semantic.lexicalDensity * 0.13
    )

    const theta         = ((p.h1 % this.resolution) / this.resolution) * this.cycle
    const phaseShift    = (((p.h2 % 2000) / 1000) - 1) * this.cycle * 0.25
    const semanticShift = (((p.h3 % 2000) / 1000) - 1) * this.cycle * 0.12

    const intensity = this.clamp01(
      volume * 0.20 + rupture * 0.30 + numeric * 0.12 +
      variety * 0.20 + semanticWeight * 0.18
    )

    const vector = Array.from({ length: this.ringCount }, (_, r) => {
      const k = (r + 1) / this.ringCount
      return this.clamp01(intensity * (
        0.32 + volume * 0.13 * k + rupture * 0.22 * (1 - k) +
        numeric * 0.08 + variety * 0.12 + semanticWeight * 0.18
      ))
    })

    const targetTheta      = this.containTheta(
      theta + phaseShift + semanticShift +
      this.state.signature * 0.15 + this.field.signature * 0.05
    )
    const targetIndex      = this.thetaToIndex(targetTheta)
    const signedIndexDelta = this.signedIndexDistance(this.state.lastIndex, targetIndex)
    const deltaTheta       = this.indexToTheta(signedIndexDelta)

    return {
      theta: targetTheta, index: targetIndex,
      deltaTheta, signedIndexDelta, intensity, vector,
      volume, rupture, numeric, variety, semanticWeight
    }
  }

  containDelta(delta) {
    const phi = 1.618033988749895
    const nextSignature = this.containTheta(
      this.state.signature * phi + delta.theta +
      delta.deltaTheta * 0.5 + delta.intensity * this.cycle * 0.22 +
      delta.semanticWeight * this.cycle * 0.08
    )

    const wrapped = Math.abs(delta.signedIndexDelta) > this.resolution / 2
    if (wrapped) this.state.cycleCount++

    this.state.signature      = nextSignature
    this.state.lastTheta      = delta.theta
    this.state.lastIndex      = delta.index
    this.state.lastDeltaTheta = delta.deltaTheta

    return { ...delta, signature: nextSignature, cycleCount: this.state.cycleCount }
  }

  applyDelta(delta, perturbation = null) {
    const radius         = Math.max(2, Math.floor(3 + delta.intensity * 32))
    const semanticWeight = delta.semanticWeight ?? 0
    const sourceWeight   = perturbation?.sourceWeight ?? 1.0

    const intentWeight = perturbation?.semantic
      ? this.clamp01(
          perturbation.semantic.intent.execute  * 0.35 +
          perturbation.semantic.intent.diagnose * 0.25 +
          perturbation.semantic.intent.reason   * 0.20 +
          perturbation.semantic.intent.code     * 0.20
        )
      : 0

    for (let r = 0; r < this.ringCount; r++) {
      const ringDelta = delta.vector[r] ?? 0
      for (let i = 0; i < this.resolution; i++) {
        const cell      = this.rings[r][i]
        const d         = this.circularIndexDistance(i, delta.index)
        const proximity = this.clamp01(1 - d / radius)
        const density   = cell.constraintDensity ?? 0

        const pressure = this.clamp01(
          ringDelta * 0.40 + delta.rupture * 0.22 + delta.variety * 0.12 +
          semanticWeight * 0.14 + intentWeight * 0.07 + (1 - proximity) * 0.05
        )

        const expansion =
          proximity * ringDelta * this.recoveryRate *
          (1 - pressure) * (1 - density) *
          (1 + semanticWeight * 0.20) * sourceWeight

        const narrowing =
          pressure * this.constraintRate * (1 - proximity * 0.5) * (1 + density)

        cell.pressure = pressure
        cell.p = this.clampP(cell.p + expansion - narrowing)

        cell.memory = this.clamp01(
          cell.memory * 0.985 +
          proximity * ringDelta * 0.013 * sourceWeight +
          proximity * semanticWeight * 0.004
        )

        cell.hysteresis = this.clamp01(
          (cell.hysteresis ?? 0) * 0.995 +
          proximity * ringDelta * sourceWeight * 0.005
        )

        const baseline     = 1 / this.resolution
        cell.elasticStrain = this.clamp01(
          Math.abs(cell.p - baseline) * (cell.hysteresis ?? 0) * 0.3
        )

        const pathBias = (cell.hysteresis ?? 0) * 0.15 * sourceWeight
        cell.p = this.clampP(
          cell.p + expansion * pathBias -
          cell.elasticStrain * this.recoveryRate * 0.5
        )

        cell.semanticTrace = this.clamp01(
          (cell.semanticTrace ?? 0) * 0.992 +
          proximity * semanticWeight * 0.008 * sourceWeight
        )

        cell.intentTrace = this.clamp01(
          (cell.intentTrace ?? 0) * 0.990 +
          proximity * intentWeight * 0.010 * sourceWeight
        )

        cell.credibility = this.clamp01(
          (cell.credibility ?? 1.0) * 0.99 + proximity * sourceWeight * 0.01
        )
      }
    }
  }

  diffuse() {
    const next         = this.rings.map(ring => ring.map(c => c.p))
    const semanticNext = this.rings.map(ring => ring.map(c => c.semanticTrace ?? 0))

    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        const left    = this.rings[r][this.wrapIndex(i - 1)].p
        const mid     = this.rings[r][i].p
        const right   = this.rings[r][this.wrapIndex(i + 1)].p
        const ringUp  = this.rings[this.wrapRing(r - 1)][i].p
        const ringDown= this.rings[this.wrapRing(r + 1)][i].p

        const localDiff =
          (left + right - 2 * mid)      * 0.70 +
          (ringUp + ringDown - 2 * mid) * 0.30

        const resistance           = 1 - (this.rings[r][i].constraintDensity ?? 0)
        const semanticResistance   = 1 - (this.rings[r][i].semanticTrace     ?? 0) * 0.25
        const hysteresisResistance = 1 - (this.rings[r][i].hysteresis        ?? 0) * 0.30

        next[r][i] = this.clampP(
          mid + this.diffusionRate * resistance * semanticResistance * hysteresisResistance * localDiff
        )

        const sLeft  = this.rings[r][this.wrapIndex(i - 1)].semanticTrace ?? 0
        const sMid   = this.rings[r][i].semanticTrace ?? 0
        const sRight = this.rings[r][this.wrapIndex(i + 1)].semanticTrace ?? 0
        const sUp    = this.rings[this.wrapRing(r - 1)][i].semanticTrace ?? 0
        const sDown  = this.rings[this.wrapRing(r + 1)][i].semanticTrace ?? 0

        const semanticDiff =
          (sLeft + sRight - 2 * sMid) * 0.65 +
          (sUp   + sDown  - 2 * sMid) * 0.35

        semanticNext[r][i] = this.clamp01(
          sMid + this.diffusionRate * 0.5 * resistance * semanticDiff
        )
      }
    }

    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++) {
        this.rings[r][i].p             = next[r][i]
        this.rings[r][i].semanticTrace = semanticNext[r][i]
      }
  }

  conserveMass() {
    const cells = []
    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++)
        cells.push(this.rings[r][i])

    const floorMass     = this.epsilon * cells.length
    const target        = Math.max(this.massTarget, floorMass + this.epsilon)
    const currentExcess = cells.reduce((s, c) => s + Math.max(0, c.p - this.epsilon), 0)
    const targetExcess  = Math.max(0, target - floorMass)

    if (currentExcess < this.epsilon) {
      const memorySum = cells.reduce(
        (s, c) => s + Math.max(this.epsilon, (c.memory ?? 0) + (c.semanticTrace ?? 0)), 0
      )
      for (const c of cells) {
        const weight = Math.max(this.epsilon, (c.memory ?? 0) + (c.semanticTrace ?? 0))
        c.p = this.epsilon + (targetExcess * weight / memorySum)
      }
      return
    }

    const factor = targetExcess / currentExcess
    for (const c of cells)
      c.p = this.epsilon + Math.max(0, c.p - this.epsilon) * factor
  }

  updateAttractors(perturbation = null) {
    const candidates = []

    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        const cell  = this.rings[r][i]
        const score = this.clamp01(
          cell.p                     * 0.40 +
          cell.memory                * 0.18 +
          cell.residual              * 0.15 +
          cell.constraintDensity     * 0.09 +
          (cell.semanticTrace ?? 0)  * 0.09 +
          (cell.hysteresis    ?? 0)  * 0.04 +
          (cell.intentTrace   ?? 0)  * 0.05
        )

        if (score > this.activationThreshold) {
          candidates.push({
            r, i,
            theta: cell.theta, mass: cell.p, memory: cell.memory,
            residual: cell.residual, pressure: cell.pressure,
            constraintDensity: cell.constraintDensity,
            semanticWeight:      cell.semanticTrace ?? 0,
            intentWeight:        cell.intentTrace   ?? 0,
            credibility:         cell.credibility   ?? 1.0,
            emergentCredibility: cell.credibility   ?? 1.0,
            strength: score,
            semanticVector: perturbation?.semantic?.vector?.slice() ?? new Float32Array(0),
            predictionScore: 0, predictionCount: 0
          })
        }
      }
    }

    candidates.sort((a, b) => b.strength - a.strength)

    const L            = this.field.localization
    const signalFactor = this.field.signalType === 'signal' ? 1.0 : 0.4 + L * 0.6
    const selected     = []

    for (const c of candidates) {
      const tooClose = selected.some(a =>
        a.r === c.r && this.circularIndexDistance(a.i, c.i) < 6
      )
      if (!tooClose) {
        c.strength *= signalFactor
        c.strength *= (c.emergentCredibility ?? 1.0)
        selected.push(c)
      }
      if (selected.length >= this.attractorLimit) break
    }

    if (perturbation?.semantic?.vector?.length) {
      const newVec = perturbation.semantic.vector
      for (const a of selected) {
        if (!a.semanticVector?.length) continue
        const similarity      = this.cosineSimilarity(newVec, a.semanticVector)
        const isContradiction =
          similarity < this.contradictionThreshold &&
          this.field.noveltyPressure > 0.60

        if (isContradiction) {
          a.strength  *= (1 - this.decayRate)
          a.stability  = a.stability ? a.stability * (1 - this.decayRate * 0.8) : 0
          a.emergentCredibility = this.clamp01(
            (a.emergentCredibility ?? 1.0) - this.credibilityLearningRate * 1.5
          )
        }
      }
    }

    this.state.attractors = this.interactAttractors(selected)
  }

  interactAttractors(attractors) {
    const result = attractors.map(a => ({ ...a, force: 0 }))

    for (let x = 0; x < result.length; x++) {
      for (let y = x + 1; y < result.length; y++) {
        const a = result[x]
        const b = result[y]
        const d               = Math.max(1, this.circularIndexDistance(a.i, b.i))
        const ringDistance    = Math.abs(a.r - b.r)
        const coupling        = 1 / (1 + ringDistance)
        const semanticCoupling = 1 + ((a.semanticWeight ?? 0) + (b.semanticWeight ?? 0)) * 0.35
        const force           = coupling * semanticCoupling * (a.strength * b.strength) / (d * d)

        if (a.r === b.r && d < 12) {
          a.force += force; b.force += force
        } else {
          a.force -= force * 0.35; b.force -= force * 0.35
        }
      }
    }

    return result.map(a => ({
      ...a,
      stability:  this.clamp01(a.strength + a.force),
      orbitTheta: this.containTheta(
        a.theta + this.state.lastDeltaTheta * this.attractorRate *
        (1 + (a.semanticWeight ?? 0) * 0.25)
      )
    }))
  }

  applyAttractors() {
    if (!this.state.attractors.length) return

    for (const a of this.state.attractors) {
      const center = this.thetaToIndex(a.orbitTheta ?? a.theta)
      const radius = Math.max(2, Math.floor(4 + a.stability * 18 + (a.semanticWeight ?? 0) * 4))

      for (let i = -radius; i <= radius; i++) {
        const idx       = this.wrapIndex(center + i)
        const d         = Math.abs(i)
        const proximity = this.clamp01(1 - d / (radius + 1))
        const cell      = this.rings[a.r][idx]

        const pull =
          this.attractorRate * a.stability * proximity *
          (1 - cell.pressure) *
          (1 + (cell.constraintDensity ?? 0)) *
          (1 + (a.semanticWeight ?? 0) * 0.25)

        cell.p             = this.clampP(cell.p + pull)
        cell.memory        = this.clamp01(cell.memory + pull * 0.1)
        cell.semanticTrace = this.clamp01((cell.semanticTrace ?? 0) + pull * 0.04)
      }
    }
  }

  updateResiduals() {
    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++) {
        const cell = this.rings[r][i]
        cell.residual = this.clampP(
          cell.residual * 0.992 + cell.p * 0.007 + (cell.semanticTrace ?? 0) * 0.001
        )
      }
  }

  updateConstraintDensity() {
    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++) {
        const cell = this.rings[r][i]
        cell.constraintDensity = this.clamp01(
          (cell.constraintDensity ?? 0) * 0.995 +
          cell.pressure * 0.0026 + cell.memory * 0.0017 +
          (cell.semanticTrace ?? 0) * 0.0007
        )
      }
  }

  updateActivity() {
    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++) {
        const cell = this.rings[r][i]
        cell.active =
          cell.p > this.activationThreshold ||
          (cell.semanticTrace ?? 0) > this.activationThreshold
      }
  }

  updatePhase() {
    const m = this.metrics()
    let phase = 'stable'

    if (this.state.t < 8)                                                                    phase = 'warmup'
    else if (this.field.signalType === 'noise' && m.entropy > 0.70)                          phase = 'noise'
    else if (m.pressure > 0.70 && m.entropy > 0.65)                                          phase = 'turbulent'
    else if (m.aliveRatio < 0.25)                                                             phase = 'compressed'
    else if (m.attractorStrength > 0.72 && m.drift < 0.20 && this.field.semanticCoherence > 0.45) phase = 'locked'
    else if (m.drift > 0.55 || this.field.noveltyPressure > 0.72)                            phase = 'drift'
    else if (m.residualMass > 0.55 && m.attractorStrength > 0.50)                            phase = 'emergent'
    else if (m.pressure > 0.45 || m.fieldCurvature > 0.45 || this.field.intentPressure > 0.60) phase = 'metastable'

    this.state.phase = phase
  }

  updateFieldIdentity() {
    const m   = this.metrics()
    const phi = 1.618033988749895

    this.field.signature = this.containTheta(
      this.field.signature * phi + this.state.signature +
      m.entropy * this.cycle * 0.20 + m.attractorStrength * this.cycle * 0.14 +
      m.fieldCurvature * this.cycle * 0.10 + this.field.semanticGrounding * this.cycle * 0.08
    )

    this.field.drift = this.round4(m.drift)

    this.field.coherence = this.round4(this.clamp01(
      (1 - m.drift) * 0.32 + m.attractorStrength * 0.25 +
      (1 - m.pressure) * 0.17 + m.fieldCurvature * 0.08 +
      this.field.semanticCoherence * 0.18
    ))

    this.field.continuity = this.round4(this.clamp01(
      m.residualMass * 0.34 + m.attractorStrength * 0.25 +
      (1 - m.drift) * 0.17 + m.fieldCurvature * 0.08 +
      this.field.semanticGrounding * 0.16
    ))

    this.field.momentum = this.round4(this.clamp01(
      Math.abs(this.state.lastDeltaTheta) / (this.cycle * 0.5)
    ))

    this.field.resonance = this.round4(this.clamp01(
      m.entropy * 0.22 + m.attractorStrength * 0.27 + m.residualMass * 0.18 +
      m.fieldCurvature * 0.13 + this.field.semanticCoherence * 0.20
    ))

    this.field.topicPressure = this.round4(m.pressure)

    if (this.state.phase !== 'drift' && this.state.phase !== 'turbulent')
      this.field.lastStablePhase = this.state.phase

    this.field.persistence = this.round4(this.clamp01(
      this.field.persistence * 0.92 + this.field.continuity * 0.08
    ))

    this.field.emergence = this.round4(this.clamp01(
      m.residualMass * 0.22 + m.entropy * 0.20 + m.attractorStrength * 0.28 +
      m.fieldCurvature * 0.12 + this.field.noveltyPressure * 0.18
    ))

    this.field.phaseHistory.push({ t: this.state.t, phase: this.state.phase })
    if (this.field.phaseHistory.length > 64) this.field.phaseHistory.shift()

    this.field.attractorTrace.push({
      t: this.state.t,
      attractors: this.state.attractors.map(a => ({
        r: a.r, i: a.i,
        strength:            this.round4(a.strength),
        semanticWeight:      this.round4(a.semanticWeight      ?? 0),
        credibility:         this.round4(a.credibility         ?? 1.0),
        emergentCredibility: this.round4(a.emergentCredibility ?? 1.0)
      }))
    })

    if (this.field.attractorTrace.length > 64) this.field.attractorTrace.shift()
  }

  updateSemanticField(perturbation) {
    const current    = perturbation.semantic
    const last       = this.field.semanticMemory.at(-1)
    const similarity = last ? this.cosineSimilarity(current.vector, last.vector) : 0
    const novelty    = this.clamp01(1 - similarity)

    const intentPressure = this.clamp01(
      current.intent.ask * 0.15 + current.intent.execute * 0.22 +
      current.intent.diagnose * 0.22 + current.intent.reason * 0.18 +
      current.intent.code * 0.15 + current.intent.data * 0.08
    )

    const grounding = this.clamp01(
      current.lexicalDensity * 0.25 + current.lengthScore * 0.12 +
      current.intent.code * 0.15 + current.intent.data * 0.15 +
      current.intent.reason * 0.15 + current.intent.execute * 0.10 +
      current.intent.diagnose * 0.08
    )

    this.field.semanticGrounding = this.round4(this.clamp01(this.field.semanticGrounding * 0.86 + grounding * 0.14))
    this.field.semanticCoherence = this.round4(this.clamp01(this.field.semanticCoherence * 0.82 + similarity * 0.18))
    this.field.intentPressure    = this.round4(this.clamp01(this.field.intentPressure * 0.78 + intentPressure * 0.22))
    this.field.executionReadiness = this.round4(this.clamp01(
      current.intent.execute * 0.35 + current.intent.code * 0.25 +
      current.intent.data * 0.15 + this.field.coherence * 0.15 + (1 - this.field.drift) * 0.10
    ))
    this.field.noveltyPressure = this.round4(this.clamp01(this.field.noveltyPressure * 0.80 + novelty * 0.20))
    this.field.recallPotential = this.round4(this.clamp01(
      similarity * 0.35 + this.field.resonance * 0.25 +
      this.field.persistence * 0.20 + this.field.continuity * 0.20
    ))
    this.field.routingPressure = this.round4(this.clamp01(
      this.field.intentPressure * 0.30 + this.field.noveltyPressure * 0.20 +
      this.field.recallPotential * 0.30 + this.field.topicPressure * 0.20
    ))
    this.field.compressionPressure = this.round4(this.clamp01(
      (1 - this.field.noveltyPressure) * 0.30 + this.field.coherence * 0.25 +
      this.field.continuity * 0.25 + this.field.persistence * 0.20
    ))

    this.field.semanticMemory.push({
      t:         this.state.t,
      theta:     this.round4(this.state.lastTheta),
      signature: this.round4(this.state.signature),
      vector:    current.vector.slice(),
      intent:    { ...current.intent },
      grounding: this.field.semanticGrounding,
      coherence: this.field.semanticCoherence,
      novelty:   this.field.noveltyPressure,
      phase:     this.state.phase,
      signalType: this.field.signalType,
      sourceWeight: perturbation.sourceWeight ?? 1.0
    })

    while (this.field.semanticMemory.length > this.semanticMemoryLimit) {
      const old = this.field.semanticMemory.shift()
      this.field.archivedContinuity.push({
        t: old.t, signature: old.signature, grounding: old.grounding,
        coherence: old.coherence, phase: old.phase, signalType: old.signalType
      })
    }

    while (this.field.archivedContinuity.length > this.archiveLimit)
      this.field.archivedContinuity.shift()
  }

  updateSignalMetrics() {
    const ps = []
    for (const ring of this.rings) for (const c of ring) ps.push(c.p)
    const maxP = Math.max(...ps)
    const sumP = ps.reduce((a, b) => a + b, 0)
    const L    = sumP > 0 ? maxP / sumP : 0
    this.field.localization    = this.round4(L)
    this.field.coherenceRadius = this.computeCoherenceRadius()
    this.field.signalType      = L > this.localizationThreshold ? 'signal' : 'noise'
  }

  computeCoherenceRadius() {
    const top = this.state.attractors[0]
    if (!top) return 0
    let radius = 0
    for (let i = 1; i < Math.floor(this.resolution / 2); i++) {
      const l = this.rings[top.r][this.wrapIndex(top.i - i)].p
      const r = this.rings[top.r][this.wrapIndex(top.i + i)].p
      if (l < this.activationThreshold && r < this.activationThreshold) break
      radius = i
    }
    return radius
  }

  updateManifold(perturbation) {
    const vec    = perturbation.semantic.vector
    const D      = this.manifoldDimensions
    const sw     = perturbation.sourceWeight ?? 1.0
    const cx     = Math.min(Math.abs(Math.floor((vec[0] ?? 0) * (D - 1))), D - 1)
    const cy     = Math.min(Math.abs(Math.floor((vec[1] ?? 0) * (D - 1))), D - 1)
    const radius = Math.max(1, Math.floor(2 + this.field.semanticCoherence * 4))

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx   = ((cx + dx) % D + D) % D
        const ny   = ((cy + dy) % D + D) % D
        const dist = Math.sqrt(dx * dx + dy * dy)
        const prox = Math.max(0, 1 - dist / (radius + 1))
        const idx  = nx * D + ny

        this.field.manifold[idx] = this.clamp01(this.field.manifold[idx] * 0.97 + prox * sw * 0.03)
        this.field.manifoldAge[idx] = this.clamp01((this.field.manifoldAge[idx] ?? 0) * 0.995 + prox * 0.005)
      }
    }

    const lastMem = this.field.semanticMemory.at(-2)
    if (lastMem?.vector) {
      const bx    = Math.min(Math.abs(Math.floor((lastMem.vector[0] ?? 0) * (D - 1))), D - 1)
      const by    = Math.min(Math.abs(Math.floor((lastMem.vector[1] ?? 0) * (D - 1))), D - 1)
      for (let s = 1; s <= 4; s++) {
        const lx   = Math.round(bx + (cx - bx) * s / 4)
        const ly   = Math.round(by + (cy - by) * s / 4)
        const lidx = lx * D + ly
        this.field.manifold[lidx] = this.clamp01((this.field.manifold[lidx] ?? 0) + 0.008 * sw)
      }
    }
  }

  updateEmergentCredibility(perturbation) {
    const currentVec = perturbation.semantic.vector
    const prevVec    = this.state.lastPerturbationVector
    const sw         = perturbation.sourceWeight ?? 1.0

    if (!prevVec.length || !this.state.attractors.length) return

    for (const a of this.state.attractors) {
      if (!a.semanticVector?.length) continue

      const alignedWithCurrent = this.cosineSimilarity(currentVec, a.semanticVector)
      const alignedWithPrev    = this.cosineSimilarity(prevVec,    a.semanticVector)
      const predictionAccuracy = this.clamp01(1 - Math.abs(alignedWithCurrent - alignedWithPrev))

      const wasCorrect = predictionAccuracy > 0.65
      const reward = wasCorrect
        ? this.credibilityLearningRate * sw
        : -this.credibilityLearningRate * 1.2 * (1 - sw + 0.1)

      a.emergentCredibility = this.clamp01((a.emergentCredibility ?? 1.0) + reward)
      a.predictionScore     = this.round4(predictionAccuracy)
      a.predictionCount     = (a.predictionCount ?? 0) + 1

      const cell = this.rings[a.r]?.[a.i]
      if (cell) {
        cell.credibility = this.clamp01(
          cell.credibility * 0.92 + (a.emergentCredibility ?? 1.0) * 0.08
        )
      }
    }

    const credibilities = this.state.attractors.map(a => a.emergentCredibility ?? 1.0)
    this.field.avgFieldCredibility = credibilities.length
      ? this.round4(this.average(credibilities))
      : 1.0

    this.state.attractorCredibilityLog.push({ t: this.state.t, avg: this.field.avgFieldCredibility })
    if (this.state.attractorCredibilityLog.length > 64)
      this.state.attractorCredibilityLog.shift()
  }

  updateRecursiveCognition() {
    const attractors = this.state.attractors
    if (attractors.length < 2) return

    for (let x = 0; x < attractors.length; x++) {
      for (let y = x + 1; y < attractors.length; y++) {
        const a = attractors[x]
        const b = attractors[y]
        if (!a.semanticVector?.length || !b.semanticVector?.length) continue

        const semantic = this.cosineSimilarity(a.semanticVector, b.semanticVector)

        if (semantic < this.contradictionThreshold) {
          const stronger = (a.emergentCredibility ?? 1) >= (b.emergentCredibility ?? 1) ? a : b
          const weaker   = stronger === a ? b : a
          weaker.strength  = this.clamp01(weaker.strength  * (1 - 0.12 * (stronger.emergentCredibility ?? 1)))
          weaker.stability = this.clamp01((weaker.stability ?? 0) * (1 - 0.10 * (stronger.emergentCredibility ?? 1)))
        }

        if (semantic > 0.75) {
          const boost = 0.06 * Math.min(a.emergentCredibility ?? 1, b.emergentCredibility ?? 1)
          a.strength = this.clamp01(a.strength + boost)
          b.strength = this.clamp01(b.strength + boost)
        }
      }
    }

    const metaCandidates = []
    for (let x = 0; x < attractors.length; x++) {
      for (let y = x + 1; y < attractors.length; y++) {
        const a = attractors[x]
        const b = attractors[y]
        if (!a.semanticVector?.length || !b.semanticVector?.length) continue

        const sim        = this.cosineSimilarity(a.semanticVector, b.semanticVector)
        const jointStr   = (a.strength + b.strength) / 2
        const jointCred  = ((a.emergentCredibility ?? 1) + (b.emergentCredibility ?? 1)) / 2

        if (sim > 0.70 && jointStr > this.metaAttractorThreshold && jointCred > 0.55) {
          metaCandidates.push({
            sourceA: x, sourceB: y,
            strength:            this.round4(jointStr),
            emergentCredibility: this.round4(jointCred),
            semanticVector:      a.semanticVector.map((v, i) => (v + (b.semanticVector[i] ?? 0)) / 2),
            theta:               (a.theta + b.theta) / 2,
            similarity:          this.round4(sim)
          })
        }
      }
    }

    this.field.metaAttractors = metaCandidates.slice(0, 4)
  }

  metrics() {
    if (this._metricsCache !== null && this._metricsCacheTime === this.state.t)
      return this._metricsCache

    const ps = [], pressures = [], residuals = [], densities = [], semanticTraces = [], intentTraces = []

    for (const ring of this.rings)
      for (const c of ring) {
        ps.push(c.p); pressures.push(c.pressure); residuals.push(c.residual)
        densities.push(c.constraintDensity ?? 0)
        semanticTraces.push(c.semanticTrace ?? 0)
        intentTraces.push(c.intentTrace     ?? 0)
      }

    const mean           = this.average(ps)
    const entropy        = this.normalizedEntropy(ps)
    const pressure       = this.average(pressures)
    const residualMass   = this.average(residuals)
    const aliveRatio     = ps.filter(v => v > this.activationThreshold).length / ps.length
    const fieldCurvature = this.average(densities)
    const semanticMass   = this.average(semanticTraces)
    const intentMass     = this.average(intentTraces)
    const attractorStrength = this.state.attractors.length
      ? this.average(this.state.attractors.map(a => a.stability))
      : 0

    const prev  = this.state.history.at(-1)
    const drift = prev
      ? this.clamp01(
          Math.abs((prev.metrics?.mean        ?? prev.mean        ?? mean)    - mean) +
          Math.abs((prev.metrics?.entropy     ?? prev.entropy     ?? entropy) - entropy) +
          Math.abs((prev.metrics?.semanticMass ?? prev.semanticMass ?? 0)    - semanticMass)
        )
      : 0

    const maxP = Math.max(...ps)
    const sumP = ps.reduce((a, b) => a + b, 0)

    const result = {
      mean: this.round4(mean), entropy: this.round4(entropy),
      pressure: this.round4(pressure), residualMass: this.round4(residualMass),
      aliveRatio: this.round4(aliveRatio), attractorStrength: this.round4(attractorStrength),
      drift: this.round4(drift), fieldCurvature: this.round4(fieldCurvature),
      semanticMass: this.round4(semanticMass), intentMass: this.round4(intentMass),
      totalMass: this.round4(this.totalMass()),
      massError: this.round4(Math.abs(this.totalMass() - this.massTarget))
    }

    this._metricsCache     = result
    this._metricsCacheTime = this.state.t
    return result
  }

  snapshot(perturbation, delta, contained) {
    return {
      version: 'CELF-V5',
      mode:    'semantic cyclic possibility curvature',
      t:       this.state.t,
      phase:   this.state.phase,
      perturbation: {
        length: perturbation.length, numeric: perturbation.numeric,
        rupture: perturbation.rupture, spread: perturbation.spread,
        sourceWeight: perturbation.sourceWeight ?? 1.0,
        semantic: {
          words: perturbation.semantic.words, unique: perturbation.semantic.unique,
          lexicalDensity: perturbation.semantic.lexicalDensity,
          code: perturbation.semantic.code, question: perturbation.semantic.question,
          error: perturbation.semantic.error, command: perturbation.semantic.command,
          reasoning: perturbation.semantic.reasoning, emotional: perturbation.semantic.emotional,
          data: perturbation.semantic.data, intent: perturbation.semantic.intent
        }
      },
      delta: {
        theta: this.round4(delta.theta), index: delta.index,
        deltaTheta: this.round4(delta.deltaTheta), intensity: this.round4(delta.intensity),
        semanticWeight: this.round4(delta.semanticWeight),
        vector: delta.vector.map(v => this.round4(v))
      },
      contained: {
        signature: this.round4(contained.signature), cycleCount: contained.cycleCount
      },
      field:    this.getFieldIdentity(),
      semantic: this.getSemanticState(),
      control:  this.getControlGuidance(),
      metrics:  this.metrics(),
      signal: {
        localization:    this.field.localization,
        coherenceRadius: this.field.coherenceRadius,
        signalType:      this.field.signalType,
        sourceWeight:    this.field.lastSourceWeight
      },
      cognition: {
        avgFieldCredibility: this.field.avgFieldCredibility,
        metaAttractors:      this.field.metaAttractors,
        credibilityLog:      this.state.attractorCredibilityLog.slice(-8)
      },
      vault: {
        capsuleCount: this.hexVault.size,
        activeCapsules: this.getActiveCapsules().length
      },
      attractors: this.state.attractors.map(a => ({
        r: a.r, i: a.i,
        theta: this.round4(a.theta), orbitTheta: this.round4(a.orbitTheta),
        strength: this.round4(a.strength), stability: this.round4(a.stability),
        constraintDensity:   this.round4(a.constraintDensity   ?? 0),
        semanticWeight:      this.round4(a.semanticWeight      ?? 0),
        intentWeight:        this.round4(a.intentWeight        ?? 0),
        credibility:         this.round4(a.credibility         ?? 1.0),
        emergentCredibility: this.round4(a.emergentCredibility ?? 1.0),
        predictionScore:     this.round4(a.predictionScore     ?? 0),
        predictionCount:     a.predictionCount ?? 0
      }))
    }
  }

  commit(snapshot) {
    const compressed = {
      t:             snapshot.t,
      phase:         snapshot.phase,
      signature:     snapshot.contained?.signature     ?? 0,
      drift:         snapshot.field?.drift             ?? 0,
      coherence:     snapshot.field?.coherence         ?? 0,
      continuity:    snapshot.field?.continuity        ?? 0,
      novelty:       snapshot.field?.noveltyPressure   ?? 0,
      semanticMass:  snapshot.metrics?.semanticMass    ?? 0,
      grounding:     snapshot.field?.semanticGrounding ?? 0,
      attractorCount: snapshot.attractors?.length      ?? 0,
      signalType:    snapshot.signal?.signalType       ?? 'noise',
      credibility:   snapshot.cognition?.avgFieldCredibility ?? 1.0
    }

    this.state.history.push(compressed)

    while (this.state.history.length > this.historyLimit) {
      const old = this.state.history.shift()
      this.state.archive.push({
        archived: true, t: old.t, phase: old.phase,
        signature: old.signature, drift: old.drift, coherence: old.coherence,
        semanticMass: old.semanticMass, grounding: old.grounding,
        signalType: old.signalType, credibility: old.credibility
      })
    }

    while (this.state.archive.length > this.archiveLimit)
      this.state.archive.shift()

    this.state.t++
  }

  routeContext(query = null, limit = this.routingLimit) {
    const signal =
      query === null || query === undefined ? '' :
      typeof query === 'string' ? query : JSON.stringify(query)

    const semantic = signal
      ? this.extractSemantic(query, signal)
      : this.field.semanticMemory.at(-1)

    if (!semantic) return []

    const vector            = semantic.vector ?? new Float32Array(0)
    const currentTheta      = this.state.lastTheta  ?? 0
    const currentPhase      = this.state.phase       ?? 'warmup'
    const currentAttractors = this.state.attractors  ?? []

    // ── Vault: تحقق من كبسولات نشطة ──────────────────────────────
    const vaultResult = signal ? this.retrieveCapsule(signal, vector) : null

    const items = this.field.semanticMemory
      .map(item => {
        const semanticSim   = this.cosineSimilarity(vector, item.vector ?? new Float32Array(0))
        const thetaDist     = Math.abs(((item.theta - currentTheta + this.cycle) % this.cycle))
        const circularDist  = Math.min(thetaDist, this.cycle - thetaDist)
        const attractorProx = this.clamp01(1 - circularDist / (this.cycle * 0.5))

        const topAttractor = currentAttractors[0]
        const hysteresisAffinity = topAttractor
          ? this.clamp01(
              1 - Math.abs(
                ((item.theta - (topAttractor.theta ?? 0) + this.cycle) % this.cycle)
              ) / (this.cycle * 0.3)
            )
          : 0

        const continuity = this.clamp01(
          item.coherence * 0.5 + item.grounding * 0.3 + (1 - (item.novelty ?? 0)) * 0.2
        )

        const phaseMatch = item.phase === currentPhase ? 0.15 : 0

        const score = this.round4(
          semanticSim        * 0.35 + attractorProx      * 0.25 +
          hysteresisAffinity * 0.20 + continuity         * 0.10 +
          phaseMatch         + item.coherence * 0.05 + item.grounding * 0.05
        )

        return {
          t: item.t, phase: item.phase, theta: item.theta,
          signature: item.signature, signalType: item.signalType ?? 'noise',
          score,
          _semanticSim:   this.round4(semanticSim),
          _attractorProx: this.round4(attractorProx),
          _hysteresisAff: this.round4(hysteresisAffinity),
          _continuity:    this.round4(continuity)
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit))

    // أضف بيانات الـ Vault إذا وُجدت
    if (vaultResult) {
      return {
        items,
        vaultHit: {
          compressed: vaultResult.capsule.source.compressed,
          score:      this.round4(vaultResult.score),
          phiOrbit:   this.round4(vaultResult.capsule.phiOrbit),
          reinforcement: vaultResult.capsule.reinforcement ?? 0
        }
      }
    }

    return items
  }

  getControlGuidance() {
    const mode =
      this.state.phase === 'turbulent' ? 'ground'   :
      this.state.phase === 'drift'     ? 'clarify'  :
      this.state.phase === 'emergent'  ? 'explore'  :
      this.state.phase === 'locked'    ? 'compress' :
      this.state.phase === 'noise'     ? 'filter'   :
      'balance'

    const depth =
      this.field.routingPressure > 0.72     ? 'deep'  :
      this.field.compressionPressure > 0.72 ? 'quick' :
      'balanced'

    return {
      mode, depth,
      contextUse:          this.round4(this.clamp01(this.field.routingPressure)),
      compression:         this.round4(this.clamp01(this.field.compressionPressure)),
      recall:              this.round4(this.clamp01(this.field.recallPotential)),
      grounding:           this.round4(this.clamp01(this.field.semanticGrounding)),
      executionReadiness:  this.round4(this.clamp01(this.field.executionReadiness)),
      signalType:          this.field.signalType,
      localization:        this.field.localization,
      avgFieldCredibility: this.field.avgFieldCredibility
    }
  }

  getSemanticState() {
    return {
      semanticGrounding:   this.field.semanticGrounding,
      semanticCoherence:   this.field.semanticCoherence,
      intentPressure:      this.field.intentPressure,
      executionReadiness:  this.field.executionReadiness,
      recallPotential:     this.field.recallPotential,
      routingPressure:     this.field.routingPressure,
      compressionPressure: this.field.compressionPressure,
      noveltyPressure:     this.field.noveltyPressure,
      memorySize:          this.field.semanticMemory.length,
      vaultSize:           this.hexVault.size,
      routedContext:       this.routeContext(null, Math.min(3, this.routingLimit))
    }
  }

  getFieldIdentity() {
    return {
      signature:           this.round4(this.field.signature),
      continuity:          this.field.continuity,
      coherence:           this.field.coherence,
      drift:               this.field.drift,
      momentum:            this.field.momentum,
      resonance:           this.field.resonance,
      persistence:         this.field.persistence,
      emergence:           this.field.emergence,
      topicPressure:       this.field.topicPressure,
      semanticGrounding:   this.field.semanticGrounding,
      semanticCoherence:   this.field.semanticCoherence,
      intentPressure:      this.field.intentPressure,
      executionReadiness:  this.field.executionReadiness,
      recallPotential:     this.field.recallPotential,
      routingPressure:     this.field.routingPressure,
      compressionPressure: this.field.compressionPressure,
      noveltyPressure:     this.field.noveltyPressure,
      lastStablePhase:     this.field.lastStablePhase,
      phaseHistory:        [...this.field.phaseHistory],
      attractorTrace:      [...this.field.attractorTrace],
      localization:        this.field.localization,
      coherenceRadius:     this.field.coherenceRadius,
      signalType:          this.field.signalType,
      lastSourceWeight:    this.field.lastSourceWeight,
      avgFieldCredibility: this.field.avgFieldCredibility,
      metaAttractorCount:  this.field.metaAttractors?.length ?? 0,
      vaultCapsules:       this.hexVault.size
    }
  }

  getRings() {
    return this.rings.map(ring =>
      ring.map(c => ({
        p:                 this.round4(c.p),
        residual:          this.round4(c.residual),
        pressure:          this.round4(c.pressure),
        memory:            this.round4(c.memory),
        constraintDensity: this.round4(c.constraintDensity ?? 0),
        semanticTrace:     this.round4(c.semanticTrace     ?? 0),
        intentTrace:       this.round4(c.intentTrace       ?? 0),
        credibility:       this.round4(c.credibility       ?? 1.0),
        active:            c.active
      }))
    )
  }

  getSummary() {
    return {
      version:        'CELF-V5',
      phase:          this.state.phase,
      t:              this.state.t,
      cycle:          this.cycle,
      resolution:     this.resolution,
      ringCount:      this.ringCount,
      signature:      this.round4(this.state.signature),
      cycleCount:     this.state.cycleCount,
      field:          this.getFieldIdentity(),
      semantic:       this.getSemanticState(),
      control:        this.getControlGuidance(),
      metrics:        this.metrics(),
      attractorCount: this.state.attractors.length,
      archiveSize:    this.state.archive.length,
      vaultSize:      this.hexVault.size,
      signal: {
        localization:     this.field.localization,
        coherenceRadius:  this.field.coherenceRadius,
        signalType:       this.field.signalType,
        lastSourceWeight: this.field.lastSourceWeight
      },
      cognition: {
        avgFieldCredibility: this.field.avgFieldCredibility,
        metaAttractorCount:  this.field.metaAttractors?.length ?? 0
      }
    }
  }

  learnPattern(sequence = []) {
    for (const item of sequence) this.process(item)
    return this
  }

  benchmark(sequence = [], noisySequence = []) {
    this.reset()
    for (const x of sequence) this.process(x)
    const clean = this.metrics(); const cleanSemantic = this.getSemanticState()

    this.reset()
    for (const x of noisySequence) this.process(x)
    const noisy = this.metrics(); const noisySemantic = this.getSemanticState()

    return {
      clean, noisy, cleanSemantic, noisySemantic,
      retainedSignal:    this.round4(1 - Math.abs(clean.entropy   - noisy.entropy)),
      driftResistance:   this.round4(1 - noisy.drift),
      pressureIncrease:  this.round4(noisy.pressure - clean.pressure),
      residualRetention: noisy.residualMass,
      curvatureShift:    this.round4(noisy.fieldCurvature - clean.fieldCurvature),
      semanticShift:     this.round4(noisy.semanticMass   - clean.semanticMass),
      localizationShift: this.round4(noisy.localization   - clean.localization),
      signalType:        noisy.signalType,
      credibilityShift:  this.round4((noisy.avgFieldCredibility ?? 1) - (clean.avgFieldCredibility ?? 1))
    }
  }

  totalMass() {
    let s = 0
    for (const ring of this.rings) for (const c of ring) s += c.p
    return s
  }

  normalizedEntropy(values) {
    const sum = values.reduce((s, v) => s + v, 0)
    if (sum <= 0) return 0
    let h = 0
    for (const v of values) { const p = v / sum; if (p > 0) h -= p * Math.log(p) }
    return this.clamp01(h / Math.log(values.length))
  }

  average(values) {
    if (!values.length) return 0
    return values.reduce((s, v) => s + Number(v || 0), 0) / values.length
  }

  cosineSimilarity(a = [], b = []) {
    const n = Math.min(a.length, b.length)
    if (!n) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) {
      const x = Number(a[i] || 0); const y = Number(b[i] || 0)
      dot += x * y; na += x * x; nb += y * y
    }
    if (na <= 0 || nb <= 0) return 0
    return this.clamp01(dot / (Math.sqrt(na) * Math.sqrt(nb)))
  }

  containTheta(v)      { return ((Number(v) % this.cycle) + this.cycle) % this.cycle }
  thetaToIndex(theta)  { return Math.floor((this.containTheta(theta) / this.cycle) * this.resolution) % this.resolution }
  indexToTheta(d)      { return (d / this.resolution) * this.cycle }
  wrapIndex(i)         { return ((i % this.resolution) + this.resolution) % this.resolution }
  wrapRing(r)          { return ((r % this.ringCount)  + this.ringCount)  % this.ringCount  }
  circularIndexDistance(a, b) { const d = Math.abs(a - b); return Math.min(d, this.resolution - d) }
  signedIndexDistance(a, b)   { const f = (b - a + this.resolution) % this.resolution; return f > this.resolution / 2 ? f - this.resolution : f }
  clamp01(v)  { const n = Number(v); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(1, n)) }
  clampP(v)   { const n = Number(v); if (!Number.isFinite(n)) return this.epsilon; return Math.max(this.epsilon, n) }
  round4(v)   { return Math.round(Number(v || 0) * 10000) / 10000 }

  buildFieldPrompt() {
    const attractors    = this.state.attractors ?? []
    const field         = this.field
    const phase         = this.state.phase ?? 'warmup'
    const topAttractors = attractors.sort((a, b) => b.strength - a.strength).slice(0, 3)

    const zone     = this.#resolveSemanticZone(topAttractors, field)
    const pressure = this.#resolvePressureState(field)

    const continuity = this.round4(
      field.continuity  * 0.35 +
      field.coherence   * 0.35 +
      field.persistence * 0.20 +
      (1 - field.drift) * 0.10
    )

    return {
      zone, pressure, continuity, phase,
      resonance:      this.round4(field.resonance  ?? 0),
      coherence:      this.round4(field.coherence  ?? 0),
      drift:          this.round4(field.drift      ?? 0),
      attractorCount: attractors.length,
      vaultSize:      this.hexVault.size
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  COGNITIVE QUERY LAYER — داخل المحرك
  // ═══════════════════════════════════════════════════════════════

  /**
   * buildCognitiveTarget(query, index?)
   *
   * يدمج User Query + CELF Field State → Focused Cognitive Target
   * يقرأ this مباشرة — لا يحتاج engine كـ argument
   *
   * @param {string}          query  — نص المستخدم
   * @param {StructuralIndex} index  — الـ Index (اختياري)
   * @returns {CognitiveTarget}
   */
  buildCognitiveTarget(query, index = null) {

    // ── 1. User Intent ─────────────────────────────────────────
    const userIntent = this.#extractUserIntent(query)

    // ── 2. Field State من this مباشرة ─────────────────────────
    const fieldState = {
      phase:              this.state.phase,
      continuity:         this.field.continuity          ?? 0,
      coherence:          this.field.coherence           ?? 0,
      drift:              this.field.drift               ?? 0,
      resonance:          this.field.resonance           ?? 0,
      semanticGrounding:  this.field.semanticGrounding   ?? 0,
      semanticCoherence:  this.field.semanticCoherence   ?? 0,
      noveltyPressure:    this.field.noveltyPressure     ?? 0,
      executionReadiness: this.field.executionReadiness  ?? 0,
      recallPotential:    this.field.recallPotential     ?? 0,
      routingPressure:    this.field.routingPressure     ?? 0,
      intentPressure:     this.field.intentPressure      ?? 0,
      avgCredibility:     this.field.avgFieldCredibility ?? 1.0,
      vaultSize:          this.hexVault.size
    }

    // ── 3. Vault ───────────────────────────────────────────────
    const queryVec    = this.extractSemantic(query, query).vector
    const vaultResult = this.retrieveCapsule(query, queryVec)
    const vaultCapsules = []

    if (vaultResult) {
      vaultCapsules.push({
        compressed:    vaultResult.capsule.source.compressed,
        score:         this.round4(vaultResult.score),
        phiOrbit:      this.round4(vaultResult.capsule.phiOrbit),
        reinforcement: vaultResult.capsule.reinforcement ?? 0,
        phase:         vaultResult.capsule.phase,
        version:       vaultResult.capsule.version ?? 1
      })
    }

    for (const cap of (this.getActiveCapsules?.() ?? []).slice(0, 3)) {
      if (!vaultCapsules.find(v => v.compressed === cap.source?.compressed)) {
        vaultCapsules.push({
          compressed:        cap.source?.compressed,
          score:             0,
          phiOrbit:          this.round4(cap.phiOrbit ?? 0),
          reinforcement:     cap.reinforcement ?? 0,
          phase:             cap.phase,
          version:           cap.version ?? 1,
          activeByResonance: true
        })
      }
    }

    // ── 4. Structural Index — on-demand ────────────────────────
    let indexResult = null
    if (index && userIntent.entities.length > 0) {
      indexResult = index.query(
        { names: userIntent.entities },
        userIntent.depth === 'deep' ? 3 : 2
      )
      for (const node of (indexResult.nodes ?? [])) {
        if (!node.semanticVector)
          node.semanticVector = this.semanticVector(node.semanticLabel ?? node.name)
      }
    }

    // ── 5. Focus Resolution — الـ intersection ─────────────────
    const focus = this.#resolveCognitiveFocus(userIntent, fieldState, vaultCapsules, indexResult)

    // ── 6. Structural subgraph ─────────────────────────────────
    let structuralGraph = null
    if (index && focus.what.length > 0) {
      const depth = focus.depth === 'deep' ? 3 : focus.depth === 'surface' ? 1 : 2
      const g     = index.query({ names: focus.what, files: focus.files }, depth)
      structuralGraph = {
        nodeCount: g.totalNodes,
        edgeCount: g.totalEdges,
        nodes: (g.nodes ?? []).map(n => ({
          name: n.name, type: n.type, file: n.file,
          semanticLabel: n.semanticLabel,
          vaultCapsuleId: n.vaultCapsuleId
        }))
      }
    }

    // ── 7. Top Attractors ──────────────────────────────────────
    const topAttractors = (this.state.attractors ?? [])
      .slice()
      .sort((a, b) => (b.stability ?? 0) - (a.stability ?? 0))
      .slice(0, 3)
      .map(a => ({
        r:              a.r,
        i:              a.i,
        strength:       this.round4(a.strength       ?? 0),
        stability:      this.round4(a.stability      ?? 0),
        semanticWeight: this.round4(a.semanticWeight ?? 0),
        credibility:    this.round4(a.emergentCredibility ?? a.credibility ?? 1)
      }))

    // ── 8. Cognitive Mode ──────────────────────────────────────
    const cognitiveMode =
      fieldState.executionReadiness > 0.65  ? 'technical'   :
      fieldState.intentPressure     > 0.60  ? 'analytical'  :
      fieldState.semanticCoherence  > 0.55  ? 'reasoning'   :
      fieldState.noveltyPressure    > 0.65  ? 'exploratory' :
      'general'

    // ── 9. Dependency Graph ────────────────────────────────────
    const dependencies = []
    if (structuralGraph?.nodes?.length) {
      // يُبنى من الـ index edges إذا موجودة في النتيجة
      for (const node of structuralGraph.nodes.slice(0, 6)) {
        if (node.calls?.length) {
          for (const callee of node.calls.slice(0, 3)) {
            dependencies.push({ from: node.name, to: callee, type: 'calls', weight: 1 })
          }
        }
      }
    }

    // ── 10. systemHint ─────────────────────────────────────────
    const hintParts = [
      `mode: ${cognitiveMode}`,
      `phase: ${fieldState.phase}`,
      `target: ${focus.mode}`,
      `depth: ${focus.depth}`,
      `continuity: ${fieldState.continuity}`,
      `coherence: ${fieldState.coherence}`
    ]

    if (focus.winner === 'user')  hintParts.push('focus: user_driven — new topic')
    if (focus.winner === 'celf')  hintParts.push('focus: context_driven — use session memory')

    if (vaultCapsules.length) {
      hintParts.push(
        `vault: ${vaultCapsules.map(v => v.compressed).filter(Boolean).join(' | ')}`
      )
    }

    if (dependencies.length) {
      hintParts.push(
        `dependencies: ${dependencies.slice(0, 5).map(d => `${d.from}→${d.to}`).join(', ')}`
      )
    }

    return {
      focus,
      cognitiveMode,
      userIntent,
      fieldState,
      vaultCapsules,
      dependencies,
      structuralGraph,
      topAttractors,
      systemHint: hintParts.filter(Boolean).join('\n'),
      _meta: {
        t:              this.state.t,
        vaultSize:      this.hexVault.size,
        indexUsed:      index !== null,
        conflictWinner: focus.winner
      }
    }
  }

  // ── private: User Intent Extraction ───────────────────────────
  #extractUserIntent(query) {
    const text = String(query ?? '').toLowerCase()

    const mode =
      /اشرح|explain|كيف يعمل|how does|what is|ما هو|ما هي/i.test(text)  ? 'explain'    :
      /اكتب|انزل|أنشئ|build|create|generate|implement|نفذ/i.test(text)   ? 'implement'  :
      /اصلح|fix|debug|خطأ|error|مشكلة|لا يعمل/i.test(text)              ? 'debug'      :
      /صمم|design|architecture|هندسة|كيف نبني/i.test(text)               ? 'design'     :
      /تحقق|check|review|راجع|هل صحيح|is this/i.test(text)              ? 'review'     :
      /قارن|compare|الفرق بين|difference/i.test(text)                    ? 'compare'    :
      'general'

    const depth =
      /بالتفصيل|بعمق|كامل|complete|full|detailed|step by step/i.test(text) ? 'deep'    :
      /باختصار|brief|quick|سريع|ملخص|summary/i.test(text)                  ? 'surface' :
      'balanced'

    const entityPattern = /\b([A-Z][a-zA-Z]{3,}|[a-z]{4,}(?:Context|Builder|Engine|Index|Layer|Vault|Capsule|Query|Route|Cache|Store|Map|Handler|Manager|Controller))\b/g
    const entities = []
    let m
    while ((m = entityPattern.exec(query)) !== null)
      if (!entities.includes(m[1])) entities.push(m[1])

    const clarity = Math.min(1,
      (text.length > 20 ? 0.3 : 0) +
      (entities.length  > 0  ? 0.3 : 0) +
      (mode !== 'general'    ? 0.4 : 0)
    )

    return { mode, depth, entities, clarity, rawQuery: query }
  }

  // ── private: Focus Resolution ──────────────────────────────────
  #resolveCognitiveFocus(userIntent, fieldState, vaultCapsules, indexResult) {
    const {
      continuity, coherence, drift,
      semanticGrounding, noveltyPressure,
      executionReadiness, recallPotential
    } = fieldState

    // novelty: هل الكيانات المذكورة موجودة في الـ Vault؟
    const capsuleLabels = vaultCapsules.map(c => c.compressed?.toLowerCase() ?? '')
    const entityMatches = userIntent.entities.filter(e =>
      capsuleLabels.some(l => l.includes(e.toLowerCase()))
    ).length

    const userNovelty = userIntent.entities.length > 0
      ? Math.max(0, 1 - entityMatches / userIntent.entities.length)
      : noveltyPressure

    // ── Conflict Resolution ──────────────────────────────────
    let winner = 'balanced'

    if (userNovelty > 0.70 && continuity > 0.65) {
      winner = 'user'   // موضوع جديد واضح — اتبع المستخدم
    } else if (userIntent.clarity < 0.30 && semanticGrounding > 0.55) {
      winner = 'celf'   // سؤال غامض — استخدم السياق
    }

    // ── depth ────────────────────────────────────────────────
    const resolvedDepth =
      userIntent.depth === 'deep'                                   ? 'deep'     :
      userIntent.depth === 'surface'                                ? 'surface'  :
      executionReadiness > 0.65 && userIntent.mode === 'implement'  ? 'deep'     :
      coherence > 0.70 && userIntent.mode === 'explain'            ? 'balanced' :
      drift > 0.55                                                   ? 'surface'  :
      'balanced'

    // ── scope ────────────────────────────────────────────────
    const scopeNames = [...userIntent.entities]

    if (winner !== 'user' && recallPotential > 0.60) {
      for (const cap of vaultCapsules.slice(0, 2)) {
        if (cap.compressed) {
          const words = cap.compressed.split(/\s+/)
            .filter(w => w.length > 4 && /^[a-zA-Z]/.test(w))
          scopeNames.push(...words.slice(0, 3))
        }
      }
    }

    // ── mode ─────────────────────────────────────────────────
    const resolvedMode =
      userIntent.mode === 'implement' && this.state.phase === 'locked' ? 'build'     :
      userIntent.mode === 'explain'   && continuity > 0.65             ? 'trace'     :
      userIntent.mode === 'debug'                                       ? 'diagnose'  :
      userIntent.mode === 'design'                                      ? 'architect' :
      userIntent.mode === 'review'                                      ? 'audit'     :
      userIntent.mode === 'compare'                                     ? 'contrast'  :
      'analyze'

    return {
      winner,
      what:           scopeNames.filter((v, i, a) => a.indexOf(v) === i).slice(0, 8),
      files:          [],
      depth:          resolvedDepth,
      mode:           resolvedMode,
      userNovelty:    this.round4(userNovelty),
      celfContinuity: this.round4(continuity)
    }
  }

  #resolveSemanticZone(topAttractors, field) {
    const intentPressure = field.intentPressure     ?? 0
    const execReady      = field.executionReadiness ?? 0
    const semantic       = field.semanticGrounding  ?? 0

    if (execReady > 0.6)            return 'execution'
    if (intentPressure > 0.6)       return 'inquiry'
    if (semantic > 0.5)             return 'conceptual'
    if (topAttractors.length >= 3)  return 'multi_focus'
    if (topAttractors.length === 1) return 'focused'
    return 'general'
  }

  #resolvePressureState(field) {
    if ((field.topicPressure  ?? 0) > 0.7) return 'high_pressure'
    if ((field.noveltyPressure ?? 0) > 0.6) return 'exploring'
    if ((field.coherence       ?? 0) > 0.6) return 'stable'
    if ((field.drift           ?? 0) > 0.5) return 'drifting'
    return 'neutral'
  }

  reset() {
    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++) {
        const c = this.rings[r][i]
        c.p = 1 / this.resolution; c.residual = this.epsilon
        c.pressure = 0; c.memory = 0; c.constraintDensity = 0
        c.semanticTrace = 0; c.intentTrace = 0; c.credibility = 1.0
        c.active = true; c.hysteresis = 0; c.elasticStrain = 0
      }

    this.field = {
      signature: 0, continuity: 0, coherence: 0, drift: 0, momentum: 0, resonance: 0,
      phaseHistory: [], attractorTrace: [], topicPressure: 0, lastStablePhase: 'warmup',
      persistence: 0, emergence: 0, semanticGrounding: 0, semanticCoherence: 0,
      intentPressure: 0, executionReadiness: 0, recallPotential: 0, routingPressure: 0,
      compressionPressure: 0, noveltyPressure: 0, semanticMemory: [], archivedContinuity: [],
      localization: 0, coherenceRadius: 0, signalType: 'noise', lastSourceWeight: 1.0,
      manifold:    new Float32Array(this.manifoldDimensions * this.manifoldDimensions),
      manifoldAge: new Float32Array(this.manifoldDimensions * this.manifoldDimensions),
      metaAttractors: [], avgFieldCredibility: 1.0
    }

    this.state = {
      t: 0, phase: 'warmup', signature: 0,
      cycleCount: 0, lastTheta: 0, lastIndex: 0,
      lastDeltaTheta: 0, totalMass: this.totalMass(),
      attractors: [], history: [], archive: [],
      lastSourceWeight: 1.0,
      lastPerturbationVector: new Float32Array(this.semanticDimensions),
      attractorCredibilityLog: []
    }

    // الـ Vault لا يُمسح عند reset — الكبسولات دائمة
    // إذا أردت مسحه: this.hexVault.clear()

    this.massTarget = this.totalMass()
  }
}
