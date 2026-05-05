/**
 * buildCelfContext
 *
 * Transforms raw CELF engine output into an interpreted context
 * ready for LLM analysis or human-readable logging.
 *
 * This utility lives OUTSIDE the engine intentionally —
 * CELF remains domain-agnostic; interpretation is the caller's concern.
 */
export function buildCelfContext(r) {
  const deviationRatio =
    r.threshold && r.jump
      ? Math.round((r.jump / r.threshold) * 100) / 100
      : null

  const phase        = r.phase         ?? 'warmup'
  const maturity     = r.maturityScore ?? 0
  const aliveRatio   = r.aliveRatio    ?? 1
  const inferredFrom = r.inferredFrom  ?? 0
  const confidence   = r.confidence    ?? 0

  const systemState =
    phase === 'warmup' ? 'learning' :
    maturity > 0.9     ? 'stable'   :
    'unstable'

  const confidenceLevel =
    confidence > 0.7 ? 'high'   :
    confidence > 0.4 ? 'medium' :
    'low'

  const severity = (() => {
    if (phase === 'warmup') return 'low'
    if (!deviationRatio)    return 'low'

    const raw =
      deviationRatio > 3 && maturity > 0.9 ? 'extreme'  :
      deviationRatio > 2 && maturity > 0.7 ? 'high'     :
      deviationRatio > 1                   ? 'moderate' :
      'low'

    // confidence منخفض يخفّف بدرجة واحدة، لا يلغي
    if (confidence < 0.2) {
      if (raw === 'extreme') return 'high'
      if (raw === 'high')    return 'moderate'
      return 'low'
    }

    return raw
  })()

  const spacePressure =
    aliveRatio < 0.2 ? 'tight'    :
    aliveRatio < 0.5 ? 'moderate' :
    'loose'

  const rejectionStrength =
    inferredFrom > 100 ? 'strong' :
    inferredFrom > 20  ? 'medium' :
    'weak'

  return {
    anomaly: r.impossible,

    raw: {
      jump:          r.jump,
      threshold:     r.threshold,
      confidence,
      phase,
      aliveRatio,
      maturityScore: maturity,
      inferredFrom
    },

    interpretation: {
      deviationRatio,
      severity,
      systemState,
      spacePressure,
      rejectionStrength,
      confidenceLevel
    }
  }
}
