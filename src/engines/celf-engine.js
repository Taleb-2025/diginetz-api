// ============================================================
//  CELF Engine AI — v4.0
//
//  v3 additions: feedback loop, trajectory, novelty-safe reduction,
//                survival trim, recursive reprojection
//
//  v4 fixes:
//  [F1] Atomic trim — same index removed from ALL arrays (coherence)
//  [F2] Freshness decay — old attractors lose pull over time
//  [F3] emergence/delta wired into reinforcement & attractor formation
// ============================================================

// ─────────────────────────────────────────────
//  MAIN CLASS
// ─────────────────────────────────────────────

export class CELF_Engine_AI {
  constructor(options = {}) {
    this.options = options

    this.space = {
      fields:         [],
      projections:    [],
      reductions:     [],
      decays:         [],
      reinforcements: [],
      attractors:     [],
      refinements:    [],
      signatures:     [],
      similarities:   [],
      maxSize:        options.maxSize ?? 128
    }

    // [2] Trajectory memory — replaces single lastField
    this.trajectory = {
      states:       [],   // rolling window of key field metrics
      direction:    null, // current vector of change
      speed:        0,    // magnitude of last change
      pattern:      null, // detected repeating motif
      maxLength:    options.trajectoryLength ?? 32
    }

    this.context = {
      lastTimestamp: options.timestamp ?? Date.now(),
      lastVolume:    0,
      eventCount:    0
    }
  }

  // ── Main pipeline ────────────────────────────────────────────
  process(input, context = {}) {
    const mergedContext = {
      ...this.context,
      ...context,
      trajectory: this.trajectory   // pass trajectory into all layers
    }

    // Layer 1 — Reception
    const normalized    = normalizeInput(input)
    const rawMotion     = receiveRawMotion(normalized.text, mergedContext, normalized.meta)

    // Layer 2 — Semantic Parsing (uses trajectory for drift)
    const semanticField = buildSemanticField(rawMotion.source, mergedContext)

    // Layer 3 — Spatial Projection
    let projection      = projectSemanticField(semanticField, this.space)

    // [1] Attractor Feedback — attractors bend the projection
    projection          = distortProjectionByAttractors(projection, this.space.attractors)

    // Layer 4 — Pattern Similarity (uses trajectory)
    const similarity    = computePatternSimilarity(semanticField, projection, this.space, this.trajectory)

    // Layer 5 — Possibility Reduction (novelty-safe)
    const reduction     = reducePossibility(semanticField, projection, similarity, this.space)

    // Layer 6 — Decay
    const decay         = decaySemanticField(semanticField, reduction, this.space)

    // [F3] Use last cycle's reprojection to modulate reinforcement & attractor
    const prevReprojection = this.context.lastReprojection ?? null

    // Layer 7 — Reinforcement (receives previous reprojection emergence signal)
    const reinforcement = reinforceSemanticField(semanticField, decay, this.space, prevReprojection)

    // Layer 8 — Attractor Formation (receives previous reprojection delta signal)
    const attractor     = formAttractor(semanticField, reinforcement, this.space, prevReprojection)

    // Layer 9 — Refined Honey
    const refined       = refineSemanticField(semanticField, attractor, this.space)

    // [5] Recursive Reprojection — result feeds into NEXT cycle's layers 7 & 8
    const reprojection  = reprojectRefinedField(refined, projection, this.space, this.trajectory)

    // Signature (includes reprojection delta)
    const signature     = buildResonanceSignature({
      rawMotion, semanticField, projection, similarity,
      reduction, decay, reinforcement, attractor, refined, reprojection
    })

    // Commit to space
    this.commit({
      field: semanticField, projection, similarity,
      reduction, decay, reinforcement, attractor,
      refinement: refined, signature
    })

    // [2] Update trajectory
    this.updateTrajectory(semanticField, signature)

    // Update context — store reprojection for next cycle [F3]
    this.context = {
      lastTimestamp:    rawMotion.timestamp,
      lastVolume:       rawMotion.tokenCount,
      eventCount:       mergedContext.eventCount + 1,
      lastReprojection: reprojection   // [F3] feeds into next cycle's layers 7 & 8
    }

    return {
      rawMotion, semanticField, projection, similarity,
      reduction, decay, reinforcement, attractor,
      refined, reprojection, signature,
      trajectory: this.getTrajectorySnapshot()
    }
  }

  // ── [2] Trajectory update ─────────────────────────────────────
  updateTrajectory(field, signature) {
    const snapshot = {
      continuity:    field.continuity,
      abstraction:   field.abstraction,
      density:       field.semanticDensity,
      coherence:     field.coherence,
      entropy:       field.entropy,
      drift:         field.drift,
      resonance:     signature.resonanceSignature,
      intent:        field.intent,
      reasoningMode: field.reasoningMode,
      timestamp:     field.timestamp
    }

    const traj = this.trajectory
    const prev = traj.states.length > 0 ? traj.states[traj.states.length - 1] : null

    // Direction vector (change from previous)
    if (prev) {
      traj.direction = {
        continuity:  snapshot.continuity  - prev.continuity,
        abstraction: snapshot.abstraction - prev.abstraction,
        density:     snapshot.density     - prev.density,
        coherence:   snapshot.coherence   - prev.coherence,
        entropy:     snapshot.entropy     - prev.entropy,
        resonance:   snapshot.resonance   - prev.resonance
      }

      // Speed = magnitude of direction vector
      traj.speed = normalize(Math.sqrt(
        Object.values(traj.direction).reduce((s, v) => s + v * v, 0)
      ))
    } else {
      traj.direction = null
      traj.speed     = 0
    }

    // Push snapshot and trim
    traj.states.push(snapshot)
    while (traj.states.length > traj.maxLength) traj.states.shift()

    // Pattern detection: check if intent/reasoningMode repeats
    traj.pattern = detectTrajectoryPattern(traj.states)
  }

