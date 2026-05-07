/**
 * context-builder.js — v2.0
 *
 * يقرأ مخرجات CELF_Engine_AI v4 الصحيحة:
 *   result.semanticField   — intent, reasoningMode, drift, coherence, entropy
 *   result.attractor       — attractorStability, convergencePotential
 *   result.signature       — resonanceSignature, signatureVector
 *   result.reprojection    — emergence, delta, trajAlignment
 *   result.trajectory      — speed, pattern, direction
 *   result.refined         — refinedField, refinedCoherence
 *   result.reduction       — noveltyPotential, fieldResistance
 *   result.projection      — attractorFeedback (pullStrength, avgFreshness)
 */

// ─────────────────────────────────────────────
//  Severity — كم النظام واثق ومستقر؟
// ─────────────────────────────────────────────

function resolveSeverity(celfResult) {
  if (!celfResult) return 'low'

  const resonance      = Number(celfResult.signature?.resonanceSignature   ?? 0)
  const stability      = Number(celfResult.attractor?.attractorStability   ?? 0)
  const fieldResist    = Number(celfResult.reduction?.fieldResistance       ?? 0)
  const entropy        = Number(celfResult.semanticField?.entropy           ?? 0)

  // High resistance + high entropy + low resonance = unstable/high severity
  if (fieldResist > 0.65 && entropy > 0.6 && resonance < 0.35) return 'high'
  if (fieldResist > 0.50 && resonance < 0.45)                   return 'medium'
  if (stability > 0.75 && resonance > 0.55)                     return 'low'

  return 'low'
}

// ─────────────────────────────────────────────
//  Pattern — ما طبيعة الحالة الحالية؟
// ─────────────────────────────────────────────

function resolvePattern(celfResult, parserSignals) {
  if (!celfResult) return 'stable'

  const trajPattern  = celfResult.trajectory?.pattern    ?? null
  const trajSpeed    = Number(celfResult.trajectory?.speed ?? 0)
  const emergence    = Number(celfResult.reprojection?.emergence ?? 0)
  const drift        = Number(celfResult.semanticField?.drift    ?? 0)
  const novelty      = Number(celfResult.reduction?.noveltyPotential ?? 0)
  const intent       = celfResult.semanticField?.intent ?? 'statement'

  // Use trajectory pattern directly if available
  if (trajPattern)                              return trajPattern

  // Derive from field signals
  if (trajSpeed > 0.7 && drift > 0.5)          return 'shifting'
  if (emergence > 0.55)                         return 'emerging'
  if (novelty > 0.6)                            return 'exploring'
  if (drift < 0.1 && trajSpeed < 0.2)          return 'stable'
  if (intent === 'greeting')                    return 'social'

  return 'stable'
}

// ─────────────────────────────────────────────
//  Phase — أين نحن في دورة حياة المحادثة؟
// ─────────────────────────────────────────────

