export class CELF_Engine_AI {
  constructor(options = {}) {
    this.options = options
    this.space = {
      fields: [],
      projections: [],
      reductions: [],
      decays: [],
      reinforcements: [],
      attractors: [],
      refinements: [],
      signatures: [],
      maxSize: options.maxSize ?? 128
    }

    this.context = {
      lastTimestamp: options.timestamp ?? Date.now(),
      lastVolume: 0,
      eventCount: 0
    }
  }

  process(input, context = {}) {
    const mergedContext = {
      ...this.context,
      ...context
    }

    const rawMotion = receiveRawMotion(input, mergedContext)
    const semanticField = buildSemanticField(rawMotion.source, mergedContext)
    const projection = projectSemanticField(semanticField, this.space)
    const reduction = reducePossibility(semanticField, projection, this.space)
    const decay = decaySemanticField(semanticField, reduction, this.space)
    const reinforcement = reinforceSemanticField(semanticField, decay, this.space)
    const attractor = formAttractor(semanticField, reinforcement, this.space)
    const refined = refineSemanticField(semanticField, attractor, this.space)

    const signature = buildResonanceSignature({
      rawMotion,
      semanticField,
      projection,
      reduction,
      decay,
      reinforcement,
      attractor,
      refined
    })

    this.commit({
      field: semanticField,
      projection,
      reduction,
      decay,
      reinforcement,
      attractor,
      refinement: refined,
      signature
    })

    this.context = {
      lastTimestamp: rawMotion.timestamp,
      lastVolume: rawMotion.tokenCount,
      eventCount: mergedContext.eventCount + 1
    }

    return {
      rawMotion,
      semanticField,
      projection,
      reduction,
      decay,
      reinforcement,
      attractor,
      refined,
      signature
    }
  }

  commit(entry) {
    this.space.fields.push(entry.field)
    this.space.projections.push(entry.projection)
    this.space.reductions.push(entry.reduction)
    this.space.decays.push(entry.decay)
    this.space.reinforcements.push(entry.reinforcement)
    this.space.attractors.push(entry.attractor)
    this.space.refinements.push(entry.refinement)
    this.space.signatures.push(entry.signature)

    this.trim()
  }

  trim() {
    const max = this.space.maxSize

    for (const key of [
      'fields',
      'projections',
      'reductions',
      'decays',
      'reinforcements',
      'attractors',
      'refinements',
      'signatures'
    ]) {
      while (this.space[key].length > max) {
        this.space[key].shift()
      }
    }
  }

  getSpace() {
    return this.space
  }

  reset() {
    this.space.fields = []
    this.space.projections = []
    this.space.reductions = []
    this.space.decays = []
    this.space.reinforcements = []
    this.space.attractors = []
    this.space.refinements = []
    this.space.signatures = []

    this.context = {
      lastTimestamp: Date.now(),
      lastVolume: 0,
      eventCount: 0
    }
  }
}

export function receiveRawMotion(input, context = {}) {
  const now = Number(context.timestamp ?? Date.now())

  const normalizeText = value =>
    typeof value === 'string'
      ? value
      : JSON.stringify(value ?? '')

  const source = normalizeText(input)

  const tokens = source
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const previousTimestamp = Number(context.lastTimestamp ?? now)
  const deltaTime = Math.max(0, now - previousTimestamp)

  const previousVolume = Number(context.lastVolume ?? 0)
  const currentVolume = tokens.length

  const flowVariation = Math.abs(currentVolume - previousVolume)

  const temporalDensity =
    deltaTime > 0
      ? currentVolume / deltaTime
      : currentVolume

  const motionFrequency = normalizeFrequency(
    Number(context.eventCount ?? 1),
    deltaTime
  )

  const transitionRhythm = normalizeRhythm(
    temporalDensity,
    flowVariation
  )

  const continuityTrace = normalizeContinuity(
    deltaTime,
    flowVariation
  )

  return {
    source,
    tokens,
    tokenCount: currentVolume,
    deltaTime,
    temporalDensity,
    motionFrequency,
    transitionRhythm,
    continuityTrace,
    flowVariation,
    timestamp: now
  }
}

