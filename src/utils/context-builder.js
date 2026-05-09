/**
 * context-builder.js — v3.0
 *
 * مُكيَّف بالكامل مع CELF_Engine_AI_V5 snapshot:
 *   snapshot.phase          — الطور المحسوب مباشرة
 *   snapshot.field          — coherence, drift, resonance, emergence, noveltyPressure...
 *   snapshot.metrics        — entropy, attractorStrength, pressure, aliveRatio...
 *   snapshot.control        — mode, depth, contextUse, recall, grounding, executionReadiness
 *   snapshot.perturbation   — semantic.intent, semantic.question, semantic.command...
 *   snapshot.attractors     — قائمة الجذابات النشطة
 *
 * V5 يحسب الطور داخلياً → نثق به مباشرة بدون إعادة حساب.
 */

// ─────────────────────────────────────────────
//  Intent mapping — من perturbation.semantic
// ─────────────────────────────────────────────

function mapIntent(celfResult) {
  const s = celfResult.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question)        return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error)           return 'complaint'
  if (s.emotional)       return 'emotional'
  return 'statement'
}

// ─────────────────────────────────────────────
//  Reasoning mode — من perturbation.semantic
// ─────────────────────────────────────────────

function mapReasoningMode(celfResult) {
  const s = celfResult.perturbation?.semantic
  if (!s) return 'neutral'
  if (s.reasoning) return 'analytical'
  if (s.code)      return 'generative'
  if (s.emotional) return 'reflective'
  if (s.data)      return 'analytical'
  return 'neutral'
}

// ─────────────────────────────────────────────
//  Severity — كم النظام مستقر؟ (V5 fields)
// ─────────────────────────────────────────────

function resolveSeverity(celfResult) {
  if (!celfResult) return 'low'

  const resonance      = Number(celfResult.field?.resonance         ?? 0)
  const stability      = Number(celfResult.metrics?.attractorStrength ?? 0)
  const topicPressure  = Number(celfResult.field?.topicPressure     ?? 0)
  const entropy        = Number(celfResult.metrics?.entropy          ?? 0)

  // ضغط عالٍ + فوضى + رنين منخفض = غير مستقر
  if (topicPressure > 0.65 && entropy > 0.6 && resonance < 0.35) return 'high'
  if (topicPressure > 0.50 && resonance < 0.45)                   return 'medium'
  if (stability > 0.75 && resonance > 0.55)                       return 'low'

  return 'low'
}

// ─────────────────────────────────────────────
//  Pattern — طبيعة الحالة الحالية (V5)
// ─────────────────────────────────────────────

function resolvePattern(celfResult) {
  if (!celfResult) return 'stable'

  // V5 يُنتج phase — نشتق منه pattern
  const phase   = celfResult.phase                          ?? 'stable'
  const momentum= Number(celfResult.field?.momentum         ?? 0)
  const drift   = Number(celfResult.field?.drift            ?? 0)
  const emergence= Number(celfResult.field?.emergence       ?? 0)
  const novelty = Number(celfResult.field?.noveltyPressure  ?? 0)
  const intent  = mapIntent(celfResult)

  // خريطة مباشرة من phase إلى pattern
  if (phase === 'turbulent')  return 'unstable'
  if (phase === 'drift')      return 'shifting'
  if (phase === 'emergent')   return 'emerging'
  if (phase === 'locked')     return 'stable'
  if (phase === 'compressed') return 'compressed'

  // fallback من المقاييس
  if (momentum > 0.7 && drift > 0.5) return 'shifting'
  if (emergence > 0.55)              return 'emerging'
  if (novelty > 0.6)                 return 'exploring'
  if (intent === 'greeting')         return 'social'

  return 'stable'
}

// ─────────────────────────────────────────────
//  Phase — V5 يحسبه مباشرة، نثق به
// ─────────────────────────────────────────────

