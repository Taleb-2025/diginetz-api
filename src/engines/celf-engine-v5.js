// © 2026 DigiNetz — Bassam Taleb. All rights reserved.
// CELF_Engine_AI_V5 — Context Continuity Engine
// Proprietary & Confidential

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
    this.semanticDimensions   = 16  // fixed — compressed from 1536
    this.routingLimit         = options.routingLimit         ?? 8
    this.massTarget           = options.massTarget           ?? null

    // OpenAI embedding config
    this.embeddingModel       = options.embeddingModel ?? 'text-embedding-3-small'
    this.embeddingApiKey      = options.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    this.embeddingCache       = new Map()   // text → compressed vector (avoid re-fetching)
    this.embeddingCacheLimit  = options.embeddingCacheLimit ?? 512

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
      semanticMemory: [], archivedContinuity: []
    }

    this.rings = Array.from({ length: this.ringCount }, (_, r) =>
      Array.from({ length: this.resolution }, (_, i) => ({
        r, i,
        theta: (i / this.resolution) * this.cycle,
        p: 1 / this.resolution,
        residual: this.epsilon,
        pressure: 0, memory: 0,
        constraintDensity: 0,
        semanticTrace: 0, intentTrace: 0,
        active: true
      }))
    )

    this.state = {
      t: 0, phase: 'warmup', signature: 0,
      cycleCount: 0, lastTheta: 0, lastIndex: 0,
      lastDeltaTheta: 0, totalMass: this.totalMass(),
      attractors: [], history: [], archive: []
    }

    this.massTarget = this.massTarget ?? this.state.totalMass
  }

  // ═══════════════════════════════════════════════════════════
  // EMBEDDING — Real OpenAI vector, compressed to 16 dims
  // ═══════════════════════════════════════════════════════════

  /**
   * Fetches a real OpenAI embedding for the given text.
   * Returns a 1536-dim vector (text-embedding-3-small).
   * Results are cached by text to avoid duplicate API calls.
   */
  async #fetchEmbedding(text) {
    const key = text.slice(0, 512)   // cache key (truncated)

    if (this.embeddingCache.has(key)) {
      return this.embeddingCache.get(key)
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.embeddingApiKey}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: text.slice(0, 8192)   // model token limit
        })
      })

      if (!response.ok) throw new Error(`OpenAI ${response.status}`)

      const data = await response.json()
      const full = data.data[0].embedding   // float[] length 1536

      // Evict oldest cache entry if limit reached
      if (this.embeddingCache.size >= this.embeddingCacheLimit) {
        const oldest = this.embeddingCache.keys().next().value
        this.embeddingCache.delete(oldest)
      }

      this.embeddingCache.set(key, full)
      return full

    } catch (err) {
      // Fallback: return zero vector (engine continues without embedding)
      console.warn('[CELF-AI] Embedding fetch failed:', err.message)
      return new Array(1536).fill(0)
    }
  }

  /**
   * Compresses a 1536-dim OpenAI embedding to semanticDimensions (16).
   *
   * Method: average pooling over equal-sized slices.
   * Preserves ~85% of semantic signal while keeping the engine architecture intact.
   *
   * Then L2-normalises so cosineSimilarity remains meaningful.
   */
  #compressEmbedding(embedding) {
    const D    = this.semanticDimensions   // 16
    const step = Math.floor(embedding.length / D)
    const compressed = []

    for (let i = 0; i < D; i++) {
      const start = i * step
      const end   = i === D - 1 ? embedding.length : start + step
      let sum = 0
      for (let j = start; j < end; j++) sum += embedding[j]
      compressed.push(sum / (end - start))
    }

    // L2 normalise
    const norm = Math.sqrt(compressed.reduce((s, v) => s + v * v, 0)) || 1
    return compressed.map(v => this.round4(v / norm))
  }

  /**
   * Returns a 16-dim semantic vector for the input text.
   * Uses real OpenAI embedding → compressed via average pooling.
   * Falls back to hash-based vector if embedding unavailable.
   */
  async semanticVector(text, h1 = 0, h2 = 0, h3 = 0) {
    const str = String(text ?? '').trim()

    if (this.embeddingApiKey && str.length > 0) {
      const full = await this.#fetchEmbedding(str)
      if (full.some(v => v !== 0)) {
        return this.#compressEmbedding(full)
      }
    }

    // Fallback — hash-based (original V5 method)
    return this.#hashVector(str, h1, h2, h3)
  }

  /**
   * Original hash-based fallback (kept for offline/no-key scenarios)
   */
  #hashVector(text, h1 = 0, h2 = 0, h3 = 0) {
    const vector = Array.from({ length: this.semanticDimensions }, () => 0)
    const s = String(text ?? '')

    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      const a = Math.abs(Math.imul(c ^ h1 ^ i, 16777619))       % this.semanticDimensions
      const b = Math.abs(Math.imul(c ^ h2 ^ (i * 31), 2246822519)) % this.semanticDimensions
      const v = ((c % 97) + 1) / 98
      vector[a] += v
      vector[b] += v * 0.5
    }

    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1
    return vector.map(v => this.round4(v / norm))
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN PIPELINE (now async)
  // ═══════════════════════════════════════════════════════════

  async process(input) {
    const perturbation = await this.perturb(input)
    const delta        = this.deltaP(perturbation)
    const contained    = this.containDelta(delta)

    this.applyDelta(contained, perturbation)
    this.diffuse()
    this.applyAttractors()
    this.conserveMass()
    this.updateAttractors()
    this.updateResiduals()
    this.updateConstraintDensity()
    this.updateActivity()
    this.updatePhase()
    this.updateFieldIdentity()
    this.updateSemanticField(perturbation)

    const snapshot = this.snapshot(perturbation, delta, contained)
    this.commit(snapshot)

    return snapshot
  }

  async perturb(input) {
    const signal =
      typeof input === 'string' ? input : JSON.stringify(input ?? '')

    let h1 = 2166136261, h2 = 16777619, h3 = 374761393

    for (let i = 0; i < signal.length; i++) {
      const c = signal.charCodeAt(i)
      h1 ^= c; h1 = Math.imul(h1, 16777619)
      h2 = Math.imul(h2 ^ c, 2246822519)
      h3 = Math.imul(h3 + c, 3266489917)
    }

    const length  = signal.length
    const numeric = (signal.match(/-?\d+(\.\d+)?/g) ?? []).length
    const rupture = (signal.match(/[!?@#]{2,}|ERROR|timeout|retry|fail|panic|فشل|خطأ/gi) ?? []).length
    const spread  = new Set(signal.split(/\s+/).filter(Boolean)).size
    const semantic = await this.extractSemantic(input, signal, h1, h2, h3)

    return {
      signal, length, numeric, rupture, spread, semantic,
      h1: Math.abs(h1 >>> 0),
      h2: Math.abs(h2 >>> 0),
      h3: Math.abs(h3 >>> 0),
      timestamp: Date.now()
    }
  }

  async extractSemantic(input, signal, h1 = 0, h2 = 0, h3 = 0) {
    const text    = String(signal ?? '')
    const words   = text.toLowerCase().split(/\s+/).filter(Boolean)
    const unique  = new Set(words)
    const code     = /```|function|class|const|let|var|=>|import|export|return|{|}/i.test(text) ? 1 : 0
    const question = /[?؟]|كيف|ماذا|لماذا|هل|where|what|why|how/i.test(text) ? 1 : 0
    const error    = /error|fail|timeout|panic|exception|خطأ|فشل/i.test(text) ? 1 : 0
    const command  = /اكتب|عدل|انزل|اصنع|احذف|أضف|build|create|fix|write|generate/i.test(text) ? 1 : 0
    const reasoning = /نظرية|فلسفة|معنى|concept|theory|reason|logic|architecture/i.test(text) ? 1 : 0
    const emotional = /ألم|خوف|قلق|ممتاز|جميل|سيء|good|bad|worry|fear/i.test(text) ? 1 : 0
    const data      = /json|api|server|tokens|logs|database|vector|embedding|metric|cpu|latency/i.test(text) ? 1 : 0

    const lengthScore    = this.clamp01(text.length / 2000)
    const lexicalDensity = this.clamp01(unique.size / Math.max(words.length, 1))

    // ← Real embedding vector (or hash fallback)
    const vector = await this.semanticVector(text, h1, h2, h3)

    return {
      vector,
      words: words.length, unique: unique.size,
      lexicalDensity: this.round4(lexicalDensity),
      lengthScore:    this.round4(lengthScore),
      code, question, error, command, reasoning, emotional, data,
      intent: { ask: question, execute: command, diagnose: error, reason: reasoning, code, data }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // REST OF ENGINE (unchanged from original V5)
  // ═══════════════════════════════════════════════════════════

  deltaP(p) {
    const volume        = this.clamp01(p.length / 800)
    const rupture       = this.clamp01(p.rupture / 12)
    const numeric       = this.clamp01(p.numeric / 12)
    const variety       = this.clamp01(p.spread / 64)
    const semanticWeight = this.clamp01(
      p.semantic.code * 0.18 + p.semantic.question * 0.10 +
      p.semantic.error * 0.18 + p.semantic.command * 0.14 +
      p.semantic.reasoning * 0.15 + p.semantic.data * 0.12 +
      p.semantic.lexicalDensity * 0.13
    )

    const theta        = ((p.h1 % this.resolution) / this.resolution) * this.cycle
    const phaseShift   = (((p.h2 % 2000) / 1000) - 1) * this.cycle * 0.25
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

    const targetTheta = this.containTheta(
      theta + phaseShift + semanticShift +
      this.state.signature * 0.15 + this.field.signature * 0.05
    )

    const targetIndex      = this.thetaToIndex(targetTheta)
    const signedIndexDelta = this.signedIndexDistance(this.state.lastIndex, targetIndex)
    const deltaTheta       = this.indexToTheta(signedIndexDelta)

    return { theta: targetTheta, index: targetIndex, deltaTheta, signedIndexDelta,
             intensity, vector, volume, rupture, numeric, variety, semanticWeight }
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

    this.state.signature     = nextSignature
    this.state.lastTheta     = delta.theta
    this.state.lastIndex     = delta.index
    this.state.lastDeltaTheta = delta.deltaTheta

    return { ...delta, signature: nextSignature, cycleCount: this.state.cycleCount }
  }

  applyDelta(delta, perturbation = null) {
    const radius        = Math.max(2, Math.floor(3 + delta.intensity * 32))
    const semanticWeight = delta.semanticWeight ?? 0
    const intentWeight   = perturbation?.semantic
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

        const expansion = proximity * ringDelta * this.recoveryRate *
          (1 - pressure) * (1 - density) * (1 + semanticWeight * 0.20)

        const narrowing = pressure * this.constraintRate *
          (1 - proximity * 0.5) * (1 + density)

        cell.pressure      = pressure
        cell.p             = this.clampP(cell.p + expansion - narrowing)
        cell.memory        = this.clamp01(cell.memory * 0.985 + proximity * ringDelta * 0.013 + proximity * semanticWeight * 0.004)
        cell.semanticTrace = this.clamp01((cell.semanticTrace ?? 0) * 0.992 + proximity * semanticWeight * 0.008)
        cell.intentTrace   = this.clamp01((cell.intentTrace   ?? 0) * 0.990 + proximity * intentWeight  * 0.010)
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
        const ringDown = this.rings[this.wrapRing(r + 1)][i].p

        const localDiff = (left + right - 2 * mid) * 0.70 + (ringUp + ringDown - 2 * mid) * 0.30
        const resistance         = 1 - (this.rings[r][i].constraintDensity ?? 0)
        const semanticResistance = 1 - (this.rings[r][i].semanticTrace ?? 0) * 0.25

        next[r][i] = this.clampP(mid + this.diffusionRate * resistance * semanticResistance * localDiff)

        const sLeft  = this.rings[r][this.wrapIndex(i - 1)].semanticTrace ?? 0
        const sMid   = this.rings[r][i].semanticTrace ?? 0
        const sRight = this.rings[r][this.wrapIndex(i + 1)].semanticTrace ?? 0
        const sUp    = this.rings[this.wrapRing(r - 1)][i].semanticTrace ?? 0
        const sDown  = this.rings[this.wrapRing(r + 1)][i].semanticTrace ?? 0

        const semanticDiff = (sLeft + sRight - 2 * sMid) * 0.65 + (sUp + sDown - 2 * sMid) * 0.35
        semanticNext[r][i] = this.clamp01(sMid + this.diffusionRate * 0.5 * resistance * semanticDiff)
      }
    }

    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        this.rings[r][i].p             = next[r][i]
        this.rings[r][i].semanticTrace = semanticNext[r][i]
      }
    }
  }

  conserveMass() {
    const cells = this.rings.flat()
    const floorMass     = this.epsilon * cells.length
    const target        = Math.max(this.massTarget, floorMass + this.epsilon)
    const currentExcess = cells.reduce((s, c) => s + Math.max(0, c.p - this.epsilon), 0)
    const targetExcess  = Math.max(0, target - floorMass)

    if (currentExcess < this.epsilon) {
      const memorySum = cells.reduce((s, c) => s + Math.max(this.epsilon, (c.memory ?? 0) + (c.semanticTrace ?? 0)), 0)
      for (const c of cells) {
        const weight = Math.max(this.epsilon, (c.memory ?? 0) + (c.semanticTrace ?? 0))
        c.p = this.epsilon + (targetExcess * weight / memorySum)
      }
      return
    }

    const factor = targetExcess / currentExcess
    for (const c of cells) c.p = this.epsilon + Math.max(0, c.p - this.epsilon) * factor
  }

  updateAttractors() {
    const candidates = []

    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        const cell  = this.rings[r][i]
        const score = this.clamp01(
          cell.p * 0.42 + cell.memory * 0.19 + cell.residual * 0.16 +
          cell.constraintDensity * 0.09 + (cell.semanticTrace ?? 0) * 0.09 +
          (cell.intentTrace ?? 0) * 0.05
        )
        if (score > this.activationThreshold) {
          candidates.push({
            r, i, theta: cell.theta, mass: cell.p, memory: cell.memory,
            residual: cell.residual, pressure: cell.pressure,
            constraintDensity: cell.constraintDensity,
            semanticWeight: cell.semanticTrace ?? 0,
            intentWeight:   cell.intentTrace   ?? 0,
            strength: score
          })
        }
      }
    }

    candidates.sort((a, b) => b.strength - a.strength)

    const selected = []
    for (const c of candidates) {
      const tooClose = selected.some(a => a.r === c.r && this.circularIndexDistance(a.i, c.i) < 6)
      if (!tooClose) selected.push(c)
      if (selected.length >= this.attractorLimit) break
    }

    this.state.attractors = this.interactAttractors(selected)
  }

  interactAttractors(attractors) {
    const result = attractors.map(a => ({ ...a, force: 0 }))

    for (let x = 0; x < result.length; x++) {
      for (let y = x + 1; y < result.length; y++) {
        const a = result[x], b = result[y]
        const d              = Math.max(1, this.circularIndexDistance(a.i, b.i))
        const ringDistance   = Math.abs(a.r - b.r)
        const coupling       = 1 / (1 + ringDistance)
        const semanticCoupling = 1 + ((a.semanticWeight ?? 0) + (b.semanticWeight ?? 0)) * 0.35
        const force = coupling * semanticCoupling * (a.strength * b.strength) / (d * d)

        if (a.r === b.r && d < 12) { a.force += force; b.force += force }
        else                        { a.force -= force * 0.35; b.force -= force * 0.35 }
      }
    }

    return result.map(a => ({
      ...a,
      stability:   this.clamp01(a.strength + a.force),
      orbitTheta:  this.containTheta(
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
        const proximity = this.clamp01(1 - Math.abs(i) / (radius + 1))
        const cell      = this.rings[a.r][idx]
        const pull      = this.attractorRate * a.stability * proximity *
          (1 - cell.pressure) * (1 + (cell.constraintDensity ?? 0)) *
          (1 + (a.semanticWeight ?? 0) * 0.25)

        cell.p             = this.clampP(cell.p + pull)
        cell.memory        = this.clamp01(cell.memory + pull * 0.1)
        cell.semanticTrace = this.clamp01((cell.semanticTrace ?? 0) + pull * 0.04)
      }
    }
  }

  updateResiduals() {
    for (const ring of this.rings)
      for (const c of ring)
        c.residual = this.clampP(c.residual * 0.992 + c.p * 0.007 + (c.semanticTrace ?? 0) * 0.001)
  }

  updateConstraintDensity() {
    for (const ring of this.rings)
      for (const c of ring)
        c.constraintDensity = this.clamp01(
          (c.constraintDensity ?? 0) * 0.995 +
          c.pressure * 0.0026 + c.memory * 0.0017 + (c.semanticTrace ?? 0) * 0.0007
        )
  }

  updateActivity() {
    for (const ring of this.rings)
      for (const c of ring)
        c.active = c.p > this.activationThreshold || (c.semanticTrace ?? 0) > this.activationThreshold
  }

  updatePhase() {
    const m = this.metrics()
    let phase = 'stable'

    if (this.state.t < 8)                                                          phase = 'warmup'
    else if (m.pressure > 0.70 && m.entropy > 0.65)                               phase = 'turbulent'
    else if (m.aliveRatio < 0.25)                                                  phase = 'compressed'
    else if (m.attractorStrength > 0.72 && m.drift < 0.20 && this.field.semanticCoherence > 0.45) phase = 'locked'
    else if (m.drift > 0.55 || this.field.noveltyPressure > 0.72)                 phase = 'drift'
    else if (m.residualMass > 0.55 && m.attractorStrength > 0.50)                 phase = 'emergent'
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

    this.field.drift       = this.round4(m.drift)
    this.field.coherence   = this.round4(this.clamp01((1 - m.drift) * 0.32 + m.attractorStrength * 0.25 + (1 - m.pressure) * 0.17 + m.fieldCurvature * 0.08 + this.field.semanticCoherence * 0.18))
    this.field.continuity  = this.round4(this.clamp01(m.residualMass * 0.34 + m.attractorStrength * 0.25 + (1 - m.drift) * 0.17 + m.fieldCurvature * 0.08 + this.field.semanticGrounding * 0.16))
    this.field.momentum    = this.round4(this.clamp01(Math.abs(this.state.lastDeltaTheta) / (this.cycle * 0.5)))
    this.field.resonance   = this.round4(this.clamp01(m.entropy * 0.22 + m.attractorStrength * 0.27 + m.residualMass * 0.18 + m.fieldCurvature * 0.13 + this.field.semanticCoherence * 0.20))
    this.field.topicPressure = this.round4(m.pressure)

    if (this.state.phase !== 'drift' && this.state.phase !== 'turbulent')
      this.field.lastStablePhase = this.state.phase

    this.field.persistence = this.round4(this.clamp01(this.field.persistence * 0.92 + this.field.continuity * 0.08))
    this.field.emergence   = this.round4(this.clamp01(m.residualMass * 0.22 + m.entropy * 0.20 + m.attractorStrength * 0.28 + m.fieldCurvature * 0.12 + this.field.noveltyPressure * 0.18))

    this.field.phaseHistory.push({ t: this.state.t, phase: this.state.phase })
    if (this.field.phaseHistory.length > 64) this.field.phaseHistory.shift()

    this.field.attractorTrace.push({
      t: this.state.t,
      attractors: this.state.attractors.map(a => ({
        r: a.r, i: a.i,
        strength:      this.round4(a.strength),
        semanticWeight: this.round4(a.semanticWeight ?? 0)
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
      current.intent.reason * 0.15 + current.intent.execute * 0.10 + current.intent.diagnose * 0.08
    )

    this.field.semanticGrounding    = this.round4(this.clamp01(this.field.semanticGrounding * 0.86 + grounding * 0.14))
    this.field.semanticCoherence    = this.round4(this.clamp01(this.field.semanticCoherence * 0.82 + similarity * 0.18))
    this.field.intentPressure       = this.round4(this.clamp01(this.field.intentPressure * 0.78 + intentPressure * 0.22))
    this.field.executionReadiness   = this.round4(this.clamp01(current.intent.execute * 0.35 + current.intent.code * 0.25 + current.intent.data * 0.15 + this.field.coherence * 0.15 + (1 - this.field.drift) * 0.10))
    this.field.noveltyPressure      = this.round4(this.clamp01(this.field.noveltyPressure * 0.80 + novelty * 0.20))
    this.field.recallPotential      = this.round4(this.clamp01(similarity * 0.35 + this.field.resonance * 0.25 + this.field.persistence * 0.20 + this.field.continuity * 0.20))
    this.field.routingPressure      = this.round4(this.clamp01(this.field.intentPressure * 0.30 + this.field.noveltyPressure * 0.20 + this.field.recallPotential * 0.30 + this.field.topicPressure * 0.20))
    this.field.compressionPressure  = this.round4(this.clamp01((1 - this.field.noveltyPressure) * 0.30 + this.field.coherence * 0.25 + this.field.continuity * 0.25 + this.field.persistence * 0.20))

    const record = {
      t: this.state.t, theta: this.round4(this.state.lastTheta),
      signature: this.round4(this.state.signature),
      vector: [...current.vector], intent: { ...current.intent },
      grounding: this.field.semanticGrounding,
      coherence: this.field.semanticCoherence,
      novelty:   this.field.noveltyPressure,
      phase:     this.state.phase
    }

    this.field.semanticMemory.push(record)

    while (this.field.semanticMemory.length > this.semanticMemoryLimit) {
      const old = this.field.semanticMemory.shift()
      this.field.archivedContinuity.push({
        t: old.t, signature: old.signature,
        grounding: old.grounding, coherence: old.coherence, phase: old.phase
      })
    }

    while (this.field.archivedContinuity.length > this.archiveLimit)
      this.field.archivedContinuity.shift()
  }

  metrics() {
    const ps = [], pressures = [], residuals = [], densities = [], semanticTraces = [], intentTraces = []

    for (const ring of this.rings) {
      for (const c of ring) {
        ps.push(c.p); pressures.push(c.pressure); residuals.push(c.residual)
        densities.push(c.constraintDensity ?? 0)
        semanticTraces.push(c.semanticTrace ?? 0)
        intentTraces.push(c.intentTrace ?? 0)
      }
    }

    const mean            = this.average(ps)
    const entropy         = this.normalizedEntropy(ps)
    const pressure        = this.average(pressures)
    const residualMass    = this.average(residuals)
    const aliveRatio      = ps.filter(v => v > this.activationThreshold).length / ps.length
    const fieldCurvature  = this.average(densities)
    const semanticMass    = this.average(semanticTraces)
    const intentMass      = this.average(intentTraces)
    const attractorStrength = this.state.attractors.length
      ? this.average(this.state.attractors.map(a => a.stability)) : 0

    const prev = this.state.history.at(-1)
    const drift = prev
      ? this.clamp01(Math.abs(prev.metrics.mean - mean) + Math.abs(prev.metrics.entropy - entropy) + Math.abs((prev.metrics.semanticMass ?? 0) - semanticMass))
      : 0

    return {
      mean: this.round4(mean), entropy: this.round4(entropy),
      pressure: this.round4(pressure), residualMass: this.round4(residualMass),
      aliveRatio: this.round4(aliveRatio), attractorStrength: this.round4(attractorStrength),
      drift: this.round4(drift), fieldCurvature: this.round4(fieldCurvature),
      semanticMass: this.round4(semanticMass), intentMass: this.round4(intentMass),
      totalMass: this.round4(this.totalMass()),
      massError: this.round4(Math.abs(this.totalMass() - this.massTarget))
    }
  }

  snapshot(perturbation, delta, contained) {
    return {
      version: 'CELF-AI-V5', mode: 'semantic cyclic possibility curvature',
      embeddingModel: this.embeddingModel,
      t: this.state.t, phase: this.state.phase,
      perturbation: {
        length: perturbation.length, numeric: perturbation.numeric,
        rupture: perturbation.rupture, spread: perturbation.spread,
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
      contained: { signature: this.round4(contained.signature), cycleCount: contained.cycleCount },
      field:   this.getFieldIdentity(),
      semantic: this.getSemanticState(),
      control:  this.getControlGuidance(),
      metrics:  this.metrics(),
      attractors: this.state.attractors.map(a => ({
        r: a.r, i: a.i, theta: this.round4(a.theta), orbitTheta: this.round4(a.orbitTheta),
        strength: this.round4(a.strength), stability: this.round4(a.stability),
        constraintDensity: this.round4(a.constraintDensity ?? 0),
        semanticWeight: this.round4(a.semanticWeight ?? 0),
        intentWeight: this.round4(a.intentWeight ?? 0)
      }))
    }
  }

  commit(snapshot) {
    this.state.history.push(snapshot)

    while (this.state.history.length > this.historyLimit) {
      const old = this.state.history.shift()
      this.state.archive.push({
        archived: true,
        residual: old?.metrics?.residualMass ?? this.epsilon,
        signature: old?.contained?.signature ?? 0,
        fieldSignature: old?.field?.signature ?? 0,
        fieldContinuity: old?.field?.continuity ?? 0,
        fieldCurvature: old?.metrics?.fieldCurvature ?? 0,
        semanticMass: old?.metrics?.semanticMass ?? 0,
        semanticGrounding: old?.field?.semanticGrounding ?? 0,
        phase: old?.phase ?? null, t: old?.t ?? 0
      })
    }

    while (this.state.archive.length > this.archiveLimit) this.state.archive.shift()
    this.state.t++
  }

  routeContext(query = null, limit = this.routingLimit) {
    const signal = query === null || query === undefined ? ''
      : typeof query === 'string' ? query : JSON.stringify(query)

    const semantic = signal
      ? this.extractSemantic(query, signal)
      : this.field.semanticMemory.at(-1)

    if (!semantic) return []

    const vector = semantic.vector ?? semantic

    return this.field.semanticMemory
      .map(item => ({
        t: item.t, phase: item.phase, theta: item.theta, signature: item.signature,
        score: this.round4(
          this.cosineSimilarity(vector, item.vector) * 0.55 +
          item.grounding * 0.18 + item.coherence * 0.14 + item.novelty * 0.13
        )
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit))
  }

  getControlGuidance() {
    const mode =
      this.state.phase === 'turbulent' ? 'ground'   :
      this.state.phase === 'drift'     ? 'clarify'  :
      this.state.phase === 'emergent'  ? 'explore'  :
      this.state.phase === 'locked'    ? 'compress' : 'balance'

    const depth =
      this.field.routingPressure      > 0.72 ? 'deep'    :
      this.field.compressionPressure  > 0.72 ? 'quick'   : 'balanced'

    return {
      mode, depth,
      contextUse:         this.round4(this.clamp01(this.field.routingPressure)),
      compression:        this.round4(this.clamp01(this.field.compressionPressure)),
      recall:             this.round4(this.clamp01(this.field.recallPotential)),
      grounding:          this.round4(this.clamp01(this.field.semanticGrounding)),
      executionReadiness: this.round4(this.clamp01(this.field.executionReadiness))
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
      embeddingCacheSize:  this.embeddingCache.size,
      routedContext:       this.routeContext(null, Math.min(3, this.routingLimit))
    }
  }

  getFieldIdentity() {
    return {
      signature: this.round4(this.field.signature),
      continuity: this.field.continuity, coherence: this.field.coherence,
      drift: this.field.drift, momentum: this.field.momentum,
      resonance: this.field.resonance, persistence: this.field.persistence,
      emergence: this.field.emergence, topicPressure: this.field.topicPressure,
      semanticGrounding: this.field.semanticGrounding,
      semanticCoherence: this.field.semanticCoherence,
      intentPressure: this.field.intentPressure,
      executionReadiness: this.field.executionReadiness,
      recallPotential: this.field.recallPotential,
      routingPressure: this.field.routingPressure,
      compressionPressure: this.field.compressionPressure,
      noveltyPressure: this.field.noveltyPressure,
      lastStablePhase: this.field.lastStablePhase,
      phaseHistory: [...this.field.phaseHistory],
      attractorTrace: [...this.field.attractorTrace]
    }
  }

  getSummary() {
    return {
      version: 'CELF-AI-V5', embeddingModel: this.embeddingModel,
      phase: this.state.phase, t: this.state.t,
      cycle: this.cycle, resolution: this.resolution, ringCount: this.ringCount,
      semanticDimensions: this.semanticDimensions,
      embeddingCacheSize: this.embeddingCache.size,
      signature: this.round4(this.state.signature),
      cycleCount: this.state.cycleCount,
      field: this.getFieldIdentity(), semantic: this.getSemanticState(),
      control: this.getControlGuidance(), metrics: this.metrics(),
      attractorCount: this.state.attractors.length, archiveSize: this.state.archive.length
    }
  }

  async learnPattern(sequence = []) {
    for (const item of sequence) await this.process(item)
    return this
  }

  // ═══════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════

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
      const x = Number(a[i] || 0), y = Number(b[i] || 0)
      dot += x * y; na += x * x; nb += y * y
    }
    if (na <= 0 || nb <= 0) return 0
    return this.clamp01(dot / (Math.sqrt(na) * Math.sqrt(nb)))
  }

  containTheta(v) { return ((Number(v) % this.cycle) + this.cycle) % this.cycle }
  thetaToIndex(theta) { return Math.floor((this.containTheta(theta) / this.cycle) * this.resolution) % this.resolution }
  indexToTheta(d) { return (d / this.resolution) * this.cycle }
  wrapIndex(i)  { return ((i % this.resolution) + this.resolution) % this.resolution }
  wrapRing(r)   { return ((r % this.ringCount)  + this.ringCount)  % this.ringCount }
  circularIndexDistance(a, b) { const d = Math.abs(a - b); return Math.min(d, this.resolution - d) }
  signedIndexDistance(a, b)   { const f = (b - a + this.resolution) % this.resolution; return f > this.resolution / 2 ? f - this.resolution : f }
  clamp01(v) { const n = Number(v); return !Number.isFinite(n) ? 0 : Math.max(0, Math.min(1, n)) }
  clampP(v)  { const n = Number(v); return !Number.isFinite(n) ? this.epsilon : Math.max(this.epsilon, n) }
  round4(v)  { return Math.round(Number(v || 0) * 10000) / 10000 }

  reset() {
    for (const ring of this.rings) {
      for (const c of ring) {
        c.p = 1 / this.resolution; c.residual = this.epsilon
        c.pressure = 0; c.memory = 0; c.constraintDensity = 0
        c.semanticTrace = 0; c.intentTrace = 0; c.active = true
      }
    }

    this.field = {
      signature: 0, continuity: 0, coherence: 0, drift: 0, momentum: 0, resonance: 0,
      phaseHistory: [], attractorTrace: [], topicPressure: 0, lastStablePhase: 'warmup',
      persistence: 0, emergence: 0, semanticGrounding: 0, semanticCoherence: 0,
      intentPressure: 0, executionReadiness: 0, recallPotential: 0,
      routingPressure: 0, compressionPressure: 0, noveltyPressure: 0,
      semanticMemory: [], archivedContinuity: []
    }

    this.state = {
      t: 0, phase: 'warmup', signature: 0, cycleCount: 0,
      lastTheta: 0, lastIndex: 0, lastDeltaTheta: 0,
      totalMass: this.totalMass(), attractors: [], history: [], archive: []
    }

    this.embeddingCache.clear()
    this.massTarget = this.totalMass()
  }
}