export function buildSemanticField(text, context = {}) {
  const source =
    typeof text === 'string'
      ? text.trim()
      : ''

  const tokens =
    source.length > 0
      ? source.split(/\s+/).filter(Boolean)
      : []

  const wordCount = tokens.length

  const continuityMarkers =
    /\b(and|then|because|therefore|also|but|while|if|this|that|which|لكن|لأن|ثم|لذلك|أيضًا|بينما|هذا|الذي)\b/gi

  const abstractionMarkers =
    /\b(system|structure|field|meaning|pattern|semantic|space|possibility|constraint|وعي|نسق|بنية|معنى|فضاء|احتمال|استدلال)\b/gi

  const dispersionMarkers =
    /(\.\.\.|!!!|\?\?\?|,,|;;|###|@@@)/g

  const technicalMarkers =
    /\b(api|server|database|redis|endpoint|function|deploy|latency|timeout|error|كود|سيرفر|خطأ|دالة)\b/gi

  const reactiveMarkers =
    /\b(now|urgent|fast|immediately|broken|panic|حالًا|سريع|طارئ|عاجل|فشل)\b/gi

  const symbolicMarkers =
    /\b(meaning|philosophy|structure|existence|وعي|فلسفة|بنية|معنى|وجود)\b/gi

  const continuityCount =
    (source.match(continuityMarkers) || []).length

  const abstractionCount =
    (source.match(abstractionMarkers) || []).length

  const dispersionCount =
    (source.match(dispersionMarkers) || []).length

  const technicalCount =
    (source.match(technicalMarkers) || []).length

  const reactiveCount =
    (source.match(reactiveMarkers) || []).length

  const symbolicCount =
    (source.match(symbolicMarkers) || []).length

  const continuity = normalize(
    continuityCount / Math.max(3, wordCount * 0.15)
  )

  const abstraction = normalize(
    abstractionCount / Math.max(2, wordCount * 0.12)
  )

  const structuralDispersion = normalize(
    dispersionCount / Math.max(1, wordCount * 0.08)
  )

  const semanticDensity = normalize(
    continuity * 0.4 +
    abstraction * 0.4 +
    (1 - structuralDispersion) * 0.2
  )

  const semanticIntensity = normalize(
    structuralDispersion * 0.5 +
    reactiveCount / Math.max(1, wordCount * 0.1)
  )

  const fieldInstability = normalize(
    Math.abs(continuity - abstraction) * 0.5 +
    structuralDispersion * 0.5
  )

  const transitionEnergy = normalize(
    semanticIntensity * 0.6 +
    fieldInstability * 0.4
  )

  const semanticOrientation = {
    technical: normalize(
      technicalCount / Math.max(1, wordCount * 0.08)
    ),
    reactive: normalize(
      reactiveCount / Math.max(1, wordCount * 0.08)
    ),
    symbolic: normalize(
      symbolicCount / Math.max(1, wordCount * 0.08)
    )
  }

  const coherence = normalize(
    semanticDensity * 0.45 +
    continuity * 0.25 +
    abstraction * 0.2 +
    (1 - fieldInstability) * 0.1
  )

  const containment = normalize(
    semanticDensity * 0.5 +
    continuity * 0.3 +
    (1 - structuralDispersion) * 0.2
  )

  const entropy = normalize(
    fieldInstability * 0.45 +
    semanticIntensity * 0.35 +
    structuralDispersion * 0.2
  )

  const tension = normalize(
    semanticIntensity * 0.5 +
    fieldInstability * 0.3 +
    (1 - containment) * 0.2
  )

  return {
    continuity,
    abstraction,
    structuralDispersion,
    semanticDensity,
    semanticIntensity,
    fieldInstability,
    transitionEnergy,
    semanticOrientation,
    coherence,
    containment,
    entropy,
    tension,
    wordCount,
    timestamp: Number(context.timestamp ?? Date.now())
  }
}

export function projectSemanticField(field, space = {}) {
  const continuity = normalize(field?.continuity)
  const abstraction = normalize(field?.abstraction)
  const density = normalize(field?.semanticDensity)
  const instability = normalize(field?.fieldInstability)
  const energy = normalize(field?.transitionEnergy)

  const orientation = field?.semanticOrientation ?? {}

  const symbolic = normalize(orientation.symbolic)
  const technical = normalize(orientation.technical)
  const reactive = normalize(orientation.reactive)

  const localFields =
    Array.isArray(space?.fields)
      ? space.fields
      : []

  const localDensity = averageLocal(
    localFields,
    'semanticDensity',
    density
  )

  const localInstability = averageLocal(
    localFields,
    'fieldInstability',
    instability
  )

  const localContinuity = averageLocal(
    localFields,
    'continuity',
    continuity
  )

  const localAbstraction = averageLocal(
    localFields,
    'abstraction',
    abstraction
  )

  const pressureGradient = normalize(
    Math.abs(density - localDensity) * 0.5 +
    Math.abs(instability - localInstability) * 0.3 +
    Math.abs(continuity - localContinuity) * 0.2
  )

  const continuityFlow = continuity - localContinuity
  const abstractionFlow = abstraction - localAbstraction
  const densityFlow = density - localDensity
  const instabilityFlow = instability - localInstability

  const directionalFlow = {
    continuity: continuityFlow,
    abstraction: abstractionFlow,
    density: densityFlow,
    instability: instabilityFlow
  }

  const directionalMagnitude = Math.sqrt(
    Math.pow(continuityFlow, 2) +
    Math.pow(abstractionFlow, 2) +
    Math.pow(densityFlow, 2) +
    Math.pow(instabilityFlow, 2)
  )

  const radius = normalize(
    density * 0.4 +
    continuity * 0.3 +
    abstraction * 0.2 +
    (1 - instability) * 0.1
  )

  const fieldPressure = normalize(
    pressureGradient * 0.5 +
    energy * 0.5
  )

  const attractorAffinity = normalize(
    density * 0.35 +
    continuity * 0.3 +
    abstraction * 0.2 +
    (1 - instability) * 0.15
  )

  const spatialTension = normalize(
    fieldPressure * 0.55 +
    instability * 0.45
  )

  const localResonance = normalize(
    1 - directionalMagnitude / 2
  )

  const orientationField = {
    symbolic,
    technical,
    reactive
  }

  return {
    radius,
    localDensity,
    localInstability,
    localContinuity,
    localAbstraction,
    pressureGradient,
    fieldPressure,
    attractorAffinity,
    spatialTension,
    localResonance,
    directionalMagnitude,
    directionalFlow,
    orientationField,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

export function reducePossibility(field, projection, space = {}) {
  const coherence = normalize(field?.coherence)
  const containment = normalize(field?.containment)
  const entropy = normalize(field?.entropy)
  const tension = normalize(field?.tension)
  const density = normalize(field?.semanticDensity)
  const instability = normalize(field?.fieldInstability)

  const resonance = normalize(projection?.localResonance)
  const affinity = normalize(projection?.attractorAffinity)
  const pressure = normalize(projection?.fieldPressure)
  const directionalMagnitude = normalize(projection?.directionalMagnitude)

  const localFields =
    Array.isArray(space?.fields)
      ? space.fields
      : []

  const fieldResistance = normalize(
    entropy * 0.25 +
    tension * 0.2 +
    instability * 0.2 +
    pressure * 0.15 +
    directionalMagnitude * 0.2
  )

  const adaptiveCapacity = normalize(
    coherence * 0.3 +
    containment * 0.25 +
    resonance * 0.2 +
    affinity * 0.15 +
    density * 0.1
  )

  const propagationPotential = normalize(
    adaptiveCapacity * (1 - fieldResistance)
  )

  const containmentPressure = normalize(
    fieldResistance * 0.6 +
    (1 - resonance) * 0.4
  )

  const spaceFlexibility = normalize(
    adaptiveCapacity * 0.5 +
    (1 - entropy) * 0.3 +
    (1 - instability) * 0.2
  )

  const structuralCompression = normalize(
    containmentPressure * 0.55 +
    directionalMagnitude * 0.25 +
    pressure * 0.2
  )

  const persistenceProbability = normalize(
    propagationPotential * 0.5 +
    resonance * 0.3 +
    affinity * 0.2
  )

  const spatialAdaptation = normalize(
    spaceFlexibility * 0.5 +
    adaptiveCapacity * 0.3 +
    (1 - structuralCompression) * 0.2
  )

  return {
    fieldResistance,
    adaptiveCapacity,
    propagationPotential,
    containmentPressure,
    spaceFlexibility,
    structuralCompression,
    persistenceProbability,
    spatialAdaptation,
    localFieldCount: localFields.length,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

export function decaySemanticField(field, reduction, space = {}) {
  const propagationPotential =
    normalize(reduction?.propagationPotential)

  const structuralCompression =
    normalize(reduction?.structuralCompression)

  const containmentPressure =
    normalize(reduction?.containmentPressure)

  const spatialAdaptation =
    normalize(reduction?.spatialAdaptation)

  const persistenceProbability =
    normalize(reduction?.persistenceProbability)

  const localReductions =
    Array.isArray(space?.reductions)
      ? space.reductions
      : []

  const localPersistence =
    localReductions.length > 0
      ? localReductions.reduce(
          (sum, item) =>
            sum + normalize(item?.persistenceProbability),
          0
        ) / localReductions.length
      : persistenceProbability

  const localCompression =
    localReductions.length > 0
      ? localReductions.reduce(
          (sum, item) =>
            sum + normalize(item?.structuralCompression),
          0
        ) / localReductions.length
      : structuralCompression

  const spatialNarrowing = normalize(
    structuralCompression * 0.45 +
    containmentPressure * 0.35 +
    (1 - spatialAdaptation) * 0.2
  )

  const fieldDissolution = normalize(
    spatialNarrowing * 0.5 +
    (1 - propagationPotential) * 0.3 +
    (1 - persistenceProbability) * 0.2
  )

  const memoryResidual = normalize(
    persistenceProbability * 0.5 +
    propagationPotential * 0.3 +
    (1 - structuralCompression) * 0.2
  )

  const survivability = normalize(
    memoryResidual * 0.6 +
    spatialAdaptation * 0.4
  )

  const spatialIsolation = normalize(
    spatialNarrowing * 0.55 +
    localCompression * 0.25 +
    (1 - localPersistence) * 0.2
  )

  const attractorDecay = normalize(
    fieldDissolution * 0.5 +
    spatialIsolation * 0.3 +
    (1 - survivability) * 0.2
  )

  return {
    spatialNarrowing,
    fieldDissolution,
    memoryResidual,
    survivability,
    spatialIsolation,
    attractorDecay,
    localPersistence,
    localCompression,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

export function reinforceSemanticField(field, decay, space = {}) {
  const survivability = normalize(decay?.survivability)
  const memoryResidual = normalize(decay?.memoryResidual)
  const spatialIsolation = normalize(decay?.spatialIsolation)
  const attractorDecay = normalize(decay?.attractorDecay)

  const localProjections =
    Array.isArray(space?.projections)
      ? space.projections
      : []

  const localFields =
    Array.isArray(space?.fields)
      ? space.fields
      : []

  const localResonance =
    localProjections.length > 0
      ? localProjections.reduce(
          (sum, item) =>
            sum + normalize(item?.localResonance),
          0
        ) / localProjections.length
      : survivability

  const localStability =
    localFields.length > 0
      ? localFields.reduce(
          (sum, item) =>
            sum + normalize(item?.coherence),
          0
        ) / localFields.length
      : survivability

  const resonanceAmplification = normalize(
    survivability * 0.35 +
    memoryResidual * 0.25 +
    localResonance * 0.4
  )

  const structuralReinforcement = normalize(
    resonanceAmplification * 0.4 +
    localStability * 0.35 +
    (1 - spatialIsolation) * 0.25
  )

  const attractorStrength = normalize(
    structuralReinforcement * 0.45 +
    resonanceAmplification * 0.35 +
    (1 - attractorDecay) * 0.2
  )

  const fieldPersistence = normalize(
    attractorStrength * 0.4 +
    survivability * 0.35 +
    memoryResidual * 0.25
  )

  const adaptiveStability = normalize(
    fieldPersistence * 0.45 +
    localStability * 0.35 +
    resonanceAmplification * 0.2
  )

  const spatialExpansion = normalize(
    adaptiveStability * 0.45 +
    attractorStrength * 0.35 +
    (1 - spatialIsolation) * 0.2
  )

  const learningGradient = normalize(
    spatialExpansion * 0.4 +
    adaptiveStability * 0.35 +
    attractorStrength * 0.25
  )

  return {
    resonanceAmplification,
    structuralReinforcement,
    attractorStrength,
    fieldPersistence,
    adaptiveStability,
    spatialExpansion,
    learningGradient,
    localResonance,
    localStability,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

export function formAttractor(field, reinforcement, space = {}) {
  const attractorStrength =
    normalize(reinforcement?.attractorStrength)

  const fieldPersistence =
    normalize(reinforcement?.fieldPersistence)

  const adaptiveStability =
    normalize(reinforcement?.adaptiveStability)

  const spatialExpansion =
    normalize(reinforcement?.spatialExpansion)

  const learningGradient =
    normalize(reinforcement?.learningGradient)

  const localReinforcements =
    Array.isArray(space?.reinforcements)
      ? space.reinforcements
      : []

  const localAttractorDensity =
    localReinforcements.length > 0
      ? localReinforcements.reduce(
          (sum, item) =>
            sum + normalize(item?.attractorStrength),
          0
        ) / localReinforcements.length
      : attractorStrength

  const localPersistence =
    localReinforcements.length > 0
      ? localReinforcements.reduce(
          (sum, item) =>
            sum + normalize(item?.fieldPersistence),
          0
        ) / localReinforcements.length
      : fieldPersistence

  const structuralGravity = normalize(
    attractorStrength * 0.4 +
    adaptiveStability * 0.3 +
    localAttractorDensity * 0.3
  )

  const attractorCurvature = normalize(
    structuralGravity * 0.45 +
    spatialExpansion * 0.35 +
    learningGradient * 0.2
  )

  const resonanceField = normalize(
    fieldPersistence * 0.4 +
    localPersistence * 0.35 +
    adaptiveStability * 0.25
  )

  const convergencePotential = normalize(
    attractorCurvature * 0.45 +
    resonanceField * 0.35 +
    structuralGravity * 0.2
  )

  const fieldAlignment = normalize(
    convergencePotential * 0.4 +
    resonanceField * 0.35 +
    (1 - Math.abs(localAttractorDensity - attractorStrength)) * 0.25
  )

  const attractorStability = normalize(
    fieldAlignment * 0.45 +
    convergencePotential * 0.35 +
    adaptiveStability * 0.2
  )

  return {
    structuralGravity,
    attractorCurvature,
    resonanceField,
    convergencePotential,
    fieldAlignment,
    attractorStability,
    localAttractorDensity,
    localPersistence,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

export function refineSemanticField(field, attractor, space = {}) {
  const structuralGravity =
    normalize(attractor?.structuralGravity)

  const attractorCurvature =
    normalize(attractor?.attractorCurvature)

  const resonanceField =
    normalize(attractor?.resonanceField)

  const convergencePotential =
    normalize(attractor?.convergencePotential)

  const fieldAlignment =
    normalize(attractor?.fieldAlignment)

  const attractorStability =
    normalize(attractor?.attractorStability)

  const localAttractors =
    Array.isArray(space?.attractors)
      ? space.attractors
      : []

  const localAlignment =
    localAttractors.length > 0
      ? localAttractors.reduce(
          (sum, item) =>
            sum + normalize(item?.fieldAlignment),
          0
        ) / localAttractors.length
      : fieldAlignment

  const localStability =
    localAttractors.length > 0
      ? localAttractors.reduce(
          (sum, item) =>
            sum + normalize(item?.attractorStability),
          0
        ) / localAttractors.length
      : attractorStability

  const refinedCoherence = normalize(
    fieldAlignment * 0.35 +
    resonanceField * 0.25 +
    convergencePotential * 0.2 +
    localAlignment * 0.2
  )

  const structuralPurity = normalize(
    refinedCoherence * 0.4 +
    attractorStability * 0.35 +
    localStability * 0.25
  )

  const persistenceIntegrity = normalize(
    structuralPurity * 0.45 +
    structuralGravity * 0.3 +
    resonanceField * 0.25
  )

  const adaptiveHarmony = normalize(
    persistenceIntegrity * 0.4 +
    convergencePotential * 0.35 +
    (1 - Math.abs(localAlignment - fieldAlignment)) * 0.25
  )

  const refinedDensity = normalize(
    adaptiveHarmony * 0.4 +
    refinedCoherence * 0.35 +
    attractorCurvature * 0.25
  )

  const refinedField = normalize(
    refinedDensity * 0.35 +
    adaptiveHarmony * 0.3 +
    persistenceIntegrity * 0.2 +
    structuralPurity * 0.15
  )

  return {
    refinedCoherence,
    structuralPurity,
    persistenceIntegrity,
    adaptiveHarmony,
    refinedDensity,
    refinedField,
    localAlignment,
    localStability,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

export function buildResonanceSignature(state) {
  const field = state.semanticField ?? {}
  const projection = state.projection ?? {}
  const reduction = state.reduction ?? {}
  const decay = state.decay ?? {}
  const reinforcement = state.reinforcement ?? {}
  const attractor = state.attractor ?? {}
  const refined = state.refined ?? {}

  const signatureVector = {
    motion: normalize(state.rawMotion?.transitionRhythm),
    continuity: normalize(field.continuity),
    density: normalize(field.semanticDensity),
    resonance: normalize(projection.localResonance),
    pressure: normalize(reduction.containmentPressure),
    residual: normalize(decay.memoryResidual),
    reinforcement: normalize(reinforcement.structuralReinforcement),
    gravity: normalize(attractor.structuralGravity),
    refinement: normalize(refined.refinedField)
  }

  const resonanceSignature = normalize(
    signatureVector.motion * 0.1 +
    signatureVector.continuity * 0.1 +
    signatureVector.density * 0.12 +
    signatureVector.resonance * 0.13 +
    signatureVector.pressure * 0.1 +
    signatureVector.residual * 0.1 +
    signatureVector.reinforcement * 0.13 +
    signatureVector.gravity * 0.12 +
    signatureVector.refinement * 0.1
  )

  return {
    resonanceSignature,
    signatureVector,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

function normalizeFrequency(events, delta) {
  if (!Number.isFinite(events)) {
    return 0
  }

  if (!Number.isFinite(delta) || delta <= 0) {
    return 1
  }

  return Math.min(
    1,
    events / Math.max(1, delta / 1000)
  )
}

function normalizeRhythm(density, variation) {
  const value =
    density * 0.6 +
    (1 / (1 + variation)) * 0.4

  return normalize(value)
}

function normalizeContinuity(delta, variation) {
  const temporal =
    1 / (1 + delta / 1000)

  const structural =
    1 / (1 + variation)

  return normalize(
    temporal * 0.5 +
    structural * 0.5
  )
}

function normalize(value, min = 0, max = 1) {
  const n = Number(value)

  if (!Number.isFinite(n)) {
    return 0
  }

  return Math.max(min, Math.min(max, n))
}

function averageLocal(items, key, fallback) {
  if (!Array.isArray(items) || items.length === 0) {
    return normalize(fallback)
  }

  return items.reduce(
    (sum, item) =>
      sum + normalize(item?.[key]),
    0
  ) / items.length
}