  getTrajectorySnapshot() {
    return {
      length:    this.trajectory.states.length,
      speed:     this.trajectory.speed,
      direction: this.trajectory.direction,
      pattern:   this.trajectory.pattern
    }
  }

  // ── Commit ────────────────────────────────────────────────────
  commit(entry) {
    const keys = [
      'fields', 'projections', 'similarities', 'reductions',
      'decays', 'reinforcements', 'attractors', 'refinements', 'signatures'
    ]
    const values = [
      entry.field, entry.projection, entry.similarity, entry.reduction,
      entry.decay, entry.reinforcement, entry.attractor, entry.refinement, entry.signature
    ]
    keys.forEach((k, i) => {
      if (Array.isArray(this.space[k])) this.space[k].push(values[i])
    })
    this.trim()
  }

  // ── [F1] Atomic trim — same index removed from ALL arrays ────
  trim() {
    const max  = this.space.maxSize
    const keys = [
      'fields', 'projections', 'similarities', 'reductions', 'decays',
      'reinforcements', 'attractors', 'refinements', 'signatures'
    ]

    // Check if any array exceeds max (they should all be equal length)
    const len = this.space.fields.length
    if (len <= max) return

    // Compute survival score using 'fields' as the primary source of truth
    // (all arrays are aligned — fields[i] corresponds to projections[i] etc.)
    const fields = this.space.fields
    const scores = fields.map((item, idx) => ({
      idx,
      score: computeSurvivalScore(item, 'fields', fields, idx)
    }))

    // Find the single index with lowest survival score
    scores.sort((a, b) => a.score - b.score)
    const removeIdx = scores[0].idx

    // [F1] Remove that exact index from EVERY array atomically
    for (const key of keys) {
      if (Array.isArray(this.space[key]) && this.space[key].length > removeIdx) {
        this.space[key].splice(removeIdx, 1)
      }
    }
  }

  getSpace()   { return this.space }
  getContext() { return this.context }

  reset() {
    for (const key of Object.keys(this.space)) {
      if (Array.isArray(this.space[key])) this.space[key] = []
    }
    this.trajectory = {
      states: [], direction: null, speed: 0,
      pattern: null, maxLength: this.trajectory.maxLength
    }
    this.context = {
      lastTimestamp: Date.now(), lastVolume: 0, eventCount: 0
    }
  }

  explain(output) {
    if (!output?.signature) return 'No output to explain.'
    const sf   = output.semanticField
    const traj = output.trajectory
    const repr = output.reprojection

    return [
      `Resonance: ${output.signature.resonanceSignature.toFixed(3)}`,
      `Intent: ${sf.intent}`,
      `Mode: ${sf.reasoningMode}`,
      `Drift: ${sf.drift?.toFixed(3) ?? 'N/A'}`,
      `Coherence: ${sf.coherence.toFixed(3)}`,
      `Refined: ${output.refined.refinedField.toFixed(3)}`,
      `Traj.Speed: ${traj?.speed?.toFixed(3) ?? 'N/A'}`,
      `Traj.Pattern: ${traj?.pattern ?? 'none'}`,
      `Repr.Delta: ${repr?.delta?.toFixed(3) ?? 'N/A'}`
    ].join(' | ')
  }
}

// ─────────────────────────────────────────────
//  [1] ATTRACTOR FEEDBACK — distort projection
// ─────────────────────────────────────────────

/**
 * Attractors that have formed pull the current projection toward them.
 * Strong, stable attractors create "gravity wells" that bend the field.
 */
export function distortProjectionByAttractors(projection, attractors = []) {
  if (!Array.isArray(attractors) || attractors.length === 0) return projection

  // Only consider stable attractors (high attractorStability)
  const stable = attractors.filter(a => normalize(a?.attractorStability) > 0.45)
  if (stable.length === 0) return projection

  const now = Date.now()

  // [F2] Freshness decay: weight each attractor by how recent it is
  // Older attractors get lower weight — prevents the system freezing on old patterns
  const decayHalfLife = 60_000  // 60 seconds half-life (tuneable)

  const weightedAttractors = stable.map(a => {
    const age      = Math.max(0, now - Number(a?.timestamp ?? now))
    const freshness = Math.exp(-age / decayHalfLife)   // exponential decay [0,1]
    return { a, freshness }
  })

  const totalWeight = weightedAttractors.reduce((s, { freshness }) => s + freshness, 0) || 1

  // Weighted averages instead of simple averages
  const avgGravity     = weightedAttractors.reduce((s, { a, freshness }) => s + normalize(a?.structuralGravity)      * freshness, 0) / totalWeight
  const avgAlignment   = weightedAttractors.reduce((s, { a, freshness }) => s + normalize(a?.fieldAlignment)         * freshness, 0) / totalWeight
  const avgConvergence = weightedAttractors.reduce((s, { a, freshness }) => s + normalize(a?.convergencePotential)   * freshness, 0) / totalWeight
  const avgStability   = weightedAttractors.reduce((s, { a, freshness }) => s + normalize(a?.attractorStability)     * freshness, 0) / totalWeight
  const avgFreshness   = weightedAttractors.reduce((s, { freshness })    => s + freshness, 0) / stable.length

  // Pull strength scaled by freshness — stale attractors pull less
  const pullStrength = normalize(
    (avgGravity * 0.4 + avgStability * 0.3 + avgConvergence * 0.3) * avgFreshness
  )

  const blend = (current, target, strength) =>
    normalize(current * (1 - strength * 0.4) + target * strength * 0.4)

  return {
    ...projection,
    radius:            blend(projection.radius,            avgGravity,    pullStrength),
    localResonance:    blend(projection.localResonance,    avgAlignment,  pullStrength),
    attractorAffinity: blend(projection.attractorAffinity, avgConvergence, pullStrength),
    spatialTension:    normalize(projection.spatialTension * (1 - pullStrength * 0.25)),
    attractorFeedback: {
      stableCount:  stable.length,
      pullStrength,
      avgFreshness: avgFreshness.toFixed ? avgFreshness : 0,
      avgGravity,
      avgAlignment,
      avgStability
    }
  }
}

