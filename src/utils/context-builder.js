function mapIntent(celfResult) {
  const s = celfResult?.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question) return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error) return 'complaint'
  if (s.emotional) return 'emotional'
  return 'statement'
}

function mapReasoningMode(celfResult) {
  const s = celfResult?.perturbation?.semantic
  if (!s) return 'neutral'
  if (s.reasoning) return 'analytical'
  if (s.code) return 'generative'
  if (s.emotional) return 'reflective'
  if (s.data) return 'analytical'
  return 'neutral'
}

function resolveSeverity(celfResult) {
  if (!celfResult) return 'low'

  const resonance = Number(celfResult.field?.resonance ?? 0)
  const stability = Number(celfResult.metrics?.attractorStrength ?? 0)
  const topicPressure = Number(celfResult.field?.topicPressure ?? 0)
  const entropy = Number(celfResult.metrics?.entropy ?? 0)

  if (topicPressure > 0.65 && entropy > 0.6 && resonance < 0.35) return 'high'
  if (topicPressure > 0.5 && resonance < 0.45) return 'medium'
  if (stability > 0.75 && resonance > 0.55) return 'low'

  return 'low'
}

function resolvePattern(celfResult) {
  if (!celfResult) return 'stable'

  const phase = celfResult.phase ?? 'stable'
  const momentum = Number(celfResult.field?.momentum ?? 0)
  const drift = Number(celfResult.field?.drift ?? 0)
  const emergence = Number(celfResult.field?.emergence ?? 0)
  const novelty = Number(celfResult.field?.noveltyPressure ?? 0)
  const intent = mapIntent(celfResult)

  if (phase === 'noise') return 'noise'
  if (phase === 'turbulent') return 'unstable'
  if (phase === 'drift') return 'shifting'
  if (phase === 'emergent') return 'emerging'
  if (phase === 'locked') return 'stable'
  if (phase === 'compressed') return 'compressed'
  if (momentum > 0.7 && drift > 0.5) return 'shifting'
  if (emergence > 0.55) return 'emerging'
  if (novelty > 0.6) return 'exploring'
  if (intent === 'greeting') return 'social'

  return 'stable'
}

function resolvePhase(celfResult) {
  if (!celfResult) return 'warmup'

  const phase = celfResult.phase
  if (phase) return phase

  const stability = Number(celfResult.metrics?.attractorStrength ?? 0)
  const emergence = Number(celfResult.field?.emergence ?? 0)
  const t = Number(celfResult.t ?? 0)

  if (t < 8) return 'warmup'
  if (emergence > 0.55 && stability > 0.55) return 'crystallizing'
  if (stability > 0.7) return 'mature'

  return 'emergent'
}

export function build(adapterOutput = {}) {
  const {
    ok = false,
    signals = {},
    celfResult = {},
    passToLLM = true
  } = adapterOutput

  if (!ok) {
    return {
      passToLLM: false,
      reason: 'invalid_input',
      context: null,
      systemHint: null
    }
  }

  const severity = resolveSeverity(celfResult)
  const pattern = resolvePattern(celfResult)
  const phase = resolvePhase(celfResult)
  const intent = mapIntent(celfResult)
  const reasoningMode = mapReasoningMode(celfResult)

  const context = {
    lang: signals.lang ?? 'unknown',
    wordCount: signals.wordCount ?? 0,
    rupture: signals.rupture ?? 0,
    intent,
    reasoningMode,
    drift: Number(celfResult.field?.drift ?? 0),
    driftAcceleration: Number(celfResult.field?.momentum ?? 0),
    coherence: Number(celfResult.field?.coherence ?? 0),
    entropy: Number(celfResult.metrics?.entropy ?? 0),
    confidence: Number(celfResult.field?.semanticGrounding ?? 0),
    resonance: Number(celfResult.field?.resonance ?? 0),
    emergence: Number(celfResult.field?.emergence ?? 0),
    noveltyPotential: Number(celfResult.field?.noveltyPressure ?? 0),
    momentum: Number(celfResult.field?.momentum ?? 0),
    persistence: Number(celfResult.field?.persistence ?? 0),
    attractorStability: Number(celfResult.metrics?.attractorStrength ?? 0),
    convergencePotential: Number(celfResult.field?.continuity ?? 0),
    fieldResistance: Number(celfResult.metrics?.pressure ?? 0),
    pullStrength: Number(celfResult.control?.contextUse ?? 0),
    recall: Number(celfResult.control?.recall ?? 0),
    grounding: Number(celfResult.control?.grounding ?? 0),
    executionReadiness: Number(celfResult.control?.executionReadiness ?? 0),
    compression: Number(celfResult.control?.compression ?? 0),
    localization: Number(celfResult.signal?.localization ?? celfResult.metrics?.localization ?? 0),
    coherenceRadius: Number(celfResult.signal?.coherenceRadius ?? celfResult.metrics?.coherenceRadius ?? 0),
    signalType: celfResult.signal?.signalType ?? celfResult.metrics?.signalType ?? 'unknown',
    sourceWeight: Number(celfResult.signal?.sourceWeight ?? celfResult.perturbation?.sourceWeight ?? 1),
    severity,
    pattern,
    phase
  }

  const systemHint = buildSystemHint(context)

  return {
    passToLLM,
    context,
    systemHint,
    blocked: severity === 'high' && !passToLLM
  }
}