function resolvePhase(celfResult) {
  if (!celfResult) return 'warmup'

  const fieldCount  = Number(celfResult.reduction?.localFieldCount    ?? 0)
  const stability   = Number(celfResult.attractor?.attractorStability ?? 0)
  const convergence = Number(celfResult.attractor?.convergencePotential ?? 0)
  const emergence   = Number(celfResult.reprojection?.emergence        ?? 0)

  if (fieldCount < 3)                              return 'warmup'
  if (emergence > 0.55 && convergence > 0.55)      return 'crystallizing'
  if (stability > 0.7)                             return 'mature'
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
  const pattern  = resolvePattern(celfResult, signals)
  const phase    = resolvePhase(celfResult)

  // Rich context — uses all v4 fields
  const context = {
    // From parser (lightweight)
    lang:       signals.lang,
    wordCount:  signals.wordCount,

    // From semanticField
    intent:         celfResult?.semanticField?.intent         ?? 'statement',
    reasoningMode:  celfResult?.semanticField?.reasoningMode  ?? 'neutral',
    drift:          celfResult?.semanticField?.drift           ?? 0,
    driftAcceleration: celfResult?.semanticField?.driftAcceleration ?? 0,
    coherence:      celfResult?.semanticField?.coherence       ?? 0,
    entropy:        celfResult?.semanticField?.entropy         ?? 0,
    confidence:     celfResult?.semanticField?.confidence      ?? 1,

    // From attractor
    attractorStability:   celfResult?.attractor?.attractorStability   ?? 0,
    convergencePotential: celfResult?.attractor?.convergencePotential  ?? 0,
    structuralGravity:    celfResult?.attractor?.structuralGravity     ?? 0,

    // From signature
    resonance: celfResult?.signature?.resonanceSignature ?? 0,

    // From reprojection [F3]
    emergence:    celfResult?.reprojection?.emergence    ?? 0,
    reprDelta:    celfResult?.reprojection?.delta         ?? 0,
    trajAlignment: celfResult?.reprojection?.trajAlignment ?? 0,

    // From trajectory [F2]
    trajSpeed:   celfResult?.trajectory?.speed   ?? 0,
    trajPattern: celfResult?.trajectory?.pattern ?? null,

    // From reduction
    noveltyPotential: celfResult?.reduction?.noveltyPotential ?? 0,
    fieldResistance:  celfResult?.reduction?.fieldResistance  ?? 0,

    // From projection [F1 feedback]
    pullStrength: celfResult?.projection?.attractorFeedback?.pullStrength ?? 0,
    avgFreshness: celfResult?.projection?.attractorFeedback?.avgFreshness ?? 0,

    // Derived
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
//  System Hint builder — uses v4 signals
// ─────────────────────────────────────────────

function buildSystemHint(ctx) {
  const lines = []

  // ── Language ──────────────────────────────
  if (ctx.lang === 'ar') {
    lines.push('Respond in Arabic.')
  } else if (ctx.lang === 'mixed') {
    lines.push('The user is mixing Arabic and English. Mirror their language blend.')
  } else {
    lines.push('Respond in the same language as the user.')
  }

  // ── Intent ────────────────────────────────
  if (ctx.intent === 'question')   lines.push('Prioritize direct semantic relevance.')
  if (ctx.intent === 'command')    lines.push('Prioritize actionable execution.')
  if (ctx.intent === 'complaint')  lines.push('Prioritize issue resolution and empathy.')
  if (ctx.intent === 'greeting')   lines.push('Prioritize natural conversational continuity.')

  // ── Reasoning mode ────────────────────────
  if (ctx.reasoningMode === 'analytical')  lines.push('Apply structured analytical reasoning.')
  if (ctx.reasoningMode === 'generative')  lines.push('Engage creative generative mode.')
  if (ctx.reasoningMode === 'reflective')  lines.push('Engage reflective exploratory mode.')

  // ── Phase ─────────────────────────────────
  if (ctx.phase === 'warmup')        lines.push('Context is early — be open and broad.')
  if (ctx.phase === 'emergent')      lines.push('Context is forming — maintain coherence.')
  if (ctx.phase === 'crystallizing') lines.push('Context is crystallizing — reinforce key structure.')
  if (ctx.phase === 'mature')        lines.push('Context is mature — be precise and direct.')

  // ── Pattern ───────────────────────────────
  if (ctx.pattern === 'shifting')    lines.push('Topic is shifting — anchor to last stable intent.')
  if (ctx.pattern === 'emerging')    lines.push('New structure is emerging — support it without forcing.')
  if (ctx.pattern === 'exploring')   lines.push('User is exploring — give space, avoid over-narrowing.')
  if (ctx.pattern === 'oscillating') lines.push('Context is oscillating — prioritize grounding.')
  if (ctx.pattern === 'compressed')  lines.push('Prioritize continuity preservation.')
  if (ctx.pattern === 'unstable')    lines.push('Increase contextual verification weighting.')

  // ── Drift ─────────────────────────────────
  if (ctx.drift > 0.5) {
    lines.push('Significant semantic drift detected — verify alignment before proceeding.')
  } else if (ctx.driftAcceleration > 0.6) {
    lines.push('Drift is accelerating — monitor topic continuity.')
  }

  // ── Emergence [F3] ───────────────────────
  if (ctx.emergence > 0.55) {
    lines.push('A new stable structure is emerging in this conversation — build on it.')
  }

  // ── Trajectory speed ─────────────────────
  if (ctx.trajSpeed > 0.7) {
    lines.push('Conversation is moving fast — stay adaptive.')
  }

  // ── Novelty ───────────────────────────────
  if (ctx.noveltyPotential > 0.6) {
    lines.push('High novelty input — do not collapse to familiar patterns prematurely.')
  }

  // ── Attractor stability ───────────────────
  if (ctx.attractorStability > 0.75) {
    lines.push('Conversation has stable attractor — stay on established track.')
  }

  // ── Confidence guard ─────────────────────
  if (ctx.confidence < 0.4) {
    lines.push('Input is sparse — ask for clarification if needed.')
  }

  // ── Universal ─────────────────────────────
  lines.push('Maintain natural communication style.')
  lines.push('Do not alter response personality unless necessary.')

  return lines.join('\n')
}