// ─────────────────────────────────────────────
//  [2] TRAJECTORY PATTERN DETECTION
// ─────────────────────────────────────────────

/**
 * Detects repeating intent/mode patterns in trajectory states.
 * Returns a string label or null.
 */
function detectTrajectoryPattern(states) {
  if (states.length < 4) return null

  const recent = states.slice(-8)

  // Check if intent is stable
  const intents = recent.map(s => s.intent)
  const dominantIntent = mode(intents)
  const intentStability = intents.filter(i => i === dominantIntent).length / intents.length

  // Check if reasoning mode is stable
  const modes = recent.map(s => s.reasoningMode)
  const dominantMode = mode(modes)
  const modeStability = modes.filter(m => m === dominantMode).length / modes.length

  // Oscillation: alternating between two intents
  const isOscillating = recent.length >= 4 &&
    recent.slice(-4).every((s, i) =>
      i % 2 === 0
        ? s.intent === recent[recent.length - 4].intent
        : s.intent !== recent[recent.length - 4].intent
    )

  if (isOscillating) return 'oscillating'
  if (intentStability > 0.75 && modeStability > 0.75) return `stable:${dominantIntent}+${dominantMode}`
  if (intentStability > 0.75) return `intent-locked:${dominantIntent}`
  if (modeStability  > 0.75) return `mode-locked:${dominantMode}`

  return null
}