function buildSystemHint(ctx) {
  const lines = []

  if (ctx.lang === 'ar') {
    lines.push('Respond in Arabic. Use natural Arabic conversational style.')
  } else if (ctx.lang === 'mixed') {
    lines.push('The user is mixing Arabic and English. Mirror their language blend naturally.')
  } else {
    lines.push('Respond in the same language as the user.')
  }

  if (ctx.intent === 'question') lines.push('Prioritize direct, clear semantic relevance.')
  if (ctx.intent === 'command') lines.push('Prioritize actionable, executable response.')
  if (ctx.intent === 'complaint') lines.push('Prioritize issue resolution with empathy.')
  if (ctx.intent === 'greeting') lines.push('Prioritize warm, natural conversational continuity.')
  if (ctx.intent === 'emotional') lines.push('Prioritize emotional attunement and support.')

  if (ctx.reasoningMode === 'analytical') lines.push('Apply structured analytical reasoning.')
  if (ctx.reasoningMode === 'generative') lines.push('Engage creative generative mode.')
  if (ctx.reasoningMode === 'reflective') lines.push('Engage reflective exploratory mode.')

  if (ctx.phase === 'warmup') lines.push('Context is early — be open and broad.')
  if (ctx.phase === 'metastable') lines.push('Context is forming — maintain coherence carefully.')
  if (ctx.phase === 'emergent') lines.push('New structure is emerging — support it without forcing.')
  if (ctx.phase === 'locked') lines.push('Context is locked — be precise and reinforce structure.')
  if (ctx.phase === 'turbulent') lines.push('Context is turbulent — ground the conversation first.')
  if (ctx.phase === 'drift') lines.push('Significant drift detected — anchor to last stable intent.')
  if (ctx.phase === 'compressed') lines.push('Context is compressed — prioritize continuity.')
  if (ctx.phase === 'stable') lines.push('Context is stable — be direct and efficient.')
  if (ctx.phase === 'noise') lines.push('Noise detected — filter weak signals and avoid reinforcing unstable patterns.')

  if (ctx.pattern === 'noise') lines.push('Treat the current input as low-signal unless the user confirms its importance.')
  if (ctx.pattern === 'shifting') lines.push('Topic is shifting — verify alignment before proceeding.')
  if (ctx.pattern === 'emerging') lines.push('New structure is emerging — build on it carefully.')
  if (ctx.pattern === 'exploring') lines.push('User is exploring — give space, avoid over-narrowing.')
  if (ctx.pattern === 'unstable') lines.push('Increase contextual grounding and verification.')
  if (ctx.pattern === 'compressed') lines.push('Prioritize continuity preservation.')

  if (ctx.signalType === 'noise') {
    lines.push('Current field signal appears diffuse — avoid treating it as a stable topic.')
  }

  if (ctx.signalType === 'signal' && ctx.localization > 0.012) {
    lines.push('Current field signal is localized — preserve the active focus.')
  }

  if (ctx.drift > 0.55) {
    lines.push('Significant semantic drift — verify topic alignment before proceeding.')
  } else if (ctx.momentum > 0.6) {
    lines.push('Conversation is moving fast — stay adaptive.')
  }

  if (ctx.emergence > 0.55) {
    lines.push('A new stable structure is emerging — build on it.')
  }

  if (ctx.noveltyPotential > 0.6) {
    lines.push('High novelty input — do not collapse to familiar patterns prematurely.')
  }

  if (ctx.attractorStability > 0.75) {
    lines.push('Conversation has stable attractors — stay on established track.')
  }

  if (ctx.rupture > 2) {
    lines.push('High signal rupture detected — prioritize clarity and calm.')
  }

  if (ctx.executionReadiness > 0.7) {
    lines.push('User intent is execution-ready — provide actionable output directly.')
  }

  if (ctx.confidence < 0.3) {
    lines.push('Input is sparse or low-confidence — ask for clarification if needed.')
  }

  lines.push('Maintain natural communication style.')
  lines.push('Do not alter response personality unless necessary.')

  return lines.join('\n')
}