function resolvePhase(celfResult) {
  if (!celfResult) return 'warmup'

  // V5 phase مباشرة — أدق من إعادة الحساب
  const v5phase = celfResult.phase
  if (v5phase) return v5phase

  // fallback
  const stability = Number(celfResult.metrics?.attractorStrength ?? 0)
  const emergence = Number(celfResult.field?.emergence           ?? 0)
  const t         = Number(celfResult.t                          ?? 0)

  if (t < 8)                              return 'warmup'
  if (emergence > 0.55 && stability > 0.55) return 'crystallizing'
  if (stability > 0.7)                    return 'mature'
  return 'emergent'
}

// ─────────────────────────────────────────────
//  Main build()
// ─────────────────────────────────────────────

export function build(adapterOutput) {
  const { ok, signals, celfResult, passToLLM } = adapterOutput

  if (!ok) {
    return { passToLLM: false, reason: 'invalid_input', context: null, systemHint: null }
  }

  const severity = resolveSeverity(celfResult)
  const pattern  = resolvePattern(celfResult)
  const phase    = resolvePhase(celfResult)
  const intent   = mapIntent(celfResult)
  const reasoningMode = mapReasoningMode(celfResult)

  const context = {
    // من parser
    lang:      signals.lang,
    wordCount: signals.wordCount,
    rupture:   signals.rupture ?? 0,           // v2.1

    // intent & mode (مشتق من V5 perturbation)
    intent,
    reasoningMode,

    // من V5 field
    drift:              Number(celfResult.field?.drift              ?? 0),
    driftAcceleration:  Number(celfResult.field?.momentum           ?? 0), // تقريب
    coherence:          Number(celfResult.field?.coherence          ?? 0),
    entropy:            Number(celfResult.metrics?.entropy          ?? 0),
    confidence:         Number(celfResult.field?.semanticGrounding  ?? 0),
    resonance:          Number(celfResult.field?.resonance          ?? 0),
    emergence:          Number(celfResult.field?.emergence          ?? 0),
    noveltyPotential:   Number(celfResult.field?.noveltyPressure    ?? 0),
    momentum:           Number(celfResult.field?.momentum           ?? 0),
    persistence:        Number(celfResult.field?.persistence        ?? 0),

    // من V5 metrics
    attractorStability:   Number(celfResult.metrics?.attractorStrength ?? 0),
    convergencePotential: Number(celfResult.field?.continuity          ?? 0),
    fieldResistance:      Number(celfResult.metrics?.pressure          ?? 0),

    // من V5 control
    pullStrength:        Number(celfResult.control?.contextUse         ?? 0),
    recall:              Number(celfResult.control?.recall             ?? 0),
    grounding:           Number(celfResult.control?.grounding          ?? 0),
    executionReadiness:  Number(celfResult.control?.executionReadiness ?? 0),
    compression:         Number(celfResult.control?.compression        ?? 0),

    // مشتق
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

// ─────────────────────────────────────────────
//  System Hint builder — V5 signals
// ─────────────────────────────────────────────

function buildSystemHint(ctx) {
  const lines = []

  // ── Language ──────────────────────────────
  if (ctx.lang === 'ar') {
    lines.push('CRITICAL LANGUAGE RULE: You MUST respond ONLY in Arabic (العربية). Never use any other language, script, or alphabet — not English, not French, not Russian, not Chinese, not any other. Every single word in your response must be Arabic. Violation of this rule is not acceptable.')
    lines.push('Use natural Modern Standard Arabic (فصحى) with a conversational tone. Avoid transliteration.')
  } else if (ctx.lang === 'mixed') {
    lines.push('The user is mixing Arabic and English. Respond using Arabic as the primary language, and English only for technical terms the user already used. Never introduce a third language.')
  } else {
    lines.push('Respond ONLY in the same language as the user. Do not mix languages.')
  }

  // ── Intent ────────────────────────────────
  if (ctx.intent === 'question')  lines.push('Prioritize direct, clear semantic relevance.')
  if (ctx.intent === 'command')   lines.push('Prioritize actionable, executable response.')
  if (ctx.intent === 'complaint') lines.push('Prioritize issue resolution with empathy.')
  if (ctx.intent === 'greeting')  lines.push('Prioritize warm, natural conversational continuity.')
  if (ctx.intent === 'emotional') lines.push('Prioritize emotional attunement and support.')

  // ── Reasoning mode ────────────────────────
  if (ctx.reasoningMode === 'analytical') lines.push('Apply structured analytical reasoning.')
  if (ctx.reasoningMode === 'generative') lines.push('Engage creative generative mode.')
  if (ctx.reasoningMode === 'reflective') lines.push('Engage reflective exploratory mode.')

  // ── Phase (V5 native) ─────────────────────
  if (ctx.phase === 'warmup')      lines.push('Context is early — be open and broad.')
  if (ctx.phase === 'metastable')  lines.push('Context is forming — maintain coherence carefully.')
  if (ctx.phase === 'emergent')    lines.push('New structure is emerging — support it without forcing.')
  if (ctx.phase === 'locked')      lines.push('Context is locked — be precise and reinforce structure.')
  if (ctx.phase === 'turbulent')   lines.push('Context is turbulent — ground the conversation first.')
  if (ctx.phase === 'drift')       lines.push('TOPIC SHIFT DETECTED: The user has changed the subject. Acknowledge this naturally and follow the new topic. Do NOT force a connection to the previous topic.')
  if (ctx.phase === 'compressed')  lines.push('Context is compressed — prioritize continuity.')
  if (ctx.phase === 'stable')      lines.push('Context is stable — be direct and efficient.')
  if (ctx.phase === 'noise')       lines.push('Input signal is weak — respond briefly and ask for clarification.')

  // ── Pattern ───────────────────────────────
  if (ctx.pattern === 'shifting')   lines.push('TOPIC SHIFT: User has moved to a new subject. Engage with the new topic directly without connecting it to previous discussion unless the user explicitly asks.')
  if (ctx.pattern === 'emerging')   lines.push('New structure is emerging — build on it carefully.')
  if (ctx.pattern === 'exploring')  lines.push('User is exploring — give space, avoid over-narrowing.')
  if (ctx.pattern === 'unstable')   lines.push('Increase contextual grounding and verification.')
  if (ctx.pattern === 'compressed') lines.push('Prioritize continuity preservation.')

  // ── Drift ─────────────────────────────────
  if (ctx.drift > 0.55) {
    lines.push('HIGH DRIFT: Major semantic shift detected. Do not try to connect old and new topics artificially. Follow the user\'s new direction.')
  } else if (ctx.momentum > 0.6) {
    lines.push('Conversation is moving fast — stay adaptive.')
  }

  // ── Emergence ─────────────────────────────
  if (ctx.emergence > 0.55) {
    lines.push('A new stable structure is emerging — build on it.')
  }

  // ── Novelty ───────────────────────────────
  if (ctx.noveltyPotential > 0.6) {
    lines.push('High novelty input — do not collapse to familiar patterns prematurely.')
  }

  // ── Attractor stability ───────────────────
  if (ctx.attractorStability > 0.75) {
    lines.push('Conversation has stable attractors — stay on established track.')
  }

  // ── Rupture guard ─────────────────────────
  if (ctx.rupture > 2) {
    lines.push('High signal rupture detected — user may be under stress. Prioritize clarity and calm.')
  }

  // ── Execution readiness ───────────────────
  if (ctx.executionReadiness > 0.7) {
    lines.push('User intent is execution-ready — provide actionable output directly.')
  }

  // ── Confidence guard ─────────────────────
  if (ctx.confidence < 0.3) {
    lines.push('Input is sparse or low-confidence — ask for clarification if needed.')
  }

  // ── Universal ─────────────────────────────
  lines.push('Maintain natural communication style.')
  lines.push('Do not alter response personality unless necessary.')
  lines.push('ABSOLUTE RULE: Use ONLY the language specified above. Never mix scripts or alphabets from different languages in the same response.')

  return lines.join('\n')
}
