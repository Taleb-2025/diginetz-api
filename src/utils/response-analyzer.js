/**
 * response-analyzer.js v2.0
 * Wave Effect Analyzer — measures vibration impact on the field
 *
 * NOT: right or wrong
 * BUT: did this wave reinforce or destabilize the web?
 */

// ── Wave Effect Measurement ──────────────────
function measureWaveEffect(fieldBefore, fieldAfter) {
  if (!fieldBefore || !fieldAfter) {
    return { effect: 'neutral', coherenceDelta: 0, driftDelta: 0, resonanceDelta: 0 }
  }

  const coherenceBefore  = Number(fieldBefore.coherence  ?? 0)
  const coherenceAfter   = Number(fieldAfter.coherence   ?? 0)
  const coherenceDelta   = coherenceAfter - coherenceBefore

  const driftBefore      = Number(fieldBefore.drift      ?? 0)
  const driftAfter       = Number(fieldAfter.drift       ?? 0)
  const driftDelta       = driftAfter - driftBefore

  const resonanceBefore  = Number(fieldBefore.resonance  ?? 0)
  const resonanceAfter   = Number(fieldAfter.resonance   ?? 0)
  const resonanceDelta   = resonanceAfter - resonanceBefore

  const attractorsBefore = Number(fieldBefore.topicPressure ?? fieldBefore.attractorStability ?? 0)
  const attractorsAfter  = Number(fieldAfter.topicPressure  ?? fieldAfter.attractorStability  ?? 0)
  const attractorDelta   = attractorsAfter - attractorsBefore

  // Score: positive = reinforced, negative = destabilized
  const score =
    (coherenceDelta  *  2.0) +   // coherence matters most
    (driftDelta      * -1.5) +   // drift rising = bad
    (resonanceDelta  *  1.0) +   // resonance = signal strength
    (attractorDelta  *  1.0)     // attractor stability

  let effect
  if      (score >  0.05) effect = 'reinforced'
  else if (score < -0.05) effect = 'destabilized'
  else                    effect = 'neutral'

  return {
    effect,
    score:          Math.round(score * 1000) / 1000,
    coherenceDelta: Math.round(coherenceDelta  * 1000) / 1000,
    driftDelta:     Math.round(driftDelta      * 1000) / 1000,
    resonanceDelta: Math.round(resonanceDelta  * 1000) / 1000,
    attractorDelta: Math.round(attractorDelta  * 1000) / 1000,
  }
}

// ── Verbosity Monitor ────────────────────────
function measureVerbosity(reply, maxTokens) {
  if (!reply) return { flag: false, adjustment: null }
  const replyTokens = Math.ceil(reply.length / 4)
  const ratio       = replyTokens / maxTokens
  if (ratio > 1.4) {
    return {
      flag:       true,
      ratio:      Math.round(ratio * 100) / 100,
      adjustment: 'Be more concise.'
    }
  }
  return { flag: false, ratio, adjustment: null }
}

// ── Style Monitor ────────────────────────────
function measureStyle(reply) {
  if (!reply) return { flag: false, adjustment: null }
  const metaPatterns = [
    /I (notice|see|observe|understand) (you|that|your)/i,
    /Let me (clarify|explain|rephrase)/i,
    /I appreciate (your|the)/i,
    /Great (question|point)/i,
    /That('s| is) (a )?(great|good|interesting)/i,
    /As (an AI|a language model)/i,
    /I should (note|mention|clarify)/i,
  ]
  const hasMeta = metaPatterns.some(p => p.test(reply))
  const words   = reply.toLowerCase().split(/\s+/)
  const wc      = {}
  let maxRepeat = 0
  for (const w of words) {
    if (w.length > 5) {
      wc[w] = (wc[w] ?? 0) + 1
      if (wc[w] > maxRepeat) maxRepeat = wc[w]
    }
  }
  const hasRepetition = maxRepeat >= 3
  if (hasMeta || hasRepetition) {
    const parts = []
    if (hasMeta)       parts.push('No meta commentary.')
    if (hasRepetition) parts.push('Avoid repetition.')
    return { flag: true, adjustment: parts.join(' ') }
  }
  return { flag: false, adjustment: null }
}

// ── Main analyze() ───────────────────────────
export function analyze({ reply, fieldBefore, fieldAfter, maxTokens = 4096 }) {

  const wave      = measureWaveEffect(fieldBefore, fieldAfter)
  const verbosity = measureVerbosity(reply, maxTokens)
  const style     = measureStyle(reply)

  // Build structural hint based on wave effect
  const adjustments = []

  if (wave.effect === 'reinforced') {
    adjustments.push('Continue current direction.')
  } else if (wave.effect === 'destabilized') {
    if (wave.driftDelta > 0.25) {
      adjustments.push('Stay on topic. Avoid tangents.')
    }
    if (wave.coherenceDelta < -0.20) {
      adjustments.push('Maintain focus on current subject.')
    }
  }

  if (verbosity.adjustment) adjustments.push(verbosity.adjustment)
  if (style.adjustment)     adjustments.push(style.adjustment)

  // Adjust maxTokens for next message
  let nextMaxTokens = maxTokens
  if (wave.effect === 'destabilized' && verbosity.flag) {
    nextMaxTokens = Math.max(200, Math.floor(maxTokens * 0.75))
  } else if (wave.effect === 'reinforced') {
    nextMaxTokens = maxTokens  // keep stable
  }

  return {
    wave: {
      effect:         wave.effect,
      score:          wave.score,
      coherenceDelta: wave.coherenceDelta,
      driftDelta:     wave.driftDelta,
      resonanceDelta: wave.resonanceDelta,
      attractorDelta: wave.attractorDelta,
    },
    flags: {
      verbosity: verbosity.flag,
      style:     style.flag,
    },
    adjustments,
    nextMaxTokens,
    structuralHint: adjustments.length > 0 ? adjustments.join(' ') : null
  }
}