function mode(arr) {
  const freq = {}
  arr.forEach(v => { freq[v] = (freq[v] ?? 0) + 1 })
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

// ─────────────────────────────────────────────
//  [4] SURVIVAL SCORE for trim
// ─────────────────────────────────────────────

/**
 * Computes a survival score that balances:
 * - resonance (strength)
 * - novelty/rarity (anomalous = rare = preserve)
 * - recency (recent entries slightly favored)
 */
function computeSurvivalScore(item, key, arr, idx) {
  if (!item) return 0

  const recency = idx / Math.max(1, arr.length - 1)  // 0=oldest, 1=newest

  let resonance = 0
  let novelty   = 0

  if (key === 'signatures') {
    resonance = normalize(item?.resonanceSignature)
  } else if (key === 'fields') {
    resonance = normalize(item?.coherence)
    novelty   = normalize(item?.entropy) // high entropy = anomalous = valuable seed
  } else if (key === 'attractors') {
    resonance = normalize(item?.attractorStability)
  } else if (key === 'reinforcements') {
    resonance = normalize(item?.attractorStrength)
  } else if (key === 'reductions') {
    novelty   = normalize(item?.noveltyPotential)
    resonance = normalize(item?.persistenceProbability)
  } else {
    resonance = 0.5
  }

  // Rarity bonus: entries far from the mean get a survival boost
  const rarityBonus = novelty > 0.7 ? 0.2 : 0

  return normalize(
    resonance * 0.45 +
    recency   * 0.30 +
    novelty   * 0.15 +
    rarityBonus
  )
}

// ─────────────────────────────────────────────
//  [5] RECURSIVE REPROJECTION
// ─────────────────────────────────────────────

/**
 * The refined field is re-projected back into the semantic space.
 * This compares the reprojected state against:
 * - the original projection
 * - the trajectory
 * Returns a delta that measures structural emergence.
 */
export function reprojectRefinedField(refined, originalProjection, space = {}, trajectory = {}) {
  // Build a synthetic field from refined values
  const syntheticField = {
    continuity:       normalize(refined.refinedCoherence),
    abstraction:      normalize(refined.structuralPurity),
    semanticDensity:  normalize(refined.refinedDensity),
    fieldInstability: normalize(1 - refined.adaptiveHarmony),
    transitionEnergy: normalize(1 - refined.persistenceIntegrity),
    drift:            0,
    confidence:       1,
    semanticOrientation: { symbolic: 0.5, technical: 0.3, reactive: 0.2 },
    timestamp:        refined.timestamp ?? Date.now()
  }

  // Re-project the synthetic field
  const reprojecttion = projectSemanticField(syntheticField, space)

  // Delta between original and reprojected
  const delta = normalize(
    Math.abs(reprojecttion.radius         - originalProjection.radius)         * 0.3 +
    Math.abs(reprojecttion.localResonance - originalProjection.localResonance) * 0.3 +
    Math.abs(reprojecttion.spatialTension - originalProjection.spatialTension) * 0.2 +
    Math.abs(reprojecttion.fieldPressure  - originalProjection.fieldPressure)  * 0.2
  )

  // Trajectory alignment: does the reprojection follow the trajectory direction?
  const trajSpeed = normalize(trajectory?.speed ?? 0)
  const trajAlignment = trajectory?.direction
    ? normalize(1 - Math.abs(
        (reprojecttion.radius - originalProjection.radius) -
        (trajectory.direction.density ?? 0)
      ))
    : 0.5

  // Emergence score: high delta + trajectory alignment = new stable structure emerging
  const emergence = normalize(delta * 0.5 + trajAlignment * 0.3 + trajSpeed * 0.2)

  return {
    syntheticField,
    reprojection:  reprojecttion,
    delta,
    trajAlignment,
    emergence,
    angle:         reprojecttion.angle,
    radius:        reprojecttion.radius,
    timestamp:     refined.timestamp ?? Date.now()
  }
}

// ─────────────────────────────────────────────
//  LAYER 1 — Input Normalization
// ─────────────────────────────────────────────

export function normalizeInput(input) {
  if (typeof input === 'string') {
    return { text: input, meta: { inputType: 'text' } }
  }

  if (input && typeof input === 'object' && input.type) {
    const payload = input.payload ?? input.data ?? input.message ?? ''
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    return {
      text,
      meta: {
        inputType:  input.type,
        level:      input.level    ?? null,
        retryCount: input.retries  ?? null,
        eventName:  input.name     ?? null,
        severity:   input.severity ?? null
      }
    }
  }

  if (input instanceof Error) {
    return {
      text: `${input.name}: ${input.message}`,
      meta: { inputType: 'error', stack: input.stack }
    }
  }

  return { text: JSON.stringify(input ?? ''), meta: { inputType: 'unknown' } }
}

// ─────────────────────────────────────────────
//  LAYER 1 — Raw Motion
// ─────────────────────────────────────────────

export function receiveRawMotion(text, context = {}, meta = {}) {
  const now               = Number(context.timestamp ?? Date.now())
  const source            = typeof text === 'string' ? text : JSON.stringify(text ?? '')
  const tokens            = source.trim().split(/\s+/).filter(Boolean)
  const previousTimestamp = Number(context.lastTimestamp ?? now)
  const deltaTime         = Math.max(0, now - previousTimestamp)
  const previousVolume    = Number(context.lastVolume ?? 0)
  const currentVolume     = tokens.length
  const flowVariation     = Math.abs(currentVolume - previousVolume)
  const temporalDensity   = deltaTime > 0 ? currentVolume / deltaTime : currentVolume
  const motionFrequency   = normalizeFrequency(Number(context.eventCount ?? 1), deltaTime)
  const transitionRhythm  = normalizeRhythm(temporalDensity, flowVariation)
  const continuityTrace   = normalizeContinuity(deltaTime, flowVariation)
  const numericSignal     = normalize((source.match(/-?\d+(\.\d+)?/g) ?? []).length / Math.max(1, tokens.length * 0.2))

  const inputTypeWeight = {
    text: 1.0, log: 0.8, event: 0.9, retry: 0.6,
    signal: 0.7, error: 0.7, unknown: 0.5
  }[meta.inputType ?? 'text'] ?? 0.8

  // Trajectory speed modifier: fast-moving trajectories get higher motion weight
  const trajSpeed = normalize(context.trajectory?.speed ?? 0)
  const adjustedRhythm = normalize(transitionRhythm * (1 + trajSpeed * 0.2))

  return {
    source, tokens,
    tokenCount:      currentVolume,
    deltaTime,
    temporalDensity,
    motionFrequency,
    transitionRhythm: adjustedRhythm,
    continuityTrace,
    flowVariation,
    numericSignal,
    inputType:       meta.inputType ?? 'text',
    inputTypeWeight,
    meta,
    timestamp:       now
  }
}

// ─────────────────────────────────────────────
//  LAYER 2 — Semantic Parsing
// ─────────────────────────────────────────────

export function buildSemanticField(text, context = {}) {
  const source    = typeof text === 'string' ? text.trim() : ''
  const tokens    = source.length > 0 ? source.split(/\s+/).filter(Boolean) : []
  const wordCount = tokens.length

  const patterns = {
    continuity:   /\b(and|then|because|therefore|also|but|while|if|this|that|which|لكن|لأن|ثم|لذلك|أيضًا|بينما|هذا|الذي)\b/gi,
    abstraction:  /\b(system|structure|field|meaning|pattern|semantic|space|possibility|constraint|وعي|نسق|بنية|معنى|فضاء|احتمال|استدلال)\b/gi,
    dispersion:   /(\.\.\.|!!!|\?\?\?|,,|;;|###|@@@)/g,
    technical:    /\b(api|server|database|redis|endpoint|function|deploy|latency|timeout|error|كود|سيرفر|خطأ|دالة)\b/gi,
    reactive:     /\b(now|urgent|fast|immediately|broken|panic|حالًا|سريع|طارئ|عاجل|فشل)\b/gi,
    symbolic:     /\b(meaning|philosophy|structure|existence|وعي|فلسفة|بنية|معنى|وجود)\b/gi,
    questioning:  /\b(why|how|what|when|where|who|هل|ماذا|كيف|لماذا|متى|أين|من)\b/gi,
    commanding:   /\b(do|run|execute|create|delete|fix|start|stop|نفذ|أنشئ|احذف|أصلح|شغّل)\b/gi,
    asserting:    /\b(is|are|was|were|will|should|must|يجب|هو|هي|كان|سيكون)\b/gi,
    negating:     /\b(not|no|never|without|لا|ليس|لم|لن|بدون)\b/gi,
    analytical:   /\b(analyze|compare|evaluate|measure|calculate|قارن|حلل|قيّم|احسب)\b/gi,
    generative:   /\b(create|generate|write|build|design|أنشئ|اكتب|صمم|ابنِ)\b/gi,
    reflective:   /\b(think|consider|reflect|wonder|imagine|فكّر|تأمل|تساءل|تخيل)\b/gi
  }

  const count = key => (source.match(patterns[key]) ?? []).length

  const continuityCount   = count('continuity')
  const abstractionCount  = count('abstraction')
  const dispersionCount   = count('dispersion')
  const technicalCount    = count('technical')
  const reactiveCount     = count('reactive')
  const symbolicCount     = count('symbolic')

  const continuity           = normalize(continuityCount  / Math.max(3, wordCount * 0.15))
  const abstraction          = normalize(abstractionCount / Math.max(2, wordCount * 0.12))
  const structuralDispersion = normalize(dispersionCount  / Math.max(1, wordCount * 0.08))
  const semanticDensity      = normalize(continuity * 0.4 + abstraction * 0.4 + (1 - structuralDispersion) * 0.2)
  const semanticIntensity    = normalize(structuralDispersion * 0.5 + reactiveCount / Math.max(1, wordCount * 0.1))
  const fieldInstability     = normalize(Math.abs(continuity - abstraction) * 0.5 + structuralDispersion * 0.5)
  const transitionEnergy     = normalize(semanticIntensity * 0.6 + fieldInstability * 0.4)
  const semanticOrientation  = {
    technical: normalize(technicalCount / Math.max(1, wordCount * 0.08)),
    reactive:  normalize(reactiveCount  / Math.max(1, wordCount * 0.08)),
    symbolic:  normalize(symbolicCount  / Math.max(1, wordCount * 0.08))
  }
  const coherence   = normalize(semanticDensity * 0.45 + continuity * 0.25 + abstraction * 0.2 + (1 - fieldInstability) * 0.1)
  const containment = normalize(semanticDensity * 0.5  + continuity * 0.3  + (1 - structuralDispersion) * 0.2)
  const entropy     = normalize(fieldInstability * 0.45 + semanticIntensity * 0.35 + structuralDispersion * 0.2)
  const tension     = normalize(semanticIntensity * 0.5 + fieldInstability * 0.3 + (1 - containment) * 0.2)

  // Intent
  const intentScores = {
    question:  normalize(count('questioning') / Math.max(1, wordCount * 0.1)),
    command:   normalize(count('commanding')  / Math.max(1, wordCount * 0.1)),
    assertion: normalize(count('asserting')   / Math.max(1, wordCount * 0.1)),
    negation:  normalize(count('negating')    / Math.max(1, wordCount * 0.1))
  }
  const intent = Object.entries(intentScores).sort((a, b) => b[1] - a[1])[0][0]

  // Reasoning mode
  const reasoningScores = {
    analytical: normalize(count('analytical') / Math.max(1, wordCount * 0.08)),
    generative: normalize(count('generative') / Math.max(1, wordCount * 0.08)),
    reflective: normalize(count('reflective') / Math.max(1, wordCount * 0.08))
  }
  const topReasoning  = Object.entries(reasoningScores).sort((a, b) => b[1] - a[1])[0]
  const reasoningMode = topReasoning[1] > 0.05 ? topReasoning[0] : 'neutral'

  // [2] Drift from trajectory (richer than single lastField)
  const trajectory = context.trajectory ?? {}
  const trajStates = trajectory.states ?? []
  const lastState  = trajStates.length > 0 ? trajStates[trajStates.length - 1] : null

  const drift = lastState
    ? normalize(
        Math.abs((lastState.density    ?? 0) - semanticDensity)   * 0.3 +
        Math.abs((lastState.coherence  ?? 0) - coherence)          * 0.3 +
        Math.abs((lastState.continuity ?? 0) - continuity)         * 0.2 +
        Math.abs((lastState.entropy    ?? 0) - entropy)            * 0.2
      )
    : 0

  // Trajectory-aware drift acceleration (is drift speeding up?)
  const driftAcceleration = trajectory.direction
    ? normalize(Math.abs(drift - normalize(trajectory.speed ?? 0)))
    : 0

  const arabicChars = (source.match(/[\u0600-\u06FF]/g) ?? []).length
  const language    = arabicChars / Math.max(1, source.length) > 0.3 ? 'ar' : 'en'
  const confidence  = wordCount < 3 ? normalize(wordCount / 3) : 1.0

  return {
    continuity, abstraction, structuralDispersion,
    semanticDensity, semanticIntensity, fieldInstability,
    transitionEnergy, semanticOrientation,
    coherence, containment, entropy, tension,
    intent, intentScores,
    reasoningMode, reasoningScores,
    drift, driftAcceleration,
    language, confidence,
    wordCount,
    timestamp: Number(context.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  LAYER 3 — Spatial Projection (Circular)
// ─────────────────────────────────────────────

export function projectSemanticField(field, space = {}) {
  const continuity  = normalize(field?.continuity)
  const abstraction = normalize(field?.abstraction)
  const density     = normalize(field?.semanticDensity)
  const instability = normalize(field?.fieldInstability)
  const energy      = normalize(field?.transitionEnergy)
  const drift       = normalize(field?.drift)

  const orientation = field?.semanticOrientation ?? {}
  const symbolic    = normalize(orientation.symbolic)
  const technical   = normalize(orientation.technical)
  const reactive    = normalize(orientation.reactive)

  const localFields = Array.isArray(space?.fields) ? space.fields : []

  const localDensity     = averageLocal(localFields, 'semanticDensity', density)
  const localInstability = averageLocal(localFields, 'fieldInstability', instability)
  const localContinuity  = averageLocal(localFields, 'continuity', continuity)
  const localAbstraction = averageLocal(localFields, 'abstraction', abstraction)

  // Circular coordinates
  const angle = (continuity * 0.3 + abstraction * 0.3 + density * 0.2 + (1 - instability) * 0.2) * 2 * Math.PI
  const radius = normalize(density * 0.4 + continuity * 0.3 + abstraction * 0.2 + (1 - instability) * 0.1)
  const x = radius * Math.cos(angle)
  const y = radius * Math.sin(angle)

  const directionalFlow = {
    continuity:  continuity  - localContinuity,
    abstraction: abstraction - localAbstraction,
    density:     density     - localDensity,
    instability: instability - localInstability,
    drift
  }

  const directionalMagnitude = Math.sqrt(
    Object.values(directionalFlow).reduce((s, v) => s + v * v, 0)
  )

  const pressureGradient  = normalize(
    Math.abs(density - localDensity)         * 0.4 +
    Math.abs(instability - localInstability) * 0.3 +
    Math.abs(continuity - localContinuity)   * 0.2 +
    drift * 0.1
  )

  const fieldPressure      = normalize(pressureGradient * 0.5 + energy * 0.5)
  const attractorAffinity  = normalize(density * 0.35 + continuity * 0.3 + abstraction * 0.2 + (1 - instability) * 0.15)
  const spatialTension     = normalize(fieldPressure * 0.55 + instability * 0.45)
  const localResonance     = normalize(1 - directionalMagnitude / 2)

  const cellCount  = 8
  const cellIndex  = Math.floor((angle / (2 * Math.PI)) * cellCount) % cellCount
  const neighborCell = (cellIndex + 1) % cellCount

  return {
    radius, angle, x, y,
    cellIndex, neighborCell,
    localDensity, localInstability, localContinuity, localAbstraction,
    pressureGradient, fieldPressure, attractorAffinity, spatialTension,
    localResonance, directionalMagnitude, directionalFlow,
    orientationField: { symbolic, technical, reactive },
    attractorFeedback: null,   // filled by distortProjectionByAttractors
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  LAYER 4 — Pattern Similarity (trajectory-aware)
// ─────────────────────────────────────────────

export function computePatternSimilarity(field, projection, space = {}, trajectory = {}) {
  const localFields     = Array.isArray(space?.fields)     ? space.fields     : []
  const localAttractors = Array.isArray(space?.attractors) ? space.attractors : []
  const localSignatures = Array.isArray(space?.signatures) ? space.signatures : []
  const trajStates      = trajectory?.states ?? []

  const prevField = localFields.length > 0 ? localFields[localFields.length - 1] : null
  const fieldSimilarity = prevField
    ? cosineSimilarity(
        [field.continuity, field.abstraction, field.semanticDensity, field.coherence],
        [prevField.continuity, prevField.abstraction, prevField.semanticDensity, prevField.coherence]
      )
    : 0.5

  const attractorSimilarity = localAttractors.length > 0
    ? localAttractors.reduce((sum, a) => sum + normalize(
        (1 - Math.abs(normalize(a?.attractorStability) - normalize(projection.attractorAffinity))) * 0.5 +
        (1 - Math.abs(normalize(a?.fieldAlignment)     - normalize(projection.localResonance)))    * 0.5
      ), 0) / localAttractors.length
    : 0.5

  const signatureHistory = localSignatures.length > 0
    ? localSignatures.reduce((s, sig) => s + normalize(sig?.resonanceSignature), 0) / localSignatures.length
    : 0.5

  // [2] Trajectory similarity — how much current field matches historical trajectory center
  const trajSimilarity = trajStates.length > 2
    ? normalize(1 - normalize(trajectory.speed ?? 0) * 0.5 - normalize(field.drift) * 0.5)
    : 0.5

  // Pattern recurrence: does current state match trajectory pattern?
  const patternRecurrence = trajectory.pattern
    ? (trajectory.pattern.includes(field.intent) ? 0.8 : 0.3)
    : 0.5

  const novelty = normalize(
    1 - fieldSimilarity * 0.3 - signatureHistory * 0.2 -
    attractorSimilarity * 0.2 - trajSimilarity * 0.3
  )

  const patternMatch = normalize(
    fieldSimilarity     * 0.3 +
    attractorSimilarity * 0.25 +
    signatureHistory    * 0.2 +
    trajSimilarity      * 0.15 +
    patternRecurrence   * 0.1
  )

  return {
    fieldSimilarity, attractorSimilarity, signatureHistory,
    trajSimilarity, patternRecurrence,
    novelty, patternMatch,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  LAYER 5 — Possibility Reduction (novelty-safe)
// ─────────────────────────────────────────────

export function reducePossibility(field, projection, similarity, space = {}) {
  const coherence    = normalize(field?.coherence)
  const containment  = normalize(field?.containment)
  const entropy      = normalize(field?.entropy)
  const tension      = normalize(field?.tension)
  const density      = normalize(field?.semanticDensity)
  const instability  = normalize(field?.fieldInstability)
  const confidence   = normalize(field?.confidence ?? 1)

  const resonance            = normalize(projection?.localResonance)
  const affinity             = normalize(projection?.attractorAffinity)
  const pressure             = normalize(projection?.fieldPressure)
  const directionalMagnitude = normalize(projection?.directionalMagnitude)

  const novelty      = normalize(similarity?.novelty ?? 0.5)
  const patternMatch = normalize(similarity?.patternMatch ?? 0.5)

  // [3] noveltyPotential computed FIRST, before fieldResistance
  const noveltyPotential = normalize(
    directionalMagnitude * 0.30 +
    entropy              * 0.20 +
    instability          * 0.20 +
    (1 - resonance)      * 0.15 +
    novelty              * 0.15
  )

  // [3] fieldResistance REDUCED by noveltyPotential — new states get breathing room
  const rawResistance = normalize(
    entropy      * 0.20 +
    tension      * 0.20 +
    instability  * 0.15 +
    pressure     * 0.20 +
    directionalMagnitude * 0.15 +
    (1 - noveltyPotential) * 0.10
  )

  // [3] Key fix: novelty actively suppresses resistance
  const fieldResistance = normalize(
    rawResistance * (1 - noveltyPotential * 0.45) * confidence
  )

  const adaptiveCapacity = normalize(
    coherence        * 0.22 +
    containment      * 0.18 +
    resonance        * 0.18 +
    affinity         * 0.12 +
    density          * 0.10 +
    noveltyPotential * 0.12 +
    patternMatch     * 0.08
  )

  const propagationPotential   = normalize(adaptiveCapacity * (1 - fieldResistance) + noveltyPotential * 0.25)
  const containmentPressure    = normalize(fieldResistance * 0.40 + (1 - resonance) * 0.25 + pressure * 0.20 - noveltyPotential * 0.15)
  const spaceFlexibility       = normalize(adaptiveCapacity * 0.40 + (1 - entropy) * 0.20 + (1 - instability) * 0.15 + noveltyPotential * 0.25)
  const structuralCompression  = normalize(containmentPressure * 0.40 + pressure * 0.20 + directionalMagnitude * 0.15 - noveltyPotential * 0.25)
  const persistenceProbability = normalize(propagationPotential * 0.45 + resonance * 0.22 + affinity * 0.18 + noveltyPotential * 0.15)
  const spatialAdaptation      = normalize(spaceFlexibility * 0.45 + adaptiveCapacity * 0.30 + (1 - structuralCompression) * 0.15 + noveltyPotential * 0.10)

  return {
    fieldResistance, adaptiveCapacity, propagationPotential,
    containmentPressure, spaceFlexibility, structuralCompression,
    persistenceProbability, spatialAdaptation, noveltyPotential,
    localFieldCount: (space?.fields ?? []).length,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  LAYER 6 — Decay & Forgetting
// ─────────────────────────────────────────────

export function decaySemanticField(field, reduction, space = {}) {
  const propagationPotential   = normalize(reduction?.propagationPotential)
  const structuralCompression  = normalize(reduction?.structuralCompression)
  const containmentPressure    = normalize(reduction?.containmentPressure)
  const spatialAdaptation      = normalize(reduction?.spatialAdaptation)
  const persistenceProbability = normalize(reduction?.persistenceProbability)

  const localReductions = Array.isArray(space?.reductions) ? space.reductions : []

  const localPersistence = localReductions.length > 0
    ? localReductions.reduce((s, i) => s + normalize(i?.persistenceProbability), 0) / localReductions.length
    : persistenceProbability

  const localCompression = localReductions.length > 0
    ? localReductions.reduce((s, i) => s + normalize(i?.structuralCompression), 0) / localReductions.length
    : structuralCompression

  const spatialNarrowing = normalize(structuralCompression * 0.45 + containmentPressure * 0.35 + (1 - spatialAdaptation) * 0.2)
  const fieldDissolution = normalize(spatialNarrowing * 0.5 + (1 - propagationPotential) * 0.3 + (1 - persistenceProbability) * 0.2)
  const memoryResidual   = normalize(persistenceProbability * 0.5 + propagationPotential * 0.3 + (1 - structuralCompression) * 0.2)
  const survivability    = normalize(memoryResidual * 0.6 + spatialAdaptation * 0.4)
  const spatialIsolation = normalize(spatialNarrowing * 0.55 + localCompression * 0.25 + (1 - localPersistence) * 0.2)
  const attractorDecay   = normalize(fieldDissolution * 0.5 + spatialIsolation * 0.3 + (1 - survivability) * 0.2)

  return {
    spatialNarrowing, fieldDissolution, memoryResidual,
    survivability, spatialIsolation, attractorDecay,
    localPersistence, localCompression,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  LAYER 7 — Reinforcement
// ─────────────────────────────────────────────

export function reinforceSemanticField(field, decay, space = {}, prevReprojection = null) {
  const survivability    = normalize(decay?.survivability)
  const memoryResidual   = normalize(decay?.memoryResidual)
  const spatialIsolation = normalize(decay?.spatialIsolation)
  const attractorDecay   = normalize(decay?.attractorDecay)

  const localProjections = Array.isArray(space?.projections) ? space.projections : []
  const localFields      = Array.isArray(space?.fields)      ? space.fields      : []

  const localResonance = localProjections.length > 0
    ? localProjections.reduce((s, i) => s + normalize(i?.localResonance), 0) / localProjections.length
    : survivability

  const localStability = localFields.length > 0
    ? localFields.reduce((s, i) => s + normalize(i?.coherence), 0) / localFields.length
    : survivability

  // [F3] emergence from previous reprojection boosts resonanceAmplification
  // High emergence = last cycle found new stable structure = amplify more
  const emergenceBoost = normalize(prevReprojection?.emergence ?? 0)

  const resonanceAmplification  = normalize(survivability * 0.33 + memoryResidual * 0.22 + localResonance * 0.35 + emergenceBoost * 0.10)
  const structuralReinforcement = normalize(resonanceAmplification * 0.4 + localStability * 0.35 + (1 - spatialIsolation) * 0.25)
  const attractorStrength       = normalize(structuralReinforcement * 0.45 + resonanceAmplification * 0.35 + (1 - attractorDecay) * 0.2)
  const fieldPersistence        = normalize(attractorStrength * 0.4 + survivability * 0.35 + memoryResidual * 0.25)
  const adaptiveStability       = normalize(fieldPersistence * 0.45 + localStability * 0.35 + resonanceAmplification * 0.2)
  const spatialExpansion        = normalize(adaptiveStability * 0.45 + attractorStrength * 0.35 + (1 - spatialIsolation) * 0.2)
  const learningGradient        = normalize(spatialExpansion * 0.4 + adaptiveStability * 0.35 + attractorStrength * 0.25)

  return {
    resonanceAmplification, structuralReinforcement,
    attractorStrength, fieldPersistence, adaptiveStability,
    spatialExpansion, learningGradient,
    localResonance, localStability,
    emergenceBoost,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  LAYER 8 — Attractor Formation
// ─────────────────────────────────────────────

export function formAttractor(field, reinforcement, space = {}, prevReprojection = null) {
  const attractorStrength = normalize(reinforcement?.attractorStrength)
  const fieldPersistence  = normalize(reinforcement?.fieldPersistence)
  const adaptiveStability = normalize(reinforcement?.adaptiveStability)
  const spatialExpansion  = normalize(reinforcement?.spatialExpansion)
  const learningGradient  = normalize(reinforcement?.learningGradient)

  const localReinforcements = Array.isArray(space?.reinforcements) ? space.reinforcements : []

  const localAttractorDensity = localReinforcements.length > 0
    ? localReinforcements.reduce((s, i) => s + normalize(i?.attractorStrength), 0) / localReinforcements.length
    : attractorStrength

  const localPersistence = localReinforcements.length > 0
    ? localReinforcements.reduce((s, i) => s + normalize(i?.fieldPersistence), 0) / localReinforcements.length
    : fieldPersistence

  // [F3] reprojection delta modulates convergencePotential:
  // High delta = refined field differs from original projection = new structure forming
  // This makes the attractor lean toward the emerging new structure
  const reprDelta     = normalize(prevReprojection?.delta      ?? 0)
  const reprAlignment = normalize(prevReprojection?.trajAlignment ?? 0.5)

  const structuralGravity    = normalize(attractorStrength * 0.4 + adaptiveStability * 0.3 + localAttractorDensity * 0.3)
  const attractorCurvature   = normalize(structuralGravity * 0.45 + spatialExpansion * 0.35 + learningGradient * 0.2)
  const resonanceField       = normalize(fieldPersistence * 0.4 + localPersistence * 0.35 + adaptiveStability * 0.25)

  // [F3] delta opens new convergence paths when the system is structurally evolving
  const convergencePotential = normalize(
    attractorCurvature * 0.40 +
    resonanceField     * 0.30 +
    structuralGravity  * 0.18 +
    reprDelta          * 0.07 +  // new structure forming boosts convergence
    reprAlignment      * 0.05    // trajectory alignment confirms direction
  )

  const fieldAlignment       = normalize(convergencePotential * 0.4 + resonanceField * 0.35 + (1 - Math.abs(localAttractorDensity - attractorStrength)) * 0.25)
  const attractorStability   = normalize(fieldAlignment * 0.45 + convergencePotential * 0.35 + adaptiveStability * 0.2)

  return {
    structuralGravity, attractorCurvature, resonanceField,
    convergencePotential, fieldAlignment, attractorStability,
    localAttractorDensity, localPersistence,
    reprDelta, reprAlignment,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  LAYER 9 — Refined Honey
// ─────────────────────────────────────────────

export function refineSemanticField(field, attractor, space = {}) {
  const structuralGravity    = normalize(attractor?.structuralGravity)
  const attractorCurvature   = normalize(attractor?.attractorCurvature)
  const resonanceField       = normalize(attractor?.resonanceField)
  const convergencePotential = normalize(attractor?.convergencePotential)
  const fieldAlignment       = normalize(attractor?.fieldAlignment)
  const attractorStability   = normalize(attractor?.attractorStability)
  const confidence           = normalize(field?.confidence ?? 1)

  const localAttractors = Array.isArray(space?.attractors) ? space.attractors : []

  const localAlignment = localAttractors.length > 0
    ? localAttractors.reduce((s, i) => s + normalize(i?.fieldAlignment), 0) / localAttractors.length
    : fieldAlignment

  const localStability = localAttractors.length > 0
    ? localAttractors.reduce((s, i) => s + normalize(i?.attractorStability), 0) / localAttractors.length
    : attractorStability

  const refinedCoherence     = normalize(fieldAlignment * 0.35 + resonanceField * 0.25 + convergencePotential * 0.2 + localAlignment * 0.2)
  const structuralPurity     = normalize(refinedCoherence * 0.4 + attractorStability * 0.35 + localStability * 0.25)
  const persistenceIntegrity = normalize(structuralPurity * 0.45 + structuralGravity * 0.3 + resonanceField * 0.25)
  const adaptiveHarmony      = normalize(persistenceIntegrity * 0.4 + convergencePotential * 0.35 + (1 - Math.abs(localAlignment - fieldAlignment)) * 0.25)
  const refinedDensity       = normalize(adaptiveHarmony * 0.4 + refinedCoherence * 0.35 + attractorCurvature * 0.25)
  const refinedField         = normalize(
    (refinedDensity * 0.35 + adaptiveHarmony * 0.3 + persistenceIntegrity * 0.2 + structuralPurity * 0.15) * confidence
  )

  return {
    refinedCoherence, structuralPurity, persistenceIntegrity,
    adaptiveHarmony, refinedDensity, refinedField,
    localAlignment, localStability,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  Resonance Signature
// ─────────────────────────────────────────────

export function buildResonanceSignature(state) {
  const field         = state.semanticField  ?? {}
  const projection    = state.projection     ?? {}
  const similarity    = state.similarity     ?? {}
  const reduction     = state.reduction      ?? {}
  const decay         = state.decay          ?? {}
  const reinforcement = state.reinforcement  ?? {}
  const attractor     = state.attractor      ?? {}
  const refined       = state.refined        ?? {}
  const reprojection  = state.reprojection   ?? {}

  const signatureVector = {
    motion:         normalize(state.rawMotion?.transitionRhythm),
    continuity:     normalize(field.continuity),
    density:        normalize(field.semanticDensity),
    drift:          normalize(field.drift),
    resonance:      normalize(projection.localResonance),
    patternMatch:   normalize(similarity.patternMatch),
    pressure:       normalize(reduction.containmentPressure),
    residual:       normalize(decay.memoryResidual),
    reinforcement:  normalize(reinforcement.structuralReinforcement),
    gravity:        normalize(attractor.structuralGravity),
    refinement:     normalize(refined.refinedField),
    emergence:      normalize(reprojection.emergence)   // [5] recursive signal
  }

  const resonanceSignature = normalize(
    signatureVector.motion        * 0.07 +
    signatureVector.continuity    * 0.08 +
    signatureVector.density       * 0.09 +
    signatureVector.drift         * 0.06 +
    signatureVector.resonance     * 0.10 +
    signatureVector.patternMatch  * 0.08 +
    signatureVector.pressure      * 0.07 +
    signatureVector.residual      * 0.08 +
    signatureVector.reinforcement * 0.09 +
    signatureVector.gravity       * 0.09 +
    signatureVector.refinement    * 0.09 +
    signatureVector.emergence     * 0.10   // [5] emergence weighted high
  )

  return {
    resonanceSignature,
    signatureVector,
    timestamp: Number(field?.timestamp ?? Date.now())
  }
}

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────

function normalize(value, min = 0, max = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(min, Math.min(max, n))
}

function averageLocal(items, key, fallback) {
  if (!Array.isArray(items) || items.length === 0) return normalize(fallback)
  return items.reduce((sum, item) => sum + normalize(item?.[key]), 0) / items.length
}

function normalizeFrequency(events, delta) {
  if (!Number.isFinite(events)) return 0
  if (!Number.isFinite(delta) || delta <= 0) return 1
  return Math.min(1, events / Math.max(1, delta / 1000))
}

function normalizeRhythm(density, variation) {
  return normalize(density * 0.6 + (1 / (1 + variation)) * 0.4)
}

function normalizeContinuity(delta, variation) {
  return normalize(
    (1 / (1 + delta / 1000)) * 0.5 +
    (1 / (1 + variation))    * 0.5
  )
}

function cosineSimilarity(a, b) {
  const dot  = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0)
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
  if (magA === 0 || magB === 0) return 0
  return normalize(dot / (magA * magB))
}
