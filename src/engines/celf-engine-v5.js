/**
 * CELF Engine V6 — Predictive Cyclic Field Engine
 * تعلم حقيقي عبر Prediction Error
 *
 * المسار:
 * إدخال → تحويل → تفاعل → قيود → ديناميكيات → انتشار → ذاكرة → تغذية راجعة → استقرار → حالة
 *
 * ES Module — يعمل في Node.js والمتصفح
 */

export class CELF_Engine_AI_V5 {

  constructor(options = {}) {

    this.cycle      = options.cycle ?? 360
    this.resolution = options.resolution ?? 360
    this.ringCount  = options.ringCount ?? 5
    this.epsilon    = options.epsilon ?? 1e-6

  }

  routeContext(text, limit = 5) {
    return []
  }

}

    // ── شبكة الحقل ────────────────────────────────────────
    this.cycle       = options.cycle       ?? 360
    this.resolution  = options.resolution  ?? 360
    this.ringCount   = options.ringCount   ?? 5
    this.epsilon     = options.epsilon     ?? 1e-6

    // ── معاملات الديناميكيات ──────────────────────────────
    this.diffusionRate   = options.diffusionRate   ?? 0.08
    this.constraintRate  = options.constraintRate  ?? 0.12
    this.recoveryRate    = options.recoveryRate    ?? 0.035
    this.attractorRate   = options.attractorRate   ?? 0.06
    this.attractorLimit  = options.attractorLimit  ?? 12

    // ── المعالجة الدلالية ─────────────────────────────────
    this.semanticDimensions  = options.semanticDimensions  ?? 64
    this.activationThreshold = options.activationThreshold ?? 1e-4

    // ── الكبسولات ─────────────────────────────────────────
    this.vaultLimit      = options.vaultLimit      ?? 256
    this.historyLimit    = options.historyLimit    ?? 128

    // ══════════════════════════════════════════════════════
    //  التغذية الراجعة — قلب V6
    //
    //  W: مصفوفة التنبؤ  ℝ⁶⁴ˣᴬ
    //     تتعلم ربط حالة الجاذبات بالمتجه الدلالي القادم
    //
    //  η: معدل التعلم
    //  θ_vault: عتبة التخزين — تتكيف مع متوسط الخطأ
    //  θ_attractor: عتبة الجاذب — تتكيف مع كثافة الإشارة
    // ══════════════════════════════════════════════════════
    this.eta             = options.eta             ?? 0.01   // معدل تعلم W
    this.etaThreshold    = options.etaThreshold    ?? 0.05   // معدل تكيف العتبات
    this.maxAttractors   = this.attractorLimit

    // W ∈ ℝ^(D × A) — تُهيَّأ بقيم صغيرة عشوائية
    const D = this.semanticDimensions
    const A = this.attractorLimit
    this.W = new Float32Array(D * A)
    for (let i = 0; i < this.W.length; i++)
      this.W[i] = (Math.random() - 0.5) * 0.01

    // عتبات متكيفة
    this.theta_vault     = options.theta_vault     ?? 0.35
    this.theta_attractor = options.theta_attractor ?? 1e-4

    // آخر تنبؤ — للحساب عند الإدخال القادم
    this._lastPrediction = new Float32Array(D)
    this._lastAttractorState = new Float32Array(A)
    this._lastVector     = new Float32Array(D)
    this._hasPrediction  = false

    // ── الحقل الدائري ─────────────────────────────────────
    this.rings = Array.from({ length: this.ringCount }, (_, r) =>
      Array.from({ length: this.resolution }, (_, i) => ({
        r, i,
        theta    : (i / this.resolution) * this.cycle,
        p        : 1 / this.resolution,   // توزيع موحد ابتداءً
        residual : this.epsilon,
        pressure : 0,
        memory   : 0,
        hysteresis      : 0,
        constraintDensity: 0,
        semanticTrace   : 0,
        intentTrace     : 0,
        credibility     : 1.0
      }))
    )

    // ── كتلة الحقل ────────────────────────────────────────
    this.massTarget = this._totalMass()

    // ── الكبسولات ─────────────────────────────────────────
    this.vault = new Map()   // id → capsule

    // ── حالة النظام ───────────────────────────────────────
    this.state = {
      t            : 0,
      phase        : 'warmup',
      signature    : 0,
      cycleCount   : 0,
      lastTheta    : 0,
      lastIndex    : 0,
      lastDeltaTheta: 0,
      attractors   : [],
      history      : [],
      // إحصاءات التعلم
      totalError   : 0,
      errorHistory : [],   // آخر 32 خطأ
      learnCount   : 0
    }

    // ── الحقل الدلالي ─────────────────────────────────────
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
      semanticMemory    : [],   // آخر 64 إدخال
      avgCredibility    : 1.0,
      predictionError   : 0,   // الخطأ الحالي — مرئي في الخارج
    }

    // cache للـ metrics
    this._metricsCache     = null
    this._metricsCacheTime = -1
  }

  // ═══════════════════════════════════════════════════════
  //  PROCESS — المسار الكامل
  // ═══════════════════════════════════════════════════════

  process(input) {

    // إعادة تعيين cache في بداية كل خطوة
    this._metricsCache     = null
    this._metricsCacheTime = -1

    // ── 1. تحويل: نص → إشارة ──────────────────────────────
    const perturb = this._perturb(input)

    // ── 2. تغذية راجعة أولاً (قبل تحديث الحقل) ───────────
    //    نقيس الخطأ بين ما تنبأنا به والإدخال الحالي
    const feedback = this._computeFeedback(perturb.vector)

    // ── 3. تعلم: تعديل W والعتبات ─────────────────────────
    if (feedback.active) this._learn(feedback)

    // ── 4. تفاعل: تطبيق الإشارة على خلايا الحقل ──────────
    const delta = this._buildDelta(perturb)
    this._applyDelta(delta, perturb)

    // ── 5. قيود: ثبات الكتلة ──────────────────────────────
    this._conserveMass()

    // ── 6. ديناميكيات الحقل ───────────────────────────────
    this._updateCellDynamics()

    // ── 7. انتشار ∇²p ─────────────────────────────────────
    this._diffuse()

    // ── 8. كشف الجاذبات ───────────────────────────────────
    this._updateAttractors(perturb)

    // ── 9. تأثير الذاكرة والسياق ──────────────────────────
    this._applyAttractors()
    this._updateSemanticField(perturb, feedback)

    // ── 10. تنبؤ بالإدخال القادم ──────────────────────────
    this._predict()

    // ── 11. تخزين كبسولة إذا كان الخطأ كبيراً ────────────
    if (feedback.active && feedback.magnitude > this.theta_vault)
      this._storeCapsule(input, perturb, feedback)

    // ── 12. استقرار: كشف الطور ────────────────────────────
    this._updatePhase()
    this._updateFieldIdentity()
    this._updateLocalization()

    // ── 13. الحالة النهائية ───────────────────────────────
    const snap = this._snapshot(perturb, feedback)
    this._commit(snap)

    return snap
  }

  // ═══════════════════════════════════════════════════════
  //  1. التحويل — نص إلى إشارة رياضية
  // ═══════════════════════════════════════════════════════

  _perturb(input) {
    const text = typeof input === 'string' ? input : JSON.stringify(input ?? '')

    // hash ثلاثي — توزيع متجه دلالي على ℝ⁶⁴
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

    // تصنيف نوع الإدخال
    const code      = /```|function|class|const|let|var|=>|import|export/.test(text) ? 1 : 0
    const question  = /[?؟]|كيف|ماذا|لماذا|هل|what|why|how|where/i.test(text) ? 1 : 0
    const error     = /error|fail|exception|خطأ|فشل/i.test(text) ? 1 : 0
    const command   = /اكتب|أنشئ|build|create|fix|write|generate/i.test(text) ? 1 : 0
    const data      = /json|api|server|database|vector|metric/i.test(text) ? 1 : 0

    const words   = text.split(/\s+/).filter(Boolean)
    const unique  = new Set(words.map(w => w.toLowerCase()))
    const lexical = this._clamp01(unique.size / Math.max(words.length, 1))
    const length  = this._clamp01(text.length / 2000)

    const vector = this._semanticVector(text, h1, h2, h3)

    // شدة الإشارة الكلية
    const intensity = this._clamp01(
      length  * 0.20 +
      lexical * 0.20 +
      code    * 0.15 +
      command * 0.15 +
      error   * 0.15 +
      data    * 0.10 +
      question* 0.05
    )

    // موقع الإشارة في الحقل الدائري
    const theta = ((h1 % this.resolution) / this.resolution) * this.cycle
    const index = this._thetaToIndex(theta)

    return {
      text, h1, h2, h3,
      vector, intensity, theta, index,
      semantic: { code, question, error, command, data, lexical, length },
      words: words.length
    }
  }

  // متجه دلالي ℝ⁶⁴ — مُطبَّع
  _semanticVector(text, h1, h2, h3) {
    const D      = this.semanticDimensions
    const vec    = new Float32Array(D)
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean)

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

    // تطبيع L2
    let norm = 0
    for (let i = 0; i < D; i++) norm += vec[i] * vec[i]
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < D; i++) vec[i] = Math.fround(vec[i] / norm)
    return vec
  }

  // ═══════════════════════════════════════════════════════
  //  2. التغذية الراجعة — قلب V6
  //
  //  e(t) = v(t) - v̂(t)
  //  magnitude = ||e(t)||₂
  // ═══════════════════════════════════════════════════════

  _computeFeedback(currentVector) {
    if (!this._hasPrediction) {
      this._lastVector.set(currentVector)
      return { active: false, error: new Float32Array(this.semanticDimensions), magnitude: 0, quality: 1 }
    }

    const D = this.semanticDimensions

    // مقياس الخطأ: 1 - cosine similarity
    // يقيس الاتجاه لا الطول — الصحيح للمتجهات المُطبَّعة
    const similarity = this._cosine(currentVector, this._lastPrediction)
    const magnitude  = this._clamp01(1 - similarity)

    // متجه الخطأ الاتجاهي للتعلم ΔW
    const error = new Float32Array(D)
    for (let i = 0; i < D; i++)
      error[i] = currentVector[i] - this._lastPrediction[i]

    this._lastVector.set(currentVector)

    return {
      active   : true,
      error,
      magnitude: this._round4(magnitude),
      quality  : this._round4(similarity)
    }
  }

  // ═══════════════════════════════════════════════════════
  //  3. التعلم — تعديل W والعتبات
  //
  //  ΔW = η · e(t) · a(t)ᵀ
  //  Δθ_vault     = δ · (||e|| - θ_vault)
  //  Δθ_attractor = δ · (||e|| * 0.1 - θ_attractor)
  // ═══════════════════════════════════════════════════════

  _learn(feedback) {
    const D   = this.semanticDimensions
    const A   = this.maxAttractors
    const eta = this.eta
    const e   = feedback.error
    const a   = this._lastAttractorState  // حالة الجاذبات عند التنبؤ السابق

    // ΔW[d][j] = η · e[d] · a[j]
    for (let d = 0; d < D; d++) {
      for (let j = 0; j < A; j++) {
        this.W[d * A + j] += eta * e[d] * a[j]
      }
    }

    // تقليص الأوزان لمنع الانفجار (weight decay خفيف)
    const decay = 1 - eta * 0.001
    for (let i = 0; i < this.W.length; i++) this.W[i] *= decay

    // تكيف عتبة التخزين — في الاتجاهين
    // الهدف: θ_vault = percentile 40 من الأخطاء الأخيرة
    // يعني: نخزن الـ 60% الأعلى خطأ — لا نخزن كل شيء ولا لا شيء
    if (this.state.errorHistory.length >= 8) {
      const sorted = [...this.state.errorHistory].sort((a, b) => a - b)
      const p40    = sorted[Math.floor(sorted.length * 0.4)]
      this.theta_vault = this._clamp01(
        this.theta_vault * 0.95 + p40 * 0.05
      )
    } else {
      // قبل أن يتراكم تاريخ كافٍ — عتبة محافظة
      this.theta_vault = this._clamp01(
        this.theta_vault + this.etaThreshold * (feedback.magnitude - this.theta_vault)
      )
    }
    // تكيف عتبة الجاذب (خفيف)
    this.theta_attractor = Math.max(this.epsilon,
      this.theta_attractor + this.etaThreshold * 0.1 * (feedback.magnitude * 0.1 - this.theta_attractor)
    )

    // تسجيل إحصاءات التعلم
    this.state.errorHistory.push(feedback.magnitude)
    if (this.state.errorHistory.length > 32) this.state.errorHistory.shift()
    this.state.totalError += feedback.magnitude
    this.state.learnCount++
    this.field.predictionError = this._round4(feedback.magnitude)
  }

  // ═══════════════════════════════════════════════════════
  //  4. بناء دلتا الإشارة وتطبيقها على الخلايا
  // ═══════════════════════════════════════════════════════

  _buildDelta(perturb) {
    const phi       = 1.618033988749895
    const nextSig   = this._containTheta(
      this.state.signature * phi + perturb.theta + perturb.intensity * this.cycle * 0.22
    )

    const wrapped = Math.abs(this._signedIndexDist(this.state.lastIndex, perturb.index)) > this.resolution / 2
    if (wrapped) this.state.cycleCount++

    this.state.signature    = nextSig
    this.state.lastTheta    = perturb.theta
    this.state.lastIndex    = perturb.index
    this.state.lastDeltaTheta = this._indexToTheta(
      this._signedIndexDist(this.state.lastIndex, perturb.index)
    )

    return {
      index    : perturb.index,
      intensity: perturb.intensity,
      signature: nextSig,
      // شدة لكل ring — تتناقص للخارج
      ringVector: Array.from({ length: this.ringCount }, (_, r) =>
        this._clamp01(perturb.intensity * ((r + 1) / this.ringCount))
      )
    }
  }

  _applyDelta(delta, perturb) {
    const radius   = Math.max(2, Math.floor(3 + delta.intensity * 32))
    const semW     = this._clamp01(
      perturb.semantic.code    * 0.20 +
      perturb.semantic.command * 0.20 +
      perturb.semantic.error   * 0.18 +
      perturb.semantic.data    * 0.15 +
      perturb.semantic.lexical * 0.15 +
      perturb.semantic.length  * 0.12
    )

    for (let r = 0; r < this.ringCount; r++) {
      const rd = delta.ringVector[r]
      for (let i = 0; i < this.resolution; i++) {
        const cell = this.rings[r][i]
        const d    = this._circularIndexDist(i, delta.index)
        const prox = this._clamp01(1 - d / radius)

        const pressure  = this._clamp01(rd * 0.45 + semW * 0.30 + (1 - prox) * 0.25)
        const density   = cell.constraintDensity
        const expansion = prox * rd * this.recoveryRate * (1 - pressure) * (1 - density) * (1 + semW * 0.20)
        const narrowing = pressure * this.constraintRate * (1 - prox * 0.5) * (1 + density)

        cell.pressure      = pressure
        cell.p             = this._clampP(cell.p + expansion - narrowing)
        cell.memory        = this._clamp01(cell.memory * 0.985 + prox * rd * 0.013)
        cell.hysteresis    = this._clamp01(cell.hysteresis * 0.995 + prox * rd * 0.005)
        cell.semanticTrace = this._clamp01(cell.semanticTrace * 0.992 + prox * semW * 0.008)
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  5. قيود — ثبات الكتلة
  //  Σ p[r][i] = M  ∀t
  // ═══════════════════════════════════════════════════════

  _conserveMass() {
    const cells = []
    for (const ring of this.rings) for (const c of ring) cells.push(c)

    const floor   = this.epsilon * cells.length
    const target  = Math.max(this.massTarget, floor + this.epsilon)
    const current = cells.reduce((s, c) => s + Math.max(0, c.p - this.epsilon), 0)

    if (current < this.epsilon) {
      // إعادة توزيع بناءً على الذاكرة
      const memSum = cells.reduce((s, c) => s + Math.max(this.epsilon, c.memory + c.semanticTrace), 0)
      for (const c of cells)
        c.p = this.epsilon + ((target - floor) * Math.max(this.epsilon, c.memory + c.semanticTrace) / memSum)
      return
    }

    const factor = Math.max(0, target - floor) / current
    for (const c of cells)
      c.p = this.epsilon + Math.max(0, c.p - this.epsilon) * factor
  }

  // ═══════════════════════════════════════════════════════
  //  6. ديناميكيات الخلايا
  // ═══════════════════════════════════════════════════════

  _updateCellDynamics() {
    for (const ring of this.rings) {
      for (const cell of ring) {
        const baseline = 1 / this.resolution
        cell.elasticStrain = this._clamp01(
          Math.abs(cell.p - baseline) * cell.hysteresis * 0.3
        )
        cell.p = this._clampP(
          cell.p - cell.elasticStrain * this.recoveryRate * 0.5
        )
        cell.constraintDensity = this._clamp01(
          cell.constraintDensity * 0.995 +
          cell.pressure * 0.0026 +
          cell.memory   * 0.0017 +
          cell.semanticTrace * 0.0007
        )
        // credibility تتأثر بالتغذية الراجعة الحقيقية
        cell.credibility = this._clamp01(
          cell.credibility * 0.99 + (1 - this.field.predictionError) * 0.01
        )
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  7. الانتشار — معادلة الحرارة على شبكة دائرية
  //  p(t+1) = p(t) + α · R · ∇²p
  //  ∇²p = 0.70·lateral + 0.30·radial
  // ═══════════════════════════════════════════════════════

  _diffuse() {
    const next = this.rings.map(ring => ring.map(c => c.p))

    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        const cell  = this.rings[r][i]
        const left  = this.rings[r][this._wrapI(i - 1)].p
        const right = this.rings[r][this._wrapI(i + 1)].p
        const up    = this.rings[this._wrapR(r - 1)][i].p
        const down  = this.rings[this._wrapR(r + 1)][i].p

        const lap = (left + right - 2 * cell.p) * 0.70 +
                    (up   + down  - 2 * cell.p) * 0.30

        // مقاومة الانتشار — المناطق ذات الذاكرة تنتشر أبطأ
        const R = (1 - cell.constraintDensity) *
                  (1 - cell.semanticTrace * 0.25) *
                  (1 - cell.hysteresis    * 0.30)

        next[r][i] = this._clampP(cell.p + this.diffusionRate * R * lap)
      }
    }

    for (let r = 0; r < this.ringCount; r++)
      for (let i = 0; i < this.resolution; i++)
        this.rings[r][i].p = next[r][i]
  }

  // ═══════════════════════════════════════════════════════
  //  8. الجاذبات — اكتشاف + تفاعل
  // ═══════════════════════════════════════════════════════

  _updateAttractors(perturb) {
    const candidates = []

    for (let r = 0; r < this.ringCount; r++) {
      for (let i = 0; i < this.resolution; i++) {
        const c     = this.rings[r][i]
        const score = this._clamp01(
          c.p                  * 0.40 +
          c.memory             * 0.20 +
          c.semanticTrace      * 0.15 +
          c.constraintDensity  * 0.10 +
          c.credibility        * 0.15
        )

        if (score > this.theta_attractor) {
          candidates.push({
            r, i,
            theta    : c.theta,
            strength : score,
            memory   : c.memory,
            semantic : c.semanticTrace,
            credibility: c.credibility,
            // emergentCredibility يتأثر بجودة التنبؤ
            emergentCredibility: this._clamp01(
              c.credibility * (1 - this.field.predictionError * 0.3)
            ),
            vector   : perturb.vector.slice()
          })
        }
      }
    }

    // فرز + تباعد مكاني
    candidates.sort((a, b) => b.strength - a.strength)
    const selected = []
    for (const c of candidates) {
      const tooClose = selected.some(
        a => a.r === c.r && this._circularIndexDist(a.i, c.i) < 6
      )
      if (!tooClose) selected.push(c)
      if (selected.length >= this.attractorLimit) break
    }

    // تفاعل الجاذبات — قانون عكسي تربيعي
    for (let x = 0; x < selected.length; x++) {
      for (let y = x + 1; y < selected.length; y++) {
        const a = selected[x], b = selected[y]
        const d     = Math.max(1, this._circularIndexDist(a.i, b.i))
        const force = (a.strength * b.strength) / (d * d) / (1 + Math.abs(a.r - b.r))
        if (a.r === b.r && d < 12) {
          a.strength = this._clamp01(a.strength + force * 0.1)
          b.strength = this._clamp01(b.strength + force * 0.1)
        } else {
          a.strength = this._clamp01(a.strength - force * 0.05)
          b.strength = this._clamp01(b.strength - force * 0.05)
        }
      }
    }

    this.state.attractors = selected.map(a => ({
      ...a,
      stability  : this._clamp01(a.strength),
      orbitTheta : this._containTheta(
        a.theta + this.state.lastDeltaTheta * this.attractorRate
      )
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

  // ═══════════════════════════════════════════════════════
  //  9. الحقل الدلالي
  // ═══════════════════════════════════════════════════════

  _updateSemanticField(perturb, feedback) {
    const last  = this.field.semanticMemory.at(-1)
    const simil = last ? this._cosine(perturb.vector, last.vector) : 0
    const novel = this._clamp01(1 - simil)

    const grounding = this._clamp01(
      perturb.semantic.lexical * 0.30 +
      perturb.semantic.length  * 0.15 +
      perturb.semantic.code    * 0.20 +
      perturb.semantic.data    * 0.20 +
      perturb.semantic.command * 0.15
    )

    const intent = this._clamp01(
      perturb.semantic.command  * 0.30 +
      perturb.semantic.error    * 0.25 +
      perturb.semantic.question * 0.20 +
      perturb.semantic.code     * 0.25
    )

    this.field.semanticGrounding  = this._round4(this.field.semanticGrounding  * 0.86 + grounding * 0.14)
    this.field.semanticCoherence  = this._round4(this.field.semanticCoherence  * 0.82 + simil     * 0.18)
    this.field.intentPressure     = this._round4(this.field.intentPressure     * 0.78 + intent    * 0.22)
    this.field.noveltyPressure    = this._round4(this.field.noveltyPressure    * 0.80 + novel     * 0.20)
    this.field.executionReadiness = this._round4(this._clamp01(
      perturb.semantic.command * 0.40 + perturb.semantic.code * 0.30 + this.field.coherence * 0.30
    ))
    this.field.recallPotential    = this._round4(this._clamp01(
      simil * 0.40 + this.field.persistence * 0.30 + this.field.continuity * 0.30
    ))

    // credibility متوسط الجاذبات
    const creds = this.state.attractors.map(a => a.emergentCredibility ?? 1)
    this.field.avgCredibility = creds.length
      ? this._round4(creds.reduce((s, v) => s + v, 0) / creds.length)
      : 1.0

    // حفظ في الذاكرة
    this.field.semanticMemory.push({
      t       : this.state.t,
      theta   : this._round4(this.state.lastTheta),
      vector  : perturb.vector.slice(),
      grounding,
      coherence: this.field.semanticCoherence,
      novelty  : this.field.noveltyPressure,
      phase    : this.state.phase,
      // الخطأ وقت التخزين
      predictionError: feedback.magnitude
    })

    if (this.field.semanticMemory.length > 64)
      this.field.semanticMemory.shift()
  }

  // ═══════════════════════════════════════════════════════
  //  10. التنبؤ بالإدخال القادم
  //
  //  v̂(t+1) = normalize( W·a(t) + α_cap · v_cap )
  //
  //  a(t)  = حالة الجاذبات ∈ ℝᴬ
  //  v_cap = متجه أقرب كبسولة مرتبطة بالسياق الحالي
  //  α_cap = وزن الكبسولة = تشابه × تعزيز
  //
  //  الكبسولة تُغذّي التنبؤ مباشرة:
  //  سياق مشابه لما خُزِّن → التنبؤ يستفيد من الذاكرة
  // ═══════════════════════════════════════════════════════

  _predict() {
    const D = this.semanticDimensions
    const A = this.maxAttractors

    // ── 1. بناء a(t) من الجاذبات ──────────────────────────
    const a = new Float32Array(A)
    for (let j = 0; j < Math.min(this.state.attractors.length, A); j++)
      a[j] = this.state.attractors[j].strength ?? 0

    let aNorm = 0
    for (let j = 0; j < A; j++) aNorm += a[j] * a[j]
    aNorm = Math.sqrt(aNorm) || 1
    for (let j = 0; j < A; j++) a[j] /= aNorm

    // ── 2. v̂_field = W · a ────────────────────────────────
    const predField = new Float32Array(D)
    for (let d = 0; d < D; d++) {
      let sum = 0
      for (let j = 0; j < A; j++) sum += this.W[d * A + j] * a[j]
      predField[d] = sum
    }

    // ── 3. مساهمة الكبسولة ────────────────────────────────
    // أقرب كبسولة للسياق الحالي تُضاف كذاكرة للتنبؤ
    let capsuleContrib = null
    let alpha_cap      = 0

    if (this.vault.size > 0 && this._lastVector.some(v => v !== 0)) {
      const hit = this.retrieveCapsule(this._lastVector, true)
      if (hit) {
        const reinforcementBoost = this._clamp01((hit.capsule.reinforcement ?? 0) / 5)
        alpha_cap      = this._clamp01(hit.score * (1 + reinforcementBoost) * 0.6)
        capsuleContrib = hit.capsule.vector
      }
    }

    // ── 4. دمج: v̂ = (1-α)·v̂_field + α·v_cap ──────────────
    const pred = new Float32Array(D)
    for (let d = 0; d < D; d++) {
      pred[d] = capsuleContrib
        ? (1 - alpha_cap) * predField[d] + alpha_cap * capsuleContrib[d]
        : predField[d]
    }

    // ── 5. تطبيع ──────────────────────────────────────────
    let pNorm = 0
    for (let i = 0; i < D; i++) pNorm += pred[i] * pred[i]
    pNorm = Math.sqrt(pNorm) || 1
    for (let i = 0; i < D; i++) pred[i] = Math.fround(pred[i] / pNorm)

    this._lastPrediction.set(pred)
    this._lastAttractorState.set(a)
    this._hasPrediction   = true
    this._lastCapsuleAlpha = alpha_cap
  }

  // ═══════════════════════════════════════════════════════
  //  11. الكبسولات — التخزين بناءً على المفاجأة
  //  store iff ||e(t)|| > θ_vault (متكيف)
  // ═══════════════════════════════════════════════════════

  _storeCapsule(input, perturb, feedback) {
    const text = String(input ?? '')
    if (text.length < 10) return

    // checksum بسيط
    let cs = 2166136261
    for (let i = 0; i < text.length; i++) {
      cs ^= text.charCodeAt(i)
      cs  = Math.imul(cs, 16777619)
    }
    const checksum = Math.abs(cs >>> 0).toString(16)

    // تحديث إذا موجود
    for (const [, cap] of this.vault) {
      if (cap.checksum === checksum) {
        cap.reinforcement = (cap.reinforcement ?? 0) + 0.1
        cap.lastError     = feedback.magnitude
        cap.version       = (cap.version ?? 1) + 1
        return
      }
    }

    // تخزين جديد
    const id = `cap_${this.state.t}_${checksum.slice(0, 6)}`
    this.vault.set(id, {
      id,
      text     : text.slice(0, 200),       // نبقي أول 200 حرف
      checksum,
      vector   : perturb.vector.slice(),
      phase    : this.state.phase,
      t        : this.state.t,
      error    : feedback.magnitude,        // الخطأ الذي سبب التخزين
      theta    : this._round4(this.field.signature * 1.618033988749895 % this.cycle),
      reinforcement: 0,
      version  : 1
    })

    // تنظيف: احذف الأقل تعزيزاً
    if (this.vault.size > this.vaultLimit) {
      const sorted = [...this.vault.entries()].sort(([, a], [, b]) => a.reinforcement - b.reinforcement)
      for (const [id] of sorted.slice(0, this.vault.size - this.vaultLimit))
        this.vault.delete(id)
    }
  }

  // استرجاع أقرب كبسولة بالتشابه الدلالي
  retrieveCapsule(queryVector, reinforce = false) {
    let best = null, bestScore = -1

    for (const [, cap] of this.vault) {
      const sim   = this._cosine(queryVector, cap.vector)
      const reinf = this._clamp01((cap.reinforcement ?? 0) / 10)
      const score = sim * 0.70 + reinf * 0.30

      if (score > bestScore && score > 0.25) {
        bestScore = score
        best      = { capsule: cap, score: this._round4(score) }
      }
    }

    // إذا طُلب التعزيز — الكبسولة المسترجعة تقوى
    // هذا يعني: ما يُستخدم فعلاً في التنبؤ يُعزَّز
    if (best && reinforce) {
      best.capsule.reinforcement = (best.capsule.reinforcement ?? 0) + 0.05
      best.capsule.lastUsed      = this.state.t
    }

    return best
  }

  // ═══════════════════════════════════════════════════════
  //  12. الاستقرار — كشف الطور
  // ═══════════════════════════════════════════════════════

  _updatePhase() {
    const m   = this._metrics()
    let phase = 'stable'

    if (this.state.t < 8)                                          phase = 'warmup'
    else if (m.entropy > 0.72 && m.aliveRatio < 0.30)             phase = 'noise'
    else if (m.pressure > 0.70 && m.entropy > 0.65)               phase = 'turbulent'
    else if (m.aliveRatio < 0.25)                                  phase = 'compressed'
    else if (m.attractorStr > 0.72 && m.drift < 0.20 &&
             this.field.semanticCoherence > 0.45)                  phase = 'locked'
    else if (m.drift > 0.55 || this.field.noveltyPressure > 0.72) phase = 'drift'
    else if (m.residual > 0.55 && m.attractorStr > 0.50)          phase = 'emergent'
    else if (m.pressure > 0.45 || this.field.intentPressure > 0.60) phase = 'metastable'

    this.state.phase = phase
  }

  _updateFieldIdentity() {
    const m   = this._metrics()
    const phi = 1.618033988749895

    this.field.signature = this._containTheta(
      this.field.signature * phi + this.state.signature +
      m.entropy * this.cycle * 0.20 + m.attractorStr * this.cycle * 0.14
    )

    this.field.coherence  = this._round4(this._clamp01(
      (1 - m.drift) * 0.35 + m.attractorStr * 0.30 + (1 - m.pressure) * 0.20 + this.field.semanticCoherence * 0.15
    ))
    this.field.continuity = this._round4(this._clamp01(
      m.residual * 0.35 + m.attractorStr * 0.25 + (1 - m.drift) * 0.20 + this.field.semanticGrounding * 0.20
    ))
    this.field.drift      = this._round4(m.drift)
    this.field.momentum   = this._round4(this._clamp01(Math.abs(this.state.lastDeltaTheta) / (this.cycle * 0.5)))
    this.field.resonance  = this._round4(this._clamp01(
      m.entropy * 0.25 + m.attractorStr * 0.30 + m.residual * 0.20 + this.field.semanticCoherence * 0.25
    ))
    this.field.topicPressure = this._round4(m.pressure)
    this.field.persistence   = this._round4(this._clamp01(this.field.persistence * 0.92 + this.field.continuity * 0.08))
    this.field.emergence     = this._round4(this._clamp01(
      m.residual * 0.25 + m.entropy * 0.20 + m.attractorStr * 0.30 + this.field.noveltyPressure * 0.25
    ))
  }

  _updateLocalization() {
    let maxP = 0, sumP = 0
    for (const ring of this.rings)
      for (const c of ring) { sumP += c.p; if (c.p > maxP) maxP = c.p }

    this.field.localization = this._round4(sumP > 0 ? maxP / sumP : 0)
    this.field.signalType   = this.field.localization > 0.012 ? 'signal' : 'noise'
  }

  // ═══════════════════════════════════════════════════════
  //  13. الحالة النهائية — Snapshot نظيف
  // ═══════════════════════════════════════════════════════

  _snapshot(perturb, feedback) {
    const m = this._metrics()

    return {
      version : 'CELF-V6',
      t       : this.state.t,
      phase   : this.state.phase,

      // الحقل
      field: {
        signature        : this._round4(this.field.signature),
        coherence        : this.field.coherence,
        continuity       : this.field.continuity,
        drift            : this.field.drift,
        momentum         : this.field.momentum,
        resonance        : this.field.resonance,
        persistence      : this.field.persistence,
        emergence        : this.field.emergence,
        topicPressure    : this.field.topicPressure,
        semanticGrounding: this.field.semanticGrounding,
        semanticCoherence: this.field.semanticCoherence,
        intentPressure   : this.field.intentPressure,
        executionReadiness: this.field.executionReadiness,
        recallPotential  : this.field.recallPotential,
        noveltyPressure  : this.field.noveltyPressure,
        localization     : this.field.localization,
        signalType       : this.field.signalType,
        avgCredibility   : this.field.avgCredibility,
        predictionError  : this.field.predictionError
      },

      // التعلم — مرئي للخارج
      learning: {
        predictionError  : feedback.magnitude,
        predictionQuality: feedback.quality ?? 1,
        theta_vault      : this._round4(this.theta_vault),
        theta_attractor  : this._round4(this.theta_attractor),
        learnCount       : this.state.learnCount,
        avgError         : this.state.errorHistory.length
          ? this._round4(this.state.errorHistory.reduce((s, v) => s + v, 0) / this.state.errorHistory.length)
          : 0,
        improving        : this._isImproving(),
        // مساهمة الكبسولة في التنبؤ — 0 تعني لا كبسولة، 1 تعني كبسولة كاملة
        capsuleAlpha     : this._round4(this._lastCapsuleAlpha ?? 0)
      },

      // الإشارة
      input: {
        intensity: this._round4(perturb.intensity),
        semantic : perturb.semantic,
        words    : perturb.words
      },

      // الجاذبات
      attractors: this.state.attractors.slice(0, 6).map(a => ({
        r        : a.r,
        i        : a.i,
        strength : this._round4(a.strength),
        stability: this._round4(a.stability),
        credibility: this._round4(a.emergentCredibility ?? 1)
      })),

      // الذاكرة
      vault: {
        size  : this.vault.size,
        theta_vault: this._round4(this.theta_vault)
      },

      // المقاييس
      metrics: m,

      // التوجيه
      control: this._control()
    }
  }

  _commit(snap) {
    this.state.history.push({
      t        : snap.t,
      phase    : snap.phase,
      drift    : snap.field.drift,
      coherence: snap.field.coherence,
      error    : snap.learning.predictionError
    })
    if (this.state.history.length > this.historyLimit)
      this.state.history.shift()
    this.state.t++
  }

  // ═══════════════════════════════════════════════════════
  //  المقاييس — تُحسب مرة واحدة فقط per step
  // ═══════════════════════════════════════════════════════

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
      mean       : this._round4(mean),
      entropy    : this._round4(entropy),
      pressure   : this._round4(ps.map((_, i) => prs[i]).reduce((s, v) => s + v, 0) / prs.length),
      residual   : this._round4(res.reduce((s, v) => s + v, 0) / res.length),
      aliveRatio : this._round4(ps.filter(v => v > this.activationThreshold).length / ps.length),
      attractorStr: this._round4(this.state.attractors.length
        ? this.state.attractors.reduce((s, a) => s + (a.stability ?? 0), 0) / this.state.attractors.length
        : 0),
      drift      : this._round4(drift),
      semanticMass: this._round4(sem.reduce((s, v) => s + v, 0) / sem.length),
      totalMass  : this._round4(this._totalMass())
    }

    this._metricsCache     = result
    this._metricsCacheTime = this.state.t
    return result
  }

  // توجيه الخارج
  _control() {
    const phase = this.state.phase
    const mode  =
      phase === 'turbulent'  ? 'ground'   :
      phase === 'drift'      ? 'clarify'  :
      phase === 'emergent'   ? 'explore'  :
      phase === 'locked'     ? 'compress' :
      phase === 'noise'      ? 'filter'   :
      'balance'

    return {
      mode,
      executionReadiness : this.field.executionReadiness,
      recallPotential    : this.field.recallPotential,
      semanticGrounding  : this.field.semanticGrounding,
      signalType         : this.field.signalType,
      predictionError    : this.field.predictionError,
      avgCredibility     : this.field.avgCredibility
    }
  }

  // هل المحرك يتحسن؟ — يقارن نصف الأخطاء الأحدث بالأقدم
  _isImproving() {
    const h = this.state.errorHistory
    if (h.length < 8) return null
    const half   = Math.floor(h.length / 2)
    const older  = h.slice(0, half).reduce((s, v) => s + v, 0) / half
    const newer  = h.slice(half).reduce((s, v) => s + v, 0) / (h.length - half)
    return newer < older
  }

  // ═══════════════════════════════════════════════════════
  //  واجهة عامة
  // ═══════════════════════════════════════════════════════

  // تغذية تسلسل للتعلم
  learn(sequence = []) {
    for (const item of sequence) this.process(item)
    return this
  }

  // ملخص الحالة
  summary() {
    const m = this._metrics()
    return {
      version       : 'CELF-V6',
      t             : this.state.t,
      phase         : this.state.phase,
      attractors    : this.state.attractors.length,
      vault         : this.vault.size,
      metrics       : m,
      field         : { coherence: this.field.coherence, drift: this.field.drift },
      learning: {
        learnCount  : this.state.learnCount,
        avgError    : this.state.errorHistory.length
          ? this._round4(this.state.errorHistory.reduce((s, v) => s + v, 0) / this.state.errorHistory.length)
          : 0,
        improving   : this._isImproving(),
        theta_vault : this._round4(this.theta_vault)
      }
    }
  }

  reset() {
    for (const ring of this.rings)
      for (const cell of ring) {
        cell.p = 1 / this.resolution; cell.residual = this.epsilon
        cell.pressure = 0; cell.memory = 0; cell.hysteresis = 0
        cell.constraintDensity = 0; cell.semanticTrace = 0
        cell.intentTrace = 0; cell.credibility = 1.0
      }
    this.vault.clear()
    this.state.t = 0; this.state.phase = 'warmup'
    this.state.attractors = []; this.state.history = []
    this.state.errorHistory = []; this.state.learnCount = 0
    this.field.semanticMemory = []
    this._hasPrediction = false
    this._metricsCache = null
    return this
  }

  // ═══════════════════════════════════════════════════════
  //  أدوات رياضية داخلية
  // ═══════════════════════════════════════════════════════

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
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
    }
    return (na > 0 && nb > 0) ? this._clamp01(dot / (Math.sqrt(na) * Math.sqrt(nb))) : 0
  }

  _totalMass() {
    let s = 0
    for (const ring of this.rings) for (const c of ring) s += c.p
    return s
  }

  _containTheta(v)        { return ((Number(v) % this.cycle) + this.cycle) % this.cycle }
  _thetaToIndex(theta)    { return Math.floor((this._containTheta(theta) / this.cycle) * this.resolution) % this.resolution }
  _indexToTheta(d)        { return (d / this.resolution) * this.cycle }
  _wrapI(i)               { return ((i % this.resolution) + this.resolution) % this.resolution }
  _wrapR(r)               { return ((r % this.ringCount)  + this.ringCount)  % this.ringCount  }
  _circularIndexDist(a, b){ const d = Math.abs(a - b); return Math.min(d, this.resolution - d) }
  _signedIndexDist(a, b)  { const f = (b - a + this.resolution) % this.resolution; return f > this.resolution / 2 ? f - this.resolution : f }
  _clamp01(v)             { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0 }
  _clampP(v)              { const n = Number(v); return Number.isFinite(n) ? Math.max(this.epsilon, n) : this.epsilon }
  _round4(v)              { return Math.round(Number(v || 0) * 10000) / 10000 }
}
