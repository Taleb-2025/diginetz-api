export class CELF_Engine_V8 {

  // ─── Core State ───────────────────────────────────────────────
  #space
  #resolution
  #cycle
  #signature
  #pos
  #step

  // ─── Delta Ring Buffer ────────────────────────────────────────
  #deltaBuffer
  #bufferSize
  #bufferHead
  #bufferCount

  // ─── Signature Map ────────────────────────────────────────────
  #sigMap
  #sigMapMaxSize

  // ─── Hyperparameters ──────────────────────────────────────────
  #decayRate
  #thresholdFactor
  #eliminationRate
  #reinforceRate
  #threshold
  #sigWeight

  // ─── Stats Cache ──────────────────────────────────────────────
  #cachedAvg
  #cachedStd
  #cacheValid
  #cacheAge
  #cacheMaxAge

  // ─── Reach Cache ──────────────────────────────────────────────
  #reachCache
  #reachCachePos
  #reachCacheStep

  // ─── Phase System ─────────────────────────────────────────────
  #minWarmupSteps
  #maturityWindow
  #maturityTolerance
  #aliveHistory
  #aliveHistoryHead
  #aliveHistoryCount

  // ─── Confidence ───────────────────────────────────────────────
  #localRadius
  #confidenceThreshold

  // ─── FIX 2: Adaptive Weights ──────────────────────────────────
  // Each dimension tracks its own prediction accuracy.
  // After every observe(), if the dimension predicted "safe" but
  // impossible=true → its weight decreases (it was wrong).
  // If it predicted "risky" and impossible=true → weight increases.
  // Weights are renormalised after every update so they always sum to 1.
  #wRepetition
  #wLocalDensity
  #wTrend
  #wSignature
  #wLearningRate     // how fast weights adapt (0 = frozen, 1 = instant)

  // ─── FIX 3: Threshold Smoothing ───────────────────────────────
  // Instead of jumping from Infinity → computed threshold,
  // we interpolate using maturityScore ∈ [0, 1].
  // maturityScore rises gradually as aliveRatio stabilises.
  #smoothedThreshold     // exponential moving average of raw threshold
  #thresholdEMA          // EMA smoothing factor
  #maturityScore         // 0 → warmup, 1 → fully active

  constructor(options = {}) {
    this.#resolution      = options.resolution      ?? 360
    this.#cycle           = options.cycle           ?? 360
    this.#bufferSize      = options.windowSize      ?? 128
    this.#decayRate       = options.decayRate       ?? 0.997
    this.#thresholdFactor = options.thresholdFactor ?? 2.0
    this.#eliminationRate = options.eliminationRate ?? 0.25
    this.#reinforceRate   = options.reinforceRate   ?? 0.04
    this.#threshold       = options.threshold       ?? 0.04
    this.#sigWeight       = options.sigWeight       ?? 0.3
    this.#sigMapMaxSize   = options.sigMapMaxSize   ?? 512
    this.#cacheMaxAge     = options.cacheMaxAge     ?? 8

    // Phase
    this.#minWarmupSteps    = options.minWarmupSteps    ?? 30
    this.#maturityWindow    = options.maturityWindow    ?? 20
    this.#maturityTolerance = options.maturityTolerance ?? 0.03

    // Confidence
    this.#localRadius         = options.localRadius         ?? 5
    this.#confidenceThreshold = options.confidenceThreshold ?? 0.40

    // FIX 2 — Adaptive weights (initial values, will self-tune)
    this.#wRepetition   = options.wRepetition   ?? 0.35
    this.#wLocalDensity = options.wLocalDensity ?? 0.25
    this.#wTrend        = options.wTrend        ?? 0.20
    this.#wSignature    = options.wSignature    ?? 0.20
    this.#wLearningRate = options.wLearningRate ?? 0.05
    this.#normaliseWeights()   // ensure they sum to 1 from the start

    // FIX 3 — Threshold smoothing
    this.#smoothedThreshold = Infinity
    this.#thresholdEMA      = options.thresholdEMA ?? 0.15
    this.#maturityScore     = 0

    // Core arrays
    this.#space       = new Float32Array(this.#resolution).fill(0.5)
    this.#deltaBuffer = new Float32Array(this.#bufferSize)
    this.#bufferHead  = 0
    this.#bufferCount = 0

    this.#sigMap = new Map()

    this.#signature = 0
    this.#pos       = 0
    this.#step      = 0

    this.#cachedAvg  = 0
    this.#cachedStd  = 0
    this.#cacheValid = false
    this.#cacheAge   = Infinity

    this.#reachCache     = this.#resolution * 0.25
    this.#reachCachePos  = -1
    this.#reachCacheStep = -1

    this.#aliveHistory      = new Float32Array(this.#maturityWindow)
    this.#aliveHistoryHead  = 0
    this.#aliveHistoryCount = 0
  }

  // ═══════════════════════════════════════════════════════════════
  // FIX 1 — CANTOR PAIRING sigKey (replaces Math.round collision)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Cantor pairing function: maps two non-negative integers (a, b)
   * to a unique integer. No two different pairs produce the same key.
   *
   * Old: Math.round(sig) loses precision → different sigs → same key
   * New: sig is bucketed into 8 sub-bins per integer → 8× resolution
   *      then Cantor-paired with fromIdx → zero collisions
   */
  #sigKey(sig, fromIdx) {
    // Quantise sig to 8 sub-bins (keeps fractional info, stays integer)
    const s = Math.round(sig * 8)
    const f = fromIdx
    // Cantor pairing: (s + f)(s + f + 1)/2 + f
    const sf = s + f
    return (sf * (sf + 1) / 2) + f
  }

  // ═══════════════════════════════════════════════════════════════
  // FIX 2 — ADAPTIVE WEIGHTS
  // ═══════════════════════════════════════════════════════════════

  #normaliseWeights() {
    const total = this.#wRepetition + this.#wLocalDensity +
                  this.#wTrend      + this.#wSignature
    if (total < 1e-9) {
      // Fallback to equal weights if all zeroed
      this.#wRepetition   = 0.25
      this.#wLocalDensity = 0.25
      this.#wTrend        = 0.25
      this.#wSignature    = 0.25
      return
    }
    this.#wRepetition   /= total
    this.#wLocalDensity /= total
    this.#wTrend        /= total
    this.#wSignature    /= total
  }

  /**
   * Called after every observe() with the outcome.
   *
   * Logic per dimension:
   *   predicted "safe"  (component score > 0.5) but was impossible
   *     → dimension was overconfident → weight DOWN
   *   predicted "risky" (component score < 0.5) and was impossible
   *     → dimension was correct        → weight UP
   *   not impossible
   *     → no signal to learn from (could be true negative or false negative)
   *     → small regression toward equal weight to avoid drift
   *
   * lr = #wLearningRate controls adaptation speed.
   */
  #adaptWeights(components, wasImpossible) {
    const lr = this.#wLearningRate
    const { repetition, localDensity, trend, signatureSupport } = components

    if (wasImpossible) {
      // Reward dimensions that predicted danger, penalise those that didn't
      this.#wRepetition   += lr * (repetition        < 0.5 ?  1 : -1) * 0.25
      this.#wLocalDensity += lr * (localDensity      < 0.5 ?  1 : -1) * 0.25
      this.#wTrend        += lr * (trend             < 0.5 ?  1 : -1) * 0.25
      this.#wSignature    += lr * (signatureSupport  < 0.5 ?  1 : -1) * 0.25
    } else {
      // Gentle regression toward equal weight (0.25 each) to avoid freezing
      const reg = lr * 0.1
      this.#wRepetition   += reg * (0.25 - this.#wRepetition)
      this.#wLocalDensity += reg * (0.25 - this.#wLocalDensity)
      this.#wTrend        += reg * (0.25 - this.#wTrend)
      this.#wSignature    += reg * (0.25 - this.#wSignature)
    }

    // Clamp to [0.05, 0.70] — no dimension dominates or vanishes
    this.#wRepetition   = Math.max(0.05, Math.min(0.70, this.#wRepetition))
    this.#wLocalDensity = Math.max(0.05, Math.min(0.70, this.#wLocalDensity))
    this.#wTrend        = Math.max(0.05, Math.min(0.70, this.#wTrend))
    this.#wSignature    = Math.max(0.05, Math.min(0.70, this.#wSignature))

    this.#normaliseWeights()
  }

  // ═══════════════════════════════════════════════════════════════
  // FIX 3 — THRESHOLD SMOOTHING
  // ═══════════════════════════════════════════════════════════════

  /**
   * maturityScore ∈ [0, 1]
   *   0 = warmup (aliveRatio volatile, no history)
   *   1 = fully mature (aliveRatio stable for maturityWindow steps)
   *
   * Computed from the spread of recent aliveRatio values:
   *   spread = max - min over last maturityWindow steps
   *   score  = 1 - clamp(spread / maturityTolerance, 0, 1)
   *
   * This gives a continuous 0→1 signal instead of a binary flip.
   */
  #computeMaturityScore() {
    if (this.#aliveHistoryCount < 2) return 0

    const n = this.#aliveHistoryCount
    let min = Infinity, max = -Infinity
    for (let i = 0; i < n; i++) {
      const v = this.#aliveHistory[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    const spread = max - min
    // Penalise for being below full maturityWindow
    const coverageFactor = n / this.#maturityWindow
    const stabilityScore = Math.max(0, 1 - spread / (this.#maturityTolerance + 1e-9))
    return Math.min(1, stabilityScore * coverageFactor)
  }

  /**
   * Smooth threshold: blends Infinity (no restriction) → computed threshold.
   *
   * During warmup:   maturityScore ≈ 0 → threshold stays very high
   * During learning: maturityScore rises → threshold lowers gradually
   * During active:   maturityScore ≈ 1 → threshold = computed value
   *
   * Additionally we apply an EMA on the computed threshold itself
   * to avoid sudden jumps when stats change.
   */
  #getSmoothedThreshold(rawThreshold, valid) {
    if (!valid) return Infinity

    // Update EMA of raw threshold
    if (!isFinite(this.#smoothedThreshold)) {
      this.#smoothedThreshold = rawThreshold
    } else {
      this.#smoothedThreshold =
        this.#thresholdEMA * rawThreshold +
        (1 - this.#thresholdEMA) * this.#smoothedThreshold
    }

    // Blend: low maturity → high threshold (permissive), high → smoothed value
    const score = this.#maturityScore
    // lerp from a "wide" threshold toward the smoothed one
    const wideThreshold = this.#smoothedThreshold * (3 - 2 * score)  // 3× → 1× as score 0→1
    return wideThreshold
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE SYSTEM
  // ═══════════════════════════════════════════════════════════════

  #getPhase() {
    if (this.#step < this.#minWarmupSteps) return 'warmup'
    if (!this.#isMature())                 return 'learning'
    return 'active'
  }

  #isMature() {
    return this.#maturityScore >= 0.95
  }

  #pushAliveRatio(ratio) {
    this.#aliveHistory[this.#aliveHistoryHead] = ratio
    this.#aliveHistoryHead = (this.#aliveHistoryHead + 1) % this.#maturityWindow
    if (this.#aliveHistoryCount < this.#maturityWindow) this.#aliveHistoryCount++
    // Update maturityScore after each new data point
    this.#maturityScore = this.#computeMaturityScore()
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIDENCE SYSTEM
  // ═══════════════════════════════════════════════════════════════

  #computeConfidence(idx, jump, nextSig) {
    // 1. Repetition
    const repetition = Math.min(1, this.#space[idx])

    // 2. Local Density (weighted by proximity)
    let neighborSum = 0, neighborCount = 0
    for (let d = 1; d <= this.#localRadius; d++) {
      const left   = (idx - d + this.#resolution) % this.#resolution
      const right  = (idx + d) % this.#resolution
      const weight = 1 - (d / (this.#localRadius + 1))
      neighborSum   += (this.#space[left] + this.#space[right]) * weight
      neighborCount += 2 * weight
    }
    const localDensity = neighborCount > 0 ? Math.min(1, neighborSum / neighborCount) : 0

    // 3. Trend
    const trend = this.#computeTrend(jump)

    // 4. Signature Support
    const sigT = this.#sigThreshold(nextSig, this.#pos)
    const signatureSupport = sigT === null
      ? 0.5
      : Math.max(0, Math.min(1, 1 - jump / (sigT + 1)))

    // Weighted sum with current (adaptive) weights
    const score =
      this.#wRepetition   * repetition        +
      this.#wLocalDensity * localDensity       +
      this.#wTrend        * trend              +
      this.#wSignature    * signatureSupport

    return {
      score:            Math.round(score             * 1000) / 1000,
      repetition:       Math.round(repetition        * 1000) / 1000,
      localDensity:     Math.round(localDensity      * 1000) / 1000,
      trend:            Math.round(trend             * 1000) / 1000,
      signatureSupport: Math.round(signatureSupport  * 1000) / 1000
    }
  }

  #computeTrend(jump) {
    const n = this.#bufferCount
    if (n < 4) return 0.5

    // Use cached avg from #stats if fresh, else compute inline
    const { avg: cachedAvg, valid } = this.#stats()
    const avgJump = valid ? cachedAvg : (() => {
      let s = 0
      for (let i = 0; i < n; i++) {
        const ri = (this.#bufferHead - n + i + this.#bufferSize) % this.#bufferSize
        s += this.#deltaBuffer[ri]
      }
      return s / n
    })()

    if (avgJump < 0.001) return 0.5
    return Math.max(0, Math.min(1, 1 - jump / (avgJump * 2)))
  }

  // ═══════════════════════════════════════════════════════════════
  // INTERNALS (sigMap, buffer, stats, reach, decay)
  // ═══════════════════════════════════════════════════════════════

  #toIndex(v) {
    const norm = (((v % this.#cycle) + this.#cycle) % this.#cycle) / this.#cycle
    return Math.min(this.#resolution - 1, Math.floor(norm * this.#resolution))
  }

  #toValue(idx) {
    return (idx / this.#resolution) * this.#cycle
  }

  #dist(a, b) {
    const d = Math.abs(b - a)
    return Math.min(d, this.#resolution - d)
  }

  #signedDist(a, b) {
    const forward = ((b - a) + this.#resolution) % this.#resolution
    return forward > this.#resolution / 2 ? forward - this.#resolution : forward
  }

  #computeNextSignature(prev, next, delta) {
    const PHI = 1.6180339887
    const raw = (this.#signature * PHI) + (next * 0.5) + (delta * 0.3) + (prev * 0.2)
    return ((raw % this.#resolution) + this.#resolution) % this.#resolution
  }

  #recordSigTransition(sig, fromIdx, jump) {
    const key      = this.#sigKey(sig, fromIdx)
    const existing = this.#sigMap.get(key)

    if (existing) {
      this.#sigMap.delete(key)
      existing.n += 1
      const d = jump - existing.mean
      existing.mean += d / existing.n
      existing.M2   += d * (jump - existing.mean)
      this.#sigMap.set(key, existing)
    } else {
      if (this.#sigMap.size >= this.#sigMapMaxSize) {
        const oldest = this.#sigMap.keys().next().value
        this.#sigMap.delete(oldest)
      }
      this.#sigMap.set(key, { mean: jump, M2: 0, n: 1 })
    }
  }

  #sigThreshold(sig, fromIdx) {
    const key = this.#sigKey(sig, fromIdx)
    const rec = this.#sigMap.get(key)
    if (!rec || rec.n < 3) return null

    const std = Math.sqrt(Math.max(0, rec.M2 / (rec.n - 1)))
    return rec.mean + this.#thresholdFactor * std
  }

  #pushDelta(d) {
    this.#deltaBuffer[this.#bufferHead] = d
    this.#bufferHead = (this.#bufferHead + 1) % this.#bufferSize
    if (this.#bufferCount < this.#bufferSize) this.#bufferCount++
    this.#cacheAge++
  }

  #stats() {
    if (this.#cacheAge < this.#cacheMaxAge && this.#cacheValid) {
      return { avg: this.#cachedAvg, std: this.#cachedStd, valid: true }
    }

    const n = this.#bufferCount
    if (n < 4) return { avg: 0, std: 0, valid: false }

    // Single-pass Welford
    let mean = 0, M2 = 0
    for (let i = 0; i < n; i++) {
      const ri = (this.#bufferHead - n + i + this.#bufferSize) % this.#bufferSize
      const x  = this.#deltaBuffer[ri]
      const dm = x - mean
      mean    += dm / (i + 1)
      M2      += dm * (x - mean)
    }
    const std = Math.sqrt(M2 / (n - 1))

    this.#cachedAvg  = mean
    this.#cachedStd  = std
    this.#cacheValid = std > 0.01
    this.#cacheAge   = 0

    return { avg: mean, std, valid: this.#cacheValid }
  }

  #reach(fromIdx) {
    if (
      this.#reachCachePos  === fromIdx &&
      this.#reachCacheStep >= this.#step - this.#cacheMaxAge
    ) return this.#reachCache

    let wSum = 0, wTotal = 0
    for (let i = 0; i < this.#resolution; i++) {
      const density = this.#space[i]
      if (density > this.#threshold) {
        wSum   += this.#dist(fromIdx, i) * density
        wTotal += density
      }
    }

    const result = wTotal < 0.01
      ? this.#resolution * 0.25
      : Math.max(2, wSum / wTotal)

    this.#reachCache     = result
    this.#reachCachePos  = fromIdx
    this.#reachCacheStep = this.#step
    return result
  }

  #decay() {
    for (let i = 0; i < this.#resolution; i++) {
      const s = this.#space[i]
      this.#space[i] *= this.#decayRate + (1 - this.#decayRate) * s * 0.5
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OBSERVE
  // ═══════════════════════════════════════════════════════════════

  observe(value) {
    if (!Number.isFinite(value)) return { ok: false, error: 'non-finite value' }

    const idx     = this.#toIndex(value)
    const delta   = this.#signedDist(this.#pos, idx)
    const jump    = Math.abs(delta)
    const nextSig = this.#computeNextSignature(this.#pos, idx, delta)

    const { avg, std, valid } = this.#stats()
    const rawThreshold    = valid ? avg + this.#thresholdFactor * std : Infinity

    // FIX 3 — smoothed threshold (gradual, no sudden jump)
    const threshold = this.#getSmoothedThreshold(
      this.#combinedThreshold(rawThreshold, nextSig, this.#pos, valid),
      valid
    )

    this.#recordSigTransition(nextSig, this.#pos, jump)
    this.#pushDelta(jump)

    const phase      = this.#getPhase()
    const confidence = this.#computeConfidence(idx, jump, nextSig)

    let impossible    = false
    let inferredCount = 0

    // ── WARMUP ────────────────────────────────────────────────
    if (phase === 'warmup') {
      const weakRate = this.#reinforceRate * 0.3
      this.#space[idx] = Math.min(1, this.#space[idx] + weakRate)

    // ── LEARNING ──────────────────────────────────────────────
    } else if (phase === 'learning') {
      const jumpExcessive = isFinite(threshold) && jump > threshold
      const lowConfidence = confidence.score < this.#confidenceThreshold

      if (jumpExcessive && lowConfidence) {
        impossible = true
        for (let i = 0; i < this.#resolution; i++) {
          if (this.#space[i] <= this.#threshold) continue
          const dToTarget    = this.#dist(i, idx)
          const couldExplain = Math.abs(dToTarget - jump) <= threshold * 0.5
          if (!couldExplain) {
            const excess = Math.min(1, Math.abs(dToTarget - jump) / this.#resolution)
            this.#space[i] = Math.max(0, this.#space[i] - excess * this.#eliminationRate * 0.5)
            inferredCount++
          }
        }
      } else if (confidence.score >= this.#confidenceThreshold) {
        const reach  = this.#reach(this.#pos)
        const radius = Math.max(2, Math.floor(reach * 0.35))
        for (let i = 0; i < this.#resolution; i++) {
          const d = this.#dist(i, idx)
          if (d <= radius) {
            const rate = this.#reinforceRate * confidence.score
            this.#space[i] = Math.min(1, this.#space[i] + (1 - d / radius) * rate)
          }
        }
      }
      // else: quarantine — no reinforce, no flag

    // ── ACTIVE ────────────────────────────────────────────────
    } else {
      const jumpExcessive = isFinite(threshold) && jump > threshold
      const destDead      = this.#space[idx] <= this.#threshold
      const lowConfidence = confidence.score < this.#confidenceThreshold

      if (jumpExcessive && (destDead || lowConfidence)) {
        impossible = true
        for (let i = 0; i < this.#resolution; i++) {
          if (this.#space[i] <= this.#threshold) continue
          const dToTarget    = this.#dist(i, idx)
          const couldExplain = Math.abs(dToTarget - jump) <= threshold * 0.5
          if (!couldExplain) {
            const excess  = Math.min(1, Math.abs(dToTarget - jump) / this.#resolution)
            this.#space[i] = Math.max(0, this.#space[i] - excess * this.#eliminationRate)
            inferredCount++
          }
        }
      } else {
        const reach  = this.#reach(this.#pos)
        const radius = Math.max(2, Math.floor(reach * 0.35))
        for (let i = 0; i < this.#resolution; i++) {
          const d = this.#dist(i, idx)
          if (d <= radius) {
            const rate = this.#reinforceRate * Math.max(0.1, confidence.score)
            this.#space[i] = Math.min(1, this.#space[i] + (1 - d / radius) * rate)
          }
        }
      }
    }

    this.#decay()

    const aliveRatio = this.getAliveRatio()
    this.#pushAliveRatio(aliveRatio)

    // FIX 2 — adapt weights based on this observation's outcome
    if (phase !== 'warmup') {
      this.#adaptWeights(confidence, impossible)
    }

    this.#signature = nextSig
    this.#pos       = idx
    this.#step++

    return {
      ok:            true,
      impossible,
      phase,
      maturityScore: Math.round(this.#maturityScore * 1000) / 1000,
      confidence:    confidence.score,
      jump:          Math.round(jump      * 100) / 100,
      threshold:     isFinite(threshold)
                       ? Math.round(threshold * 100) / 100
                       : null,
      inferredFrom:  inferredCount,
      aliveRatio,
      step:          this.#step
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST
  // ═══════════════════════════════════════════════════════════════

  test(value) {
    if (!Number.isFinite(value)) return { allowed: false, reason: 'invalid' }

    const idx      = this.#toIndex(value)
    const delta    = this.#signedDist(this.#pos, idx)
    const jump     = Math.abs(delta)
    const nextSig  = this.#computeNextSignature(this.#pos, idx, delta)
    const cellDead = this.#space[idx] <= this.#threshold

    const { avg, std, valid } = this.#stats()
    const rawThreshold = valid ? avg + this.#thresholdFactor * std : Infinity
    const threshold    = this.#getSmoothedThreshold(
      this.#combinedThreshold(rawThreshold, nextSig, this.#pos, valid),
      valid
    )
    const tooFar = isFinite(threshold) && jump > threshold

    const phase      = this.#getPhase()
    const confidence = this.#computeConfidence(idx, jump, nextSig)

    let allowed, reason
    if (phase === 'warmup') {
      allowed = true
      reason  = 'warmup'
    } else if (phase === 'learning') {
      const bad = tooFar && confidence.score < this.#confidenceThreshold
      allowed   = !bad
      reason    = bad ? 'low_confidence_jump' : 'ok'
    } else {
      const bad = tooFar && (cellDead || confidence.score < this.#confidenceThreshold)
      allowed   = !bad
      reason    = cellDead ? 'cell_eliminated'
                : tooFar   ? 'jump_exceeds_threshold'
                :            'ok'
    }

    return {
      allowed,
      reason,
      phase,
      maturityScore: Math.round(this.#maturityScore * 1000) / 1000,
      confidence:    confidence.score,
      cellDensity:   Math.round(this.#space[idx] * 1000) / 1000,
      jump:          Math.round(jump * 100) / 100,
      threshold:     isFinite(threshold) ? Math.round(threshold * 100) / 100 : null,
      signature:     Math.round(nextSig * 100) / 100
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // COMBINED THRESHOLD (internal helper)
  // ═══════════════════════════════════════════════════════════════

  #combinedThreshold(globalThreshold, nextSig, fromIdx, valid) {
    const sigT = this.#sigThreshold(nextSig, fromIdx)
    if (sigT === null || !valid) return globalThreshold
    return globalThreshold * (1 - this.#sigWeight) + sigT * this.#sigWeight
  }

  // ═══════════════════════════════════════════════════════════════
  // REVERSE INFER
  // ═══════════════════════════════════════════════════════════════

  reverseInfer(value) {
    if (!Number.isFinite(value)) return []

    const idx = this.#toIndex(value)
    const { avg, std, valid } = this.#stats()

    const candidates = []
    let totalWeight = 0

    for (let i = 0; i < this.#resolution; i++) {
      if (this.#space[i] <= this.#threshold) continue
      const d = this.#dist(i, idx)
      if (valid && d > avg + this.#thresholdFactor * std) continue

      const sigT   = this.#sigThreshold(this.#signature, i)
      const sigFit = sigT === null ? 1 : Math.max(0, 1 - d / (sigT + 1))
      const w      = this.#space[i] * sigFit
      totalWeight += w

      candidates.push({
        value:    Math.round(this.#toValue(i) * 100) / 100,
        _raw:     this.#space[i],
        sigFit,
        distance: Math.round(d * 100) / 100,
        _w:       w
      })
    }

    return candidates
      .sort((a, b) => b._w - a._w)
      .map(c => ({
        value:       c.value,
        probability: Math.round((totalWeight > 0 ? c._w / totalWeight : 0) * 1000) / 1000,
        sigFit:      Math.round(c.sigFit * 1000) / 1000,
        distance:    c.distance
      }))
  }

  // ═══════════════════════════════════════════════════════════════
  // FILTER / GETTERS
  // ═══════════════════════════════════════════════════════════════

  filter(values) {
    if (!Array.isArray(values)) return []
    return values.filter(v => Number.isFinite(v) && this.test(v).allowed)
  }

  getAliveRatio() {
    let alive = 0
    for (let i = 0; i < this.#resolution; i++) {
      if (this.#space[i] > this.#threshold) alive++
    }
    return Math.round((alive / this.#resolution) * 1000) / 1000
  }

  getPhase()         { return this.#getPhase() }
  isMature()         { return this.#isMature() }
  getMaturityScore() { return Math.round(this.#maturityScore * 1000) / 1000 }
  getPosition()      { return this.#toValue(this.#pos) }
  getSignature()     { return Math.round(this.#signature * 1000) / 1000 }
  getStep()          { return this.#step }
  getSpace()         { return Array.from(this.#space).map(v => Math.round(v * 1000) / 1000) }

  getWeights() {
    return {
      repetition:   Math.round(this.#wRepetition   * 1000) / 1000,
      localDensity: Math.round(this.#wLocalDensity * 1000) / 1000,
      trend:        Math.round(this.#wTrend        * 1000) / 1000,
      signature:    Math.round(this.#wSignature    * 1000) / 1000
    }
  }

  getSummary() {
    const { avg, std, valid } = this.#stats()
    return {
      version:       8,
      step:          this.#step,
      phase:         this.#getPhase(),
      mature:        this.#isMature(),
      maturityScore: this.getMaturityScore(),
      position:      this.getPosition(),
      signature:     this.getSignature(),
      aliveRatio:    this.getAliveRatio(),
      compression:   Math.round((1 - this.getAliveRatio()) * 1000) / 1000,
      sigContexts:   this.#sigMap.size,
      weights:       this.getWeights(),
      stats:         valid
        ? { avg: Math.round(avg * 100) / 100, std: Math.round(std * 100) / 100 }
        : null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SERIALIZE / RESTORE
  // ═══════════════════════════════════════════════════════════════

  serialize() {
    const sigMapArr = []
    for (const [k, v] of this.#sigMap.entries()) sigMapArr.push([k, v])

    const n = this.#bufferCount
    const orderedDeltas = []
    for (let i = 0; i < n; i++) {
      const ri = (this.#bufferHead - n + i + this.#bufferSize) % this.#bufferSize
      orderedDeltas.push(this.#deltaBuffer[ri])
    }

    const m = this.#aliveHistoryCount
    const orderedAlive = []
    for (let i = 0; i < m; i++) {
      const ri = (this.#aliveHistoryHead - m + i + this.#maturityWindow) % this.#maturityWindow
      orderedAlive.push(this.#aliveHistory[ri])
    }

    return JSON.stringify({
      v:            8,
      resolution:   this.#resolution,
      cycle:        this.#cycle,
      space:        Array.from(this.#space),
      signature:    this.#signature,
      pos:          this.#pos,
      step:         this.#step,
      deltas:       orderedDeltas,
      aliveHistory: orderedAlive,
      sigMap:       sigMapArr,
      smoothedThreshold: this.#smoothedThreshold,
      maturityScore:     this.#maturityScore,
      params: {
        windowSize:           this.#bufferSize,
        decayRate:            this.#decayRate,
        thresholdFactor:      this.#thresholdFactor,
        eliminationRate:      this.#eliminationRate,
        reinforceRate:        this.#reinforceRate,
        threshold:            this.#threshold,
        sigWeight:            this.#sigWeight,
        sigMapMaxSize:        this.#sigMapMaxSize,
        cacheMaxAge:          this.#cacheMaxAge,
        minWarmupSteps:       this.#minWarmupSteps,
        maturityWindow:       this.#maturityWindow,
        maturityTolerance:    this.#maturityTolerance,
        localRadius:          this.#localRadius,
        confidenceThreshold:  this.#confidenceThreshold,
        wRepetition:          this.#wRepetition,
        wLocalDensity:        this.#wLocalDensity,
        wTrend:               this.#wTrend,
        wSignature:           this.#wSignature,
        wLearningRate:        this.#wLearningRate,
        thresholdEMA:         this.#thresholdEMA
      }
    })
  }

  static restore(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json
    if (d.v !== 8) throw new Error('CELF: incompatible snapshot version')

    const engine = new CELF_Engine_V8({ resolution: d.resolution, cycle: d.cycle, ...d.params })

    engine.#space             = new Float32Array(d.space)
    engine.#signature         = d.signature
    engine.#pos               = d.pos
    engine.#step              = d.step
    engine.#smoothedThreshold = d.smoothedThreshold ?? Infinity
    engine.#maturityScore     = d.maturityScore     ?? 0

    for (const delta of d.deltas)       engine.#pushDelta(delta)
    for (const ratio of d.aliveHistory) engine.#pushAliveRatio(ratio)
    for (const [k, v] of d.sigMap)      engine.#sigMap.set(k, v)

    return engine
  }

  // ═══════════════════════════════════════════════════════════════
  // RESET
  // ═══════════════════════════════════════════════════════════════

  reset() {
    this.#space.fill(0.5)
    this.#deltaBuffer.fill(0)
    this.#bufferHead        = 0
    this.#bufferCount       = 0
    this.#sigMap.clear()
    this.#signature         = 0
    this.#pos               = 0
    this.#step              = 0
    this.#cacheValid        = false
    this.#cacheAge          = Infinity
    this.#reachCachePos     = -1
    this.#reachCacheStep    = -1
    this.#aliveHistory.fill(0)
    this.#aliveHistoryHead  = 0
    this.#aliveHistoryCount = 0
    this.#smoothedThreshold = Infinity
    this.#maturityScore     = 0
    // Reset weights to initial equal distribution
    this.#wRepetition   = 0.25
    this.#wLocalDensity = 0.25
    this.#wTrend        = 0.25
    this.#wSignature    = 0.25
  }
}
