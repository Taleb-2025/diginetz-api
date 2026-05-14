function measureWaveEffect(fieldBefore, fieldAfter) {
  if (!fieldBefore || !fieldAfter) {
    return { effect: 'neutral', score: 0, coherenceDelta: 0, driftDelta: 0, resonanceDelta: 0, attractorDelta: 0 }
  }

  const coherenceDelta  = Number(fieldAfter.coherence     ?? 0) - Number(fieldBefore.coherence     ?? 0)
  const driftDelta      = Number(fieldAfter.drift         ?? 0) - Number(fieldBefore.drift         ?? 0)
  const resonanceDelta  = Number(fieldAfter.resonance     ?? 0) - Number(fieldBefore.resonance     ?? 0)
  const attractorDelta  = Number(fieldAfter.topicPressure ?? 0) - Number(fieldBefore.topicPressure ?? 0)

  const score =
    (coherenceDelta * 2.0) +
    (driftDelta    * -1.5) +
    (resonanceDelta * 1.0) +
    (attractorDelta * 1.0)

  const effect =
    score >  0.05 ? 'reinforced'   :
    score < -0.05 ? 'destabilized' :
    'neutral'

  return {
    effect,
    score:          Math.round(score          * 1000) / 1000,
    coherenceDelta: Math.round(coherenceDelta * 1000) / 1000,
    driftDelta:     Math.round(driftDelta     * 1000) / 1000,
    resonanceDelta: Math.round(resonanceDelta * 1000) / 1000,
    attractorDelta: Math.round(attractorDelta * 1000) / 1000
  }
}

export function analyze({ reply, fieldBefore, fieldAfter }) {
  const wave = measureWaveEffect(fieldBefore, fieldAfter)

  return {
    wave: {
      effect:         wave.effect,
      score:          wave.score,
      coherenceDelta: wave.coherenceDelta,
      driftDelta:     wave.driftDelta,
      resonanceDelta: wave.resonanceDelta,
      attractorDelta: wave.attractorDelta
    }
  }
}
