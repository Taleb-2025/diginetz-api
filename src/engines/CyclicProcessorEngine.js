export class CyclicProcessorEngine {
  #cycle
  #step
  #state
  #maxHistory
  #maxArchive
  #maxVelocity
  #clock
  #lastTimestamp
  #cycleCount
  #memorySignature
  #processors
  #history
  #archive
  #field
  #az
  #listeners
  #plugins
  #semantic
  #checkpoints
  #attractorVersion
  #checkpointInterval

  constructor(options = {}) {
    const cycle = Number.isFinite(options.cycle) ? Number(options.cycle) : 360
    if (cycle <= 0) throw new Error("CPE_INVALID_CYCLE")

    this.#cycle = cycle
    this.#step = Number.isFinite(options.step) ? Number(options.step) : 1
    this.#state = this.#normalize(Number.isFinite(options.initialState) ? Number(options.initialState) : 0)
    this.#maxHistory = (Number.isFinite(options.maxHistory) && options.maxHistory > 0) ? Math.floor(options.maxHistory) : 1000
    this.#maxArchive = (Number.isFinite(options.maxArchive) && options.maxArchive > 0) ? Math.floor(options.maxArchive) : 1000
    this.#maxVelocity = (Number.isFinite(options.maxVelocity) && options.maxVelocity > 0) ? Number(options.maxVelocity) : Infinity
    this.#clock = typeof options.clock === "function" ? options.clock : Date.now
    this.#lastTimestamp = this.#clock()
    this.#cycleCount = 0
    this.#memorySignature = 0
    this.#processors = []
    this.#history = []
    this.#archive = []
    this.#checkpoints = []
    this.#attractorVersion = 0
    this.#checkpointInterval = options.checkpointInterval ?? 100

    const field = options.field ?? {}

    this.#field = {
      residual: 0,
      constraintDensity: 0,
      inertia: 0,
      pressure: 0,
      curvature: 0,
      diffusion: 0,
      resistance: 0,
      attractors: [],
      attractorLimit: field.attractorLimit ?? 12,
      residualDecay: field.residualDecay ?? 0.94,
      residualGain: field.residualGain ?? 0.06,
      densityDecay: field.densityDecay ?? 0.965,
      densityPressureGain: field.densityPressureGain ?? 0.025,
      densityResidualGain: field.densityResidualGain ?? 0.010,
      inertiaDecay: field.inertiaDecay ?? 0.90,
      inertiaGain: field.inertiaGain ?? 0.10,
      attractorDecay: field.attractorDecay ?? 0.985,
      attractorGain: field.attractorGain ?? 0.035,
      diffusionRate: field.diffusionRate ?? 0.08,
      resistanceGain: field.resistanceGain ?? 0.65,
      curvatureGain: field.curvatureGain ?? 0.5,
      novelty: 0,
      noveltyFloor: field.noveltyFloor ?? 0.035,
      lastEffectiveStep: 0,
    }

    const az = options.analyzer ?? {}

    this.#az = {
      historyWindow: az.historyWindow ?? 20,
      baseThreshold: az.baseThreshold ?? 50,
      trendBufferSize: az.trendBufferSize ?? 5,
      scoreHistorySize: az.scoreHistorySize ?? 10,
      intervalMs: az.intervalMs ?? 3600000,
      adaptiveThreshold: az.baseThreshold ?? 50,
      learnedZScores: [],
      trendBuffer: [],
      scoreHistory: [],
      anomalyStartTime: null,
      lastSeverity: 0,
      readingCount: 0,
      hasData: false,
    }

    this.#semantic = this.#buildSemanticLayer(options.semantic ?? {})

    this.#listeners = {
      tick: new Set(),
      process: new Set(),
      transition: new Set(),
      cycleComplete: new Set(),
      reset: new Set(),
      restore: new Set(),
      rewind: new Set(),
      travel: new Set(),
      snapshot: new Set(),
      velocityExceeded: new Set(),
      anomaly: new Set(),
      archive: new Set(),
      fieldUpdate: new Set(),
      conceptChange: new Set(),
    }

    this.#plugins = new Set()

    if (Array.isArray(options.processors)) {
      for (const p of options.processors) this.addProcessor(p)
    }

    if (Array.isArray(options.plugins)) {
      for (const p of options.plugins) this.use(p)
    }
  }

  #buildSemanticLayer(cfg) {
    const defaultZones = [
      { from: 0,   to: 60,  concept: "idle",      context: "no significant activity" },
      { from: 60,  to: 120, concept: "active",     context: "normal operating range" },
      { from: 120, to: 180, concept: "elevated",   context: "above baseline" },
      { from: 180, to: 240, concept: "stressed",   context: "high load detected" },
      { from: 240, to: 300, concept: "critical",   context: "threshold breach imminent" },
      { from: 300, to: 360, concept: "recovery",   context: "returning toward baseline" },
    ]

    const fieldConceptMap = cfg.fieldConceptMap ?? {
      pressure:  { low: "calm",      mid: "building",   high: "overloaded"  },
      inertia:   { low: "flexible",  mid: "resistant",  high: "locked"      },
      novelty:   { low: "routine",   mid: "shifting",   high: "anomalous"   },
      resistance:{ low: "flowing",   mid: "friction",   high: "blocked"     },
    }

    const trendConceptMap = cfg.trendConceptMap ?? {
      rising:  "escalating",
      falling: "resolving",
      stable:  "consolidated",
    }

    const attractorConceptMap = cfg.attractorConceptMap ?? null

    return {
      zones: Array.isArray(cfg.zones) && cfg.zones.length > 0 ? cfg.zones : defaultZones,
      fieldConceptMap,
      trendConceptMap,
      attractorConceptMap,
      conceptHistory: [],
      maxConceptHistory: cfg.maxConceptHistory ?? 100,
      lastConcept: null,
      lastFieldConcepts: {},
    }
  }

  #resolveStateConcept(state) {
    const s = this.#normalize(state)
    for (const zone of this.#semantic.zones) {
      if (s >= zone.from && s < zone.to) {
        return { concept: zone.concept, context: zone.context, zone }
      }
    }
    const last = this.#semantic.zones[this.#semantic.zones.length - 1]
    return { concept: last.concept, context: last.context, zone: last }
  }

  #resolveFieldConcepts() {
    const map = this.#semantic.fieldConceptMap
    const f = this.#field
    const result = {}

    for (const [key, levels] of Object.entries(map)) {
      const val = this.#clamp01(f[key] ?? 0)
      if (val < 0.33)      result[key] = levels.low
      else if (val < 0.66) result[key] = levels.mid
      else                 result[key] = levels.high
    }

    return result
  }

  #resolveAttractorConcepts() {
    if (!this.#semantic.attractorConceptMap || !this.#field.attractors.length) return []

    return this.#field.attractors.map(a => {
      const mapped = this.#semantic.attractorConceptMap[Math.round(a.theta)]
        ?? this.#semantic.attractorConceptMap["*"]
        ?? null
      return {
        theta: a.theta,
        strength: a.strength,
        hits: a.hits,
        concept: mapped,
      }
    })
  }

  #buildSemanticReport(state) {
    const stateConcept  = this.#resolveStateConcept(state)
    const fieldConcepts = this.#resolveFieldConcepts()
    const trendConcept  = this.#semantic.trendConceptMap[this.#getTrend()] ?? "unknown"
    const attractorConcepts = this.#resolveAttractorConcepts()

    const dominant = this.#field.attractors.length > 0
      ? this.#resolveStateConcept(this.#field.attractors[0].theta).concept
      : null

    return {
      state: stateConcept.concept,
      context: stateConcept.context,
      trend: trendConcept,
      field: fieldConcepts,
      dominantAttractor: dominant,
      attractors: attractorConcepts,
    }
  }

  #updateSemanticState(state) {
    const sem     = this.#semantic
    const resolved = this.#resolveStateConcept(state)
    const concept  = resolved.concept

    if (concept !== sem.lastConcept) {
      const previous = sem.lastConcept
      sem.lastConcept = concept

      const entry = {
        concept,
        previous,
        state,
        context: resolved.context,
        timestamp: this.#clock(),
      }

      sem.conceptHistory.push(entry)
      if (sem.conceptHistory.length > sem.maxConceptHistory) sem.conceptHistory.shift()

      sem.lastFieldConcepts = this.#resolveFieldConcepts()

      this.#emit("conceptChange", {
        previous,
        current: concept,
        context: resolved.context,
        state,
        fieldConcepts: sem.lastFieldConcepts,
        timestamp: entry.timestamp,
      })
    } else {
      sem.lastFieldConcepts = this.#resolveFieldConcepts()
    }
  }

  getState()           { return this.#state }
  getCycle()           { return this.#cycle }
  getStep()            { return this.#step }
  getMaxVelocity()     { return this.#maxVelocity }
  getCycleCount()      { return this.#cycleCount }
  getMemorySignature() { return this.#memorySignature }
  getProcessors()      { return [...this.#processors] }
  getHistory()         { return this.#history.map(e => ({ ...e })) }
  getArchive()         { return this.#archive.map(e => ({ ...e })) }
  getCheckpoints()     { return this.#checkpoints.map(c => ({ ...c })) }

  getSemanticState() {
    return this.#buildSemanticReport(this.#state)
  }

  getConceptHistory() {
    return [...this.#semantic.conceptHistory]
  }

  getFieldState() {
    return {
      residual:          this.#round4(this.#field.residual),
      constraintDensity: this.#round4(this.#field.constraintDensity),
      inertia:           this.#round4(this.#field.inertia),
      pressure:          this.#round4(this.#field.pressure),
      curvature:         this.#round4(this.#field.curvature),
      diffusion:         this.#round4(this.#field.diffusion),
      resistance:        this.#round4(this.#field.resistance),
      novelty:           this.#round4(this.#field.novelty),
      lastEffectiveStep: this.#round4(this.#field.lastEffectiveStep),
      attractors:        this.#field.attractors.map(a => ({ ...a })),
    }
  }

  getContainmentState() {
    return {
      value:           this.#state,
      cycleCount:      this.#cycleCount,
      memorySignature: this.#memorySignature,
      layer:           this.#cycleCount * this.#cycle + this.#state,
      field:           this.getFieldState(),
      semantic:        this.getSemanticState(),
    }
  }

  setStep(step) {
    if (!Number.isFinite(step) || step === 0) throw new Error("CPE_INVALID_STEP")
    this.#step = Number(step)
    return this
  }

  setMaxVelocity(v) {
    if (!Number.isFinite(v) || v <= 0) throw new Error("CPE_INVALID_MAX_VELOCITY")
    this.#maxVelocity = v
    return this
  }

  setSemanticZones(zones) {
    if (!Array.isArray(zones) || zones.length === 0) throw new Error("CPE_INVALID_SEMANTIC_ZONES")
    this.#semantic.zones = zones
    this.#semantic.lastConcept = null
    this.#updateSemanticState(this.#state)
    return this
  }

  setSemanticMap(key, map) {
    const allowed = ["fieldConceptMap", "trendConceptMap", "attractorConceptMap"]
    if (!allowed.includes(key)) throw new Error("CPE_INVALID_SEMANTIC_MAP_KEY")
    this.#semantic[key] = map
    return this
  }

  addProcessor(processor) {
    if (typeof processor !== "function") throw new Error("CPE_INVALID_PROCESSOR")
    this.#processors.push(processor)
    return this
  }

  removeProcessor(processor) {
    this.#processors = this.#processors.filter(p => p !== processor)
    return this
  }

  clearProcessors() {
    this.#processors = []
    return this
  }

  process(input = null, options = {}) {
    const now       = this.#clock()
    const deltaTime = Math.max(now - this.#lastTimestamp, 1)
    this.#lastTimestamp = now

    const previous  = this.#state
    let totalStep   = 0
    const outputs   = []

    const baseContext = {
      engine:          this,
      cycle:           this.#cycle,
      step:            this.#step,
      cycleCount:      this.#cycleCount,
      memorySignature: this.#memorySignature,
      field:           this.getFieldState(),
      semantic:        this.getSemanticState(),
      deltaTime,
      input,
      options,
    }

    for (const processor of this.#processors) {
      const result = processor({
        state: this.#normalize(previous + totalStep),
        input,
        context: {
          ...baseContext,
          state: this.#normalize(previous + totalStep),
        },
      })

      if (!result) continue
      if (Number.isFinite(result.step)) totalStep += result.step
      if (result.output !== undefined) outputs.push(result.output)
    }

    const prepared = this.#prepareStep(previous, totalStep, deltaTime, now)
    const next     = this.#applyContainment(previous, prepared.appliedStep)

    this.#state = next
    this.#updateField(previous, next, totalStep, prepared.appliedStep, deltaTime)
    this.#updateSemanticState(next)

    const entry = this.#record({
      type:            "process",
      previous,
      next,
      step:            prepared.appliedStep,
      requestedStep:   totalStep,
      rawStep:         totalStep,
      velocity:        totalStep !== 0 ? prepared.velocity : undefined,
      cycleCount:      this.#cycleCount,
      memorySignature: this.#memorySignature,
      field:           this.getFieldState(),
      semantic:        this.getSemanticState(),
      input,
      output:          outputs,
      cycle:           this.#cycle,
      timestamp:       now,
    })

    this.#emit("process", entry)
    this.#emit("tick", entry)
    if (previous !== next) this.#emit("transition", entry)

    return { ...entry }
  }

  tick(input = null) {
    return this.process(input)
  }

  force(step) {
    if (!Number.isFinite(step) || step === 0) throw new Error("CPE_INVALID_FORCE_STEP")

    const now       = this.#clock()
    const deltaTime = Math.max(now - this.#lastTimestamp, 1)
    this.#lastTimestamp = now

    const previous = this.#state
    const prepared = this.#prepareStep(previous, step, deltaTime, now)
    const next     = this.#applyContainment(previous, prepared.appliedStep)

    this.#state = next
    this.#updateField(previous, next, step, prepared.appliedStep, deltaTime)
    this.#updateSemanticState(next)

    const entry = this.#record({
      type:            "transition",
      previous,
      next,
      step:            prepared.appliedStep,
      requestedStep:   step,
      rawStep:         step,
      velocity:        prepared.velocity,
      cycleCount:      this.#cycleCount,
      memorySignature: this.#memorySignature,
      field:           this.getFieldState(),
      semantic:        this.getSemanticState(),
      cycle:           this.#cycle,
      timestamp:       now,
    })

    this.#emit("transition", entry)
    this.#emit("tick", entry)

    return { ...entry }
  }

  transition(step = this.#step) {
    if (!Number.isFinite(step) || step === 0) throw new Error("CPE_INVALID_TRANSITION_STEP")
    return this.force(step)
  }

  analyze(value, options = {}) {
    if (!Number.isFinite(value)) throw new Error("CPE_ANALYZER_INVALID_VALUE")
    const mutate = options.mutate ?? false
    if (!mutate) return this.shadowAnalyze(value)
    return this.#analyzeMutable(value)
  }

  shadowAnalyze(value) {
    if (!Number.isFinite(value)) throw new Error("CPE_ANALYZER_INVALID_VALUE")

    const prev          = this.#state
    const rawDelta      = this.signedDistance(prev, value)
    const effectiveStep = this.#fieldAdjustedStep(rawDelta)
    const projected     = this.#normalize(prev + effectiveStep)
    const diff          = Math.abs(this.signedDistance(prev, projected))

    return this.#buildAnalyzerReport({ diff, projected, previous: prev, mutated: false })
  }

  learnPattern(values) {
    if (!Array.isArray(values) || values.length < 2) throw new Error("CPE_ANALYZER_INVALID_LEARN_VALUES")

    const steps = []

    for (let i = 1; i < values.length; i++) {
      if (!Number.isFinite(values[i]) || !Number.isFinite(values[i - 1])) {
        throw new Error("CPE_ANALYZER_INVALID_LEARN_VALUE_ENTRY")
      }
      steps.push(Math.abs(this.signedDistance(values[i - 1], values[i])))
    }

    const az = this.#az
    az.learnedZScores    = this.#zNormalize(steps)
    az.adaptiveThreshold = az.baseThreshold
    az.trendBuffer       = []
    az.anomalyStartTime  = null
    az.hasData           = false
    az.readingCount      = 0
    az.scoreHistory      = []

    return this
  }

  recalibrateAnalyzer() {
    const az = this.#az
    az.adaptiveThreshold = az.baseThreshold
    az.learnedZScores    = []
    az.trendBuffer       = []
    az.anomalyStartTime  = null
    az.lastSeverity      = 0
    az.hasData           = false
    az.readingCount      = 0
    az.scoreHistory      = []
    return this
  }

  getAnalyzerSeverity() {
    const az = this.#az
    if (!az.hasData) return { severity: null, trend: null, ready: false }
    return { severity: az.lastSeverity, trend: this.#getTrend(), ready: true }
  }

  distance(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("CPE_INVALID_DISTANCE_VALUES")
    return (this.#normalize(to) - this.#normalize(from) + this.#cycle) % this.#cycle
  }

  signedDistance(from, to, options = {}) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("CPE_INVALID_SIGNED_DISTANCE_VALUES")

    const forward  = this.distance(from, to)
    if (forward === 0) return 0

    const backward = forward - this.#cycle
    const prefer   = options.prefer ?? "forward"

    if (Math.abs(backward) === Math.abs(forward)) {
      return prefer === "backward" ? backward : forward
    }

    return Math.abs(backward) < Math.abs(forward) ? backward : forward
  }

  effectiveDistance(from, to) {
    const d = this.signedDistance(from, to)
    return this.#fieldAdjustedStep(d)
  }

  project(steps = 1, stepValue = this.#step) {
    if (!Number.isInteger(steps) || steps < 0) throw new Error("CPE_INVALID_PROJECTION_STEPS")
    if (!Number.isFinite(stepValue)) throw new Error("CPE_INVALID_PROJECTION_STEP_VALUE")
    return this.#normalize(this.#state + steps * this.#fieldAdjustedStep(stepValue))
  }

  isAligned(value) {
    if (!Number.isFinite(value)) throw new Error("CPE_INVALID_ALIGNMENT_VALUE")
    return this.#normalize(value) === this.#state
  }

  rewind(steps = 1) {
    if (!Number.isInteger(steps) || steps <= 0) throw new Error("CPE_INVALID_REWIND_STEPS")
    if (steps > this.#history.length) throw new Error("CPE_REWIND_OUT_OF_RANGE")

    const targetIndex  = this.#history.length - steps
    const entry        = this.#history[targetIndex]
    const previousEntry = this.#history[targetIndex - 1] ?? null

    this.#state          = entry.previous
    this.#cycleCount     = previousEntry?.cycleCount ?? 0
    this.#memorySignature = previousEntry?.memorySignature ?? 0

    if (previousEntry?.field) this.#restoreField(previousEntry.field)
    else this.#resetField()

    this.#archiveHistory(this.#history.slice(targetIndex))
    this.#history = this.#history.slice(0, targetIndex)
    this.#lastTimestamp = this.#clock()
    this.#updateSemanticState(this.#state)

    const payload = {
      type:      "rewind",
      previous:  entry.next,
      next:      entry.previous,
      steps,
      cycle:     this.#cycle,
      timestamp: this.#lastTimestamp,
      field:     this.getFieldState(),
      semantic:  this.getSemanticState(),
    }

    this.#emit("rewind", payload)
    return { ...payload }
  }

  travelTo(index) {
    if (!Number.isInteger(index) || index < 0) throw new Error("CPE_INVALID_TRAVEL_INDEX")
    if (index >= this.#history.length) throw new Error("CPE_TRAVEL_OUT_OF_RANGE")

    const entry = this.#history[index]

    this.#state           = entry.next
    this.#cycleCount      = entry.cycleCount ?? this.#cycleCount
    this.#memorySignature = entry.memorySignature ?? this.#memorySignature

    if (entry.field) this.#restoreField(entry.field)

    this.#archiveHistory(this.#history.slice(index + 1))
    this.#history = this.#history.slice(0, index + 1)
    this.#lastTimestamp = this.#clock()
    this.#updateSemanticState(this.#state)

    const payload = {
      type:      "travel",
      previous:  entry.previous,
      next:      entry.next,
      index,
      cycle:     this.#cycle,
      timestamp: this.#lastTimestamp,
      field:     this.getFieldState(),
      semantic:  this.getSemanticState(),
    }

    this.#emit("travel", payload)
    return { ...payload }
  }

  clearHistory(options = {}) {
    if (options.archive === true) this.#archiveHistory(this.#history)
    this.#history = []
    return this
  }

  clearArchive() {
    this.#archive = []
    return this
  }

  clearCheckpoints() {
    this.#checkpoints = []
    return this
  }

  snapshot() {
    const snap = {
      version:        "CPSE-3.1",
      state:          this.#state,
      step:           this.#step,
      cycle:          this.#cycle,
      maxVelocity:    this.#maxVelocity,
      cycleCount:     this.#cycleCount,
      memorySignature: this.#memorySignature,
      field:          this.getFieldState(),
      semantic:       this.getSemanticState(),
      conceptHistory: this.getConceptHistory(),
      history:        this.getHistory(),
      archive:        this.getArchive(),
      checkpoints:    this.getCheckpoints(),
      timestamp:      this.#clock(),
    }

    this.#emit("snapshot", snap)
    return snap
  }

  restore(snapshot) {
    if (!snapshot || !Number.isFinite(snapshot.state) || !Number.isFinite(snapshot.step) || !Array.isArray(snapshot.history)) {
      throw new Error("CPE_INVALID_SNAPSHOT")
    }

    if (Number.isFinite(snapshot.cycle) && snapshot.cycle !== this.#cycle) {
      throw new Error("CPE_CYCLE_MISMATCH")
    }

    const previous = this.#state

    this.#state           = this.#normalize(snapshot.state)
    this.#step            = Number(snapshot.step)
    this.#cycleCount      = Number.isFinite(snapshot.cycleCount) ? snapshot.cycleCount : 0
    this.#memorySignature = Number.isFinite(snapshot.memorySignature) ? snapshot.memorySignature : 0
    this.#history         = snapshot.history.map(e => this.#sanitizeEntry(e))
    this.#archive         = Array.isArray(snapshot.archive) ? snapshot.archive.map(e => ({ ...e })) : []
    this.#checkpoints     = Array.isArray(snapshot.checkpoints) ? snapshot.checkpoints.map(c => ({ ...c })) : []

    if (snapshot.field) this.#restoreField(snapshot.field)
    else this.#resetField()

    if (Array.isArray(snapshot.conceptHistory)) {
      this.#semantic.conceptHistory = snapshot.conceptHistory.slice(-this.#semantic.maxConceptHistory)
      const last = this.#semantic.conceptHistory[this.#semantic.conceptHistory.length - 1]
      this.#semantic.lastConcept = last?.concept ?? null
    }

    if (Number.isFinite(snapshot.maxVelocity) && snapshot.maxVelocity > 0) {
      this.#maxVelocity = snapshot.maxVelocity
    }

    if (this.#history.length > this.#maxHistory) {
      this.#archiveHistory(this.#history.slice(0, this.#history.length - this.#maxHistory))
      this.#history = this.#history.slice(-this.#maxHistory)
    }

    if (this.#archive.length > this.#maxArchive) {
      this.#archive = this.#archive.slice(-this.#maxArchive)
    }

    this.#lastTimestamp = this.#clock()
    this.#updateSemanticState(this.#state)

    this.#emit("restore", {
      previous,
      next:        this.#state,
      cycleCount:  this.#cycleCount,
      memorySignature: this.#memorySignature,
      historySize: this.#history.length,
      archiveSize: this.#archive.length,
      field:       this.getFieldState(),
      semantic:    this.getSemanticState(),
      timestamp:   this.#lastTimestamp,
    })

    return this
  }

  reset(state = 0) {
    if (!Number.isFinite(state)) throw new Error("CPE_INVALID_RESET_STATE")

    const previous = this.#state

    this.#state           = this.#normalize(state)
    this.#history         = []
    this.#archive         = []
    this.#checkpoints     = []
    this.#attractorVersion = 0
    this.#cycleCount      = 0
    this.#memorySignature = 0
    this.#lastTimestamp   = this.#clock()
    this.#resetField()
    this.recalibrateAnalyzer()
    this.#semantic.conceptHistory    = []
    this.#semantic.lastConcept       = null
    this.#semantic.lastFieldConcepts = {}
    this.#updateSemanticState(this.#state)

    this.#emit("reset", {
      previous,
      next:      this.#state,
      cycle:     this.#cycle,
      field:     this.getFieldState(),
      semantic:  this.getSemanticState(),
      timestamp: this.#lastTimestamp,
    })

    return this
  }

  on(event, listener) {
    if (!this.#listeners[event]) throw new Error("CPE_INVALID_EVENT")
    if (typeof listener !== "function") throw new Error("CPE_INVALID_LISTENER")
    this.#listeners[event].add(listener)
    return () => this.off(event, listener)
  }

  once(event, listener) {
    if (!this.#listeners[event]) throw new Error("CPE_INVALID_EVENT")
    if (typeof listener !== "function") throw new Error("CPE_INVALID_LISTENER")

    const wrapper = (payload, engine) => {
      listener(payload, engine)
      this.off(event, wrapper)
    }

    return this.on(event, wrapper)
  }

  off(event, listener) {
    if (!this.#listeners[event]) throw new Error("CPE_INVALID_EVENT")
    this.#listeners[event].delete(listener)
    return this
  }

  use(plugin) {
    if (typeof plugin !== "function" && (!plugin || typeof plugin.install !== "function")) {
      throw new Error("CPE_INVALID_PLUGIN")
    }

    if (this.#plugins.has(plugin)) return this

    this.#plugins.add(plugin)
    typeof plugin === "function" ? plugin(this) : plugin.install(this)

    return this
  }

  unuse(plugin) {
    this.#plugins.delete(plugin)
    return this
  }

  #prepareStep(previous, requestedStep, deltaTime, now) {
    let appliedStep = this.#fieldAdjustedStep(requestedStep)
    let velocity    = 0

    if (appliedStep !== 0) {
      velocity = Math.abs(appliedStep) / deltaTime

      if (this.#maxVelocity !== Infinity && velocity > this.#maxVelocity) {
        const clamped = Math.sign(appliedStep) * this.#maxVelocity * deltaTime

        this.#emit("velocityExceeded", {
          requested:   requestedStep,
          adjusted:    appliedStep,
          clamped,
          velocity,
          maxVelocity: this.#maxVelocity,
          deltaTime,
          field:       this.getFieldState(),
          timestamp:   now,
        })

        appliedStep = clamped
        velocity    = Math.abs(appliedStep) / deltaTime
      }
    }

    return { appliedStep, velocity }
  }

  #fieldAdjustedStep(step) {
    if (!Number.isFinite(step) || step === 0) return 0

    const sign          = Math.sign(step)
    const magnitude     = Math.abs(step)
    const density       = this.#clamp01(this.#field.constraintDensity)
    const inertia       = this.#clamp01(this.#field.inertia)
    const resistance    = this.#clamp01(this.#field.resistance)
    const attractorPull = this.#nearestAttractorPull(this.#normalize(this.#state + step))

    const penalty      = 1 + density * 0.55 + inertia * 0.35 + resistance * 0.35
    const assist       = 1 + attractorPull * 0.45
    const noveltyBoost = 1 + Math.max(this.#field.noveltyFloor, this.#field.novelty) * 0.10

    return sign * (magnitude / penalty) * assist * noveltyBoost
  }

  #updateField(previous, next, requestedStep, appliedStep, deltaTime) {
    const absRequested      = Math.abs(Number(requestedStep) || 0)
    const absApplied        = Math.abs(Number(appliedStep) || 0)
    const normalizedApplied = this.#clamp01(absApplied / (this.#cycle / 2))
    const loss              = absRequested > 0 ? this.#clamp01(1 - absApplied / absRequested) : 0

    const nearestPull = this.#nearestAttractorPull(next)
    const pressure    = this.#clamp01(normalizedApplied * 0.55 + loss * 0.30 + nearestPull * 0.15)

    this.#field.pressure = pressure

    this.#field.residual = this.#clamp01(
      this.#field.residual * this.#field.residualDecay +
      normalizedApplied * this.#field.residualGain
    )

    this.#field.constraintDensity = this.#clamp01(
      this.#field.constraintDensity * this.#field.densityDecay +
      pressure * this.#field.densityPressureGain +
      this.#field.residual * this.#field.densityResidualGain
    )

    this.#field.inertia = this.#clamp01(
      this.#field.inertia * this.#field.inertiaDecay +
      (1 - loss) * normalizedApplied * this.#field.inertiaGain
    )

    this.#field.curvature = this.#clamp01(
      this.#field.residual * this.#field.curvatureGain +
      this.#field.constraintDensity * (1 - this.#field.curvatureGain)
    )

    this.#field.resistance = this.#clamp01(
      this.#field.constraintDensity * this.#field.resistanceGain +
      this.#field.inertia * (1 - this.#field.resistanceGain)
    )

    this.#field.diffusion = this.#clamp01(
      this.#field.diffusion * (1 - this.#field.diffusionRate) +
      normalizedApplied * this.#field.diffusionRate
    )

    this.#field.novelty = this.#clamp01(
      Math.abs(absRequested - absApplied) / (this.#cycle / 2)
    )

    this.#field.lastEffectiveStep = appliedStep

    this.#updateAttractors(next, normalizedApplied, pressure)
    this.#emit("fieldUpdate", this.getFieldState())
  }

  #updateAttractors(position, motion, pressure) {
    const theta   = this.#normalize(position)
    let matched   = null
    let changed   = false

    for (const a of this.#field.attractors) {
      const d = Math.abs(this.signedDistance(a.theta, theta))
      if (d <= this.#cycle * 0.04) { matched = a; break }
    }

    for (const a of this.#field.attractors) {
      a.strength = this.#clamp01(a.strength * this.#field.attractorDecay)
      a.age     += 1
    }

    if (matched) {
      matched.theta    = this.#normalize((matched.theta * 0.85) + (theta * 0.15))
      matched.strength = this.#clamp01(matched.strength + this.#field.attractorGain + pressure * 0.02)
      matched.hits    += 1
      matched.lastSeen = this.#clock()
    } else {
      this.#field.attractors.push({
        theta,
        strength: this.#clamp01(this.#field.attractorGain + motion * 0.08),
        hits:     1,
        age:      0,
        lastSeen: this.#clock(),
      })
      changed = true
    }

    const prevLen = this.#field.attractors.length

    this.#field.attractors = this.#field.attractors
      .filter(a => a.strength > 0.005)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, this.#field.attractorLimit)
      .map(a => ({
        theta:    this.#round4(this.#normalize(a.theta)),
        strength: this.#round4(this.#clamp01(a.strength)),
        hits:     a.hits,
        age:      a.age,
        lastSeen: a.lastSeen,
      }))

    if (changed || this.#field.attractors.length !== prevLen) {
      this.#attractorVersion++
    }
  }

  #nearestAttractorPull(theta) {
    if (!this.#field.attractors.length) return 0

    let best = 0

    for (const a of this.#field.attractors) {
      const d         = Math.abs(this.signedDistance(theta, a.theta))
      const proximity = this.#clamp01(1 - d / (this.#cycle / 2))
      best = Math.max(best, proximity * a.strength)
    }

    return this.#clamp01(best)
  }

  #analyzeMutable(value) {
    const prev  = this.#state
    const delta = this.signedDistance(prev, value)

    if (delta !== 0) this.force(delta)

    const current = this.#state
    const diff    = Math.abs(this.signedDistance(prev, current))

    return this.#buildAnalyzerReport({ diff, projected: current, previous: prev, mutated: true })
  }

  #buildAnalyzerReport({ diff, projected, previous, mutated }) {
    const az = this.#az

    az.trendBuffer.push(diff)
    if (az.trendBuffer.length > az.trendBufferSize) az.trendBuffer.shift()

    az.hasData = true
    az.readingCount++

    const history = this.getHistory().slice(-az.historyWindow)
    let avgStep   = 0
    let stdDev    = 0
    let steps     = []

    if (history.length > 1) {
      steps   = this.#extractSteps(history)
      avgStep = steps.reduce((s, v) => s + v, 0) / steps.length

      const variance = steps.reduce((s, v) => s + Math.pow(v - avgStep, 2), 0) / Math.max(steps.length - 1, 1)
      stdDev = Math.sqrt(variance)

      const raw        = avgStep + stdDev * 2.5
      const fieldBoost = 1 + this.#field.resistance + this.#field.curvature
      const ceiling    = Number.isFinite(this.#maxVelocity) ? this.#maxVelocity * 6 : az.baseThreshold * 10

      az.adaptiveThreshold = Math.max(
        az.baseThreshold,
        Math.min(raw * fieldBoost, ceiling)
      )
    }

    const trend     = this.#getTrend()
    const deviation = Math.abs(diff - avgStep)
    az.lastSeverity = Math.min(100, Math.round((deviation / (az.adaptiveThreshold * 2)) * 100))

    const similarity        = this.#slidingWindowSimilarity(steps, az.learnedZScores)
    const confidence        = similarity !== null
      ? Math.min(99, Math.round(50 + similarity * 49))
      : Math.min(99, Math.round(40 + (history.length / az.historyWindow) * 50))
    const confidenceSource  = similarity !== null ? "pattern" : "history"
    const eta               = this.#estimateETA(trend, deviation)

    let status = "NORMAL"
    if (deviation > az.adaptiveThreshold * 2) status = "CRITICAL"
    else if (deviation > az.adaptiveThreshold) status = "NOTICE"

    if (status !== "NORMAL" && !az.anomalyStartTime) az.anomalyStartTime = Date.now()
    else if (status === "NORMAL") az.anomalyStartTime = null

    const sinceSec      = az.anomalyStartTime ? ((Date.now() - az.anomalyStartTime) / 1000).toFixed(1) : null
    const behaviorVector = this.#computeBehaviorVector(stdDev, deviation, similarity)
    const health         = this.#classifyHealth(behaviorVector.behavior)

    az.scoreHistory.push({ score: behaviorVector.behavior, time: Date.now() })
    if (az.scoreHistory.length > az.scoreHistorySize) az.scoreHistory.shift()

    const forecast    = this.#computeForecast(behaviorVector.behavior)
    const containment = this.getContainmentState()
    const semantic    = this.getSemanticState()

    const report = {
      status,
      severity:        az.lastSeverity,
      trend,
      eta,
      confidence,
      confidenceSource,
      mutated,
      projected,
      previous,
      field:           this.getFieldState(),
      semantic,
      similarity:      similarity !== null ? Math.round(similarity * 100) + "%" : null,
      avgStep:         Math.round(avgStep * 100) / 100,
      stdDev:          Math.round(stdDev * 100) / 100,
      threshold:       Math.round(az.adaptiveThreshold),
      behaviorVector,
      health,
      forecast,
      containment,
      explain: {
        reason:           this.#buildReason(status, deviation),
        since:            sinceSec ? sinceSec + "s" : null,
        pattern:          this.#classifyPattern(similarity),
        semanticContext:  semantic.context,
        etaUnavailableReason: trend !== "rising" && status === "CRITICAL"
          ? "trend is " + trend + " - deviation may be resolving"
          : null,
      },
    }

    if (status !== "NORMAL") this.#emit("anomaly", { ...report })

    return report
  }

  #normalize(value) {
    return ((Number(value) % this.#cycle) + this.#cycle) % this.#cycle
  }

  #applyContainment(previous, step) {
    if (step === 0) return previous

    const raw   = previous + step
    const next  = this.#normalize(raw)
    const wraps = Math.floor(Math.abs(raw) / this.#cycle)

    if (this.#didWrap(previous, next, step) || wraps > 0) {
      this.#cycleCount += Math.max(1, wraps)
      this.#emit("cycleComplete", {
        cycleCount:      this.#cycleCount,
        memorySignature: this.#memorySignature,
        previous,
        next,
        timestamp:       this.#clock(),
      })
    }

    const phi = 1.6180339887

    this.#memorySignature = Math.round(
      ((this.#memorySignature * phi + next + this.#field.curvature * this.#cycle * 0.1) % this.#cycle) * 1000
    ) / 1000

    return next
  }

  #didWrap(previous, next, step) {
    if (step > 0) return next < previous
    if (step < 0) return next > previous
    return false
  }

  // ─────────────────────────────────────────────
  // #record — compressed storage
  // full snapshot كل checkpointInterval entry
  // delta فقط لما بينها
  // ─────────────────────────────────────────────
  #record(payload) {
    const totalRecords = this.#history.length + 1
    const isCheckpoint = totalRecords % this.#checkpointInterval === 0

    let entry

    if (isCheckpoint) {
      // checkpoint كامل — يُحفظ في checkpoints منفصلاً
      const cp = Object.freeze({
        index:           totalRecords,
        timestamp:       payload.timestamp ?? this.#clock(),
        state:           payload.next,
        cycleCount:      payload.cycleCount,
        memorySignature: payload.memorySignature,
        field:           payload.field,
        semantic:        payload.semantic,
        attractorVersion: this.#attractorVersion,
      })
      this.#checkpoints.push(cp)
      if (this.#checkpoints.length > 50) this.#checkpoints.shift()

      // في الـ history: نسخة كاملة فقط عند الـ checkpoint
      entry = Object.freeze({
        type:            payload.type,
        previous:        payload.previous,
        next:            payload.next,
        step:            payload.step,
        requestedStep:   payload.requestedStep,
        rawStep:         payload.rawStep,
        velocity:        payload.velocity,
        cycleCount:      payload.cycleCount,
        memorySignature: payload.memorySignature,
        field:           payload.field,
        semantic:        payload.semantic,
        input:           payload.input ?? null,
        output:          payload.output ?? [],
        cycle:           this.#cycle,
        timestamp:       payload.timestamp ?? this.#clock(),
        _checkpoint:     true,
      })
    } else {
      // delta فقط — بدون field أو semantic أو attractors
      entry = Object.freeze({
        type:            payload.type,
        previous:        payload.previous,
        next:            payload.next,
        step:            payload.step,
        requestedStep:   payload.requestedStep,
        rawStep:         payload.rawStep,
        velocity:        payload.velocity,
        cycleCount:      payload.cycleCount,
        memorySignature: payload.memorySignature,
        pressure:        payload.field?.pressure        ?? 0,
        novelty:         payload.field?.novelty         ?? 0,
        attractorVersion: this.#attractorVersion,
        input:           payload.input ?? null,
        output:          payload.output ?? [],
        cycle:           this.#cycle,
        timestamp:       payload.timestamp ?? this.#clock(),
      })
    }

    this.#history.push(entry)

    while (this.#history.length > this.#maxHistory) {
      const old = this.#history.shift()
      this.#archiveEntry(old)
    }

    return entry
  }

  #archiveEntry(entry) {
    if (!entry) return

    const archived = Object.freeze({
      type:            "archive",
      originalType:    entry.type,
      previous:        entry.previous,
      next:            entry.next,
      step:            entry.step,
      cycleCount:      entry.cycleCount,
      memorySignature: entry.memorySignature,
      pressure:        entry.pressure ?? entry.field?.pressure ?? 0,
      fieldResidual:   entry.field?.residual   ?? 0,
      fieldCurvature:  entry.field?.curvature  ?? 0,
      fieldResistance: entry.field?.resistance ?? 0,
      concept:         entry.semantic?.state   ?? null,
      timestamp:       entry.timestamp,
      archivedAt:      this.#clock(),
    })

    this.#archive.push(archived)

    while (this.#archive.length > this.#maxArchive) {
      this.#archive.shift()
    }

    this.#emit("archive", archived)
  }

  #archiveHistory(entries) {
    if (!Array.isArray(entries)) return
    for (const e of entries) this.#archiveEntry(e)
  }

  #emit(event, payload) {
    const listeners = this.#listeners[event]
    if (!listeners || listeners.size === 0) return
    for (const listener of listeners) listener({ ...payload }, this)
  }

  #sanitizeEntry(entry) {
    if (!entry || !Number.isFinite(entry.previous) || !Number.isFinite(entry.next)) {
      throw new Error("CPE_INVALID_HISTORY_ENTRY")
    }

    return Object.freeze({
      type:            typeof entry.type === "string" ? entry.type : "process",
      previous:        this.#normalize(entry.previous),
      next:            this.#normalize(entry.next),
      step:            Number.isFinite(entry.step) ? Number(entry.step) : this.signedDistance(entry.previous, entry.next),
      requestedStep:   Number.isFinite(entry.requestedStep) ? Number(entry.requestedStep) : undefined,
      rawStep:         Number.isFinite(entry.rawStep) ? Number(entry.rawStep) : undefined,
      velocity:        Number.isFinite(entry.velocity) ? Number(entry.velocity) : undefined,
      cycleCount:      Number.isFinite(entry.cycleCount) ? entry.cycleCount : 0,
      memorySignature: Number.isFinite(entry.memorySignature) ? entry.memorySignature : 0,
      field:           entry.field    ? { ...entry.field }    : undefined,
      semantic:        entry.semantic ? { ...entry.semantic } : undefined,
      cycle:           this.#cycle,
      timestamp:       Number.isFinite(entry.timestamp) ? Number(entry.timestamp) : this.#clock(),
      input:           entry.input  ?? null,
      output:          Array.isArray(entry.output) ? entry.output : [],
    })
  }

  #restoreField(field) {
    this.#field.residual           = this.#clamp01(field.residual           ?? 0)
    this.#field.constraintDensity  = this.#clamp01(field.constraintDensity  ?? 0)
    this.#field.inertia            = this.#clamp01(field.inertia            ?? 0)
    this.#field.pressure           = this.#clamp01(field.pressure           ?? 0)
    this.#field.curvature          = this.#clamp01(field.curvature          ?? 0)
    this.#field.diffusion          = this.#clamp01(field.diffusion          ?? 0)
    this.#field.resistance         = this.#clamp01(field.resistance         ?? 0)
    this.#field.novelty            = this.#clamp01(field.novelty            ?? 0)
    this.#field.lastEffectiveStep  = Number.isFinite(field.lastEffectiveStep) ? Number(field.lastEffectiveStep) : 0
    this.#field.attractors         = Array.isArray(field.attractors) ? field.attractors.map(a => ({ ...a })) : []
  }

  #resetField() {
    this.#field.residual          = 0
    this.#field.constraintDensity = 0
    this.#field.inertia           = 0
    this.#field.pressure          = 0
    this.#field.curvature         = 0
    this.#field.diffusion         = 0
    this.#field.resistance        = 0
    this.#field.novelty           = 0
    this.#field.lastEffectiveStep = 0
    this.#field.attractors        = []
  }

  #clamp01(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(1, n))
  }

  #round4(v) {
    return Math.round(Number(v || 0) * 10000) / 10000
  }

  #zNormalize(arr) {
    const n = arr.length
    if (n === 0) return []
    const mean = arr.reduce((s, v) => s + v, 0) / n
    const std  = n > 1 ? Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1)) : 0
    if (std === 0) return arr.map(() => 0)
    return arr.map(v => (v - mean) / std)
  }

  #slidingWindowSimilarity(currentSteps, learnedZScores) {
    if (!learnedZScores.length || !currentSteps.length) return null

    const windowSize = Math.min(currentSteps.length, learnedZScores.length)
    const cNorm      = this.#zNormalize(currentSteps.slice(-windowSize))
    const lWindow    = learnedZScores.slice(-windowSize)
    let sumDiff      = 0

    for (let i = 0; i < windowSize; i++) {
      sumDiff += Math.pow(cNorm[i] - lWindow[i], 2)
    }

    return Math.round(Math.max(0, 1 - Math.sqrt(sumDiff / windowSize) / 2) * 100) / 100
  }

  #extractSteps(historySlice) {
    const steps = []
    for (let i = 1; i < historySlice.length; i++) {
      steps.push(Math.abs(this.signedDistance(historySlice[i - 1].next, historySlice[i].next)))
    }
    return steps
  }

  #linearSlope(buffer) {
    const n = buffer.length
    if (n < 2) return 0
    const xm  = (n - 1) / 2
    const ym  = buffer.reduce((s, v) => s + v, 0) / n
    let num   = 0
    let den   = 0
    for (let i = 0; i < n; i++) {
      num += (i - xm) * (buffer[i] - ym)
      den += Math.pow(i - xm, 2)
    }
    return den === 0 ? 0 : num / den
  }

  #getTrend() {
    if (this.#az.trendBuffer.length < 2) return "stable"
    const slope = this.#linearSlope(this.#az.trendBuffer)
    if (slope > 0.5)  return "rising"
    if (slope < -0.5) return "falling"
    return "stable"
  }

  #estimateETA(trend, deviation) {
    if (trend !== "rising") return null
    const remaining = (this.#az.adaptiveThreshold * 2) - deviation
    if (remaining <= 0) return "0.0s"
    const slope = this.#linearSlope(this.#az.trendBuffer)
    if (slope <= 0) return null
    return (remaining / slope).toFixed(1) + "s"
  }

  #buildReason(status, deviation) {
    const t = this.#az.adaptiveThreshold
    if (status === "CRITICAL") return "deviation " + Math.round(deviation) + " exceeded critical threshold " + Math.round(t * 2)
    if (status === "NOTICE")   return "deviation " + Math.round(deviation) + " above notice threshold "    + Math.round(t)
    return "within normal range"
  }

  #classifyPattern(similarity) {
    if (similarity === null)   return "no pattern learned yet"
    if (similarity > 0.8)      return "high match with learned pattern"
    if (similarity > 0.5)      return "partial match"
    return "low match - unknown pattern"
  }

  #computeBehaviorVector(stdDev, deviation, similarity) {
    const az            = this.#az
    const patternWeight = az.learnedZScores.length > 0
      ? Math.min(0.2, 0.2 * (az.readingCount / az.historyWindow))
      : 0
    const rem = 1 - patternWeight

    const stabilityScore = Math.max(0, Math.min(1, 1 - (stdDev / (az.adaptiveThreshold + 1))))
    const deviationScore = Math.min(1, deviation / (az.adaptiveThreshold * 2))
    const patternScore   = similarity ?? 0
    const fieldScore     = Math.max(0, 1 - this.#field.resistance)

    const behaviorScore = Math.round(
      stabilityScore  * (rem * 0.35) +
      (1 - deviationScore) * (rem * 0.35) +
      patternScore    * patternWeight +
      fieldScore      * 0.30
    ) * 100

    return {
      stability: Math.round(stabilityScore * 100),
      deviation: Math.round(deviationScore * 100),
      pattern:   Math.round(patternScore   * 100),
      field:     Math.round(fieldScore     * 100),
      behavior:  Math.max(0, Math.min(100, behaviorScore)),
    }
  }

  #classifyHealth(score) {
    if (score >= 80) return "Stable"
    if (score >= 60) return "Drift"
    if (score >= 40) return "Risk"
    return "Critical"
  }

  #computeForecast(currentScore) {
    const az = this.#az
    if (az.scoreHistory.length < 3) return null

    const slope = this.#linearSlope(az.scoreHistory.map(e => e.score))
    if (slope >= 0) return null

    const degradationPerInterval = Math.abs(slope)

    const fmt = (intervals) => {
      if (intervals === null) return null
      const ms = intervals * az.intervalMs
      if (Math.round(ms / 86400000) >= 2) return Math.round(ms / 86400000) + " days"
      if (Math.round(ms / 3600000)  >= 2) return Math.round(ms / 3600000)  + " hours"
      return Math.round(ms / 60000) + " minutes"
    }

    const intervalsTo = (target) => {
      const gap = currentScore - target
      return gap <= 0 ? null : Math.round(gap / degradationPerInterval)
    }

    return {
      degradationRate: Math.round(degradationPerInterval * 100) / 100,
      score50in:       fmt(intervalsTo(50)),
      score30in:       fmt(intervalsTo(30)),
      confidence:      Math.min(99, Math.round((az.scoreHistory.length / az.scoreHistorySize) * 99)),
    }
  }
}
