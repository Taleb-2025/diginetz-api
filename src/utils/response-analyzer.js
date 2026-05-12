/**
 * response-analyzer.js — v1.0
 * Post-Response Structural Analyzer
 *
 * 
 *   ✓ verbosity monitor
 *   ✓ topic continuity guard
 *   ✓ style stabilizer
 *


// ─────────────────────────────────────────────
// ١. Verbosity Monitor
// ─────────────────────────────────────────────

function analyzeVerbosity(reply, maxTokens) {
  if (!reply) return { flag: false, adjustment: null }

  const replyTokens = Math.ceil(reply.length / 4)
  const ratio       = replyTokens / maxTokens


  if (ratio > 1.4) {
    return {
      flag:       true,
      ratio:      Math.round(ratio * 100) / 100,
      adjustment: 'Be more concise. Previous response was too long.'
    }
  }

 
  return { flag: false, ratio, adjustment: null }
}

// ─────────────────────────────────────────────
// ٢. Topic Continuity Guard
// ─────────────────────────────────────────────

function analyzeDrift(fieldBefore, fieldAfter) {
  if (!fieldBefore || !fieldAfter) return { flag: false, adjustment: null }

  const driftBefore = Number(fieldBefore.drift    ?? 0)
  const driftAfter  = Number(fieldAfter.drift     ?? 0)
  const driftDelta  = driftAfter - driftBefore

  const coherenceBefore = Number(fieldBefore.coherence ?? 0)
  const coherenceAfter  = Number(fieldAfter.coherence  ?? 0)
  const coherenceDrop   = coherenceBefore - coherenceAfter

  // drift 
  if (driftDelta > 0.25 || coherenceDrop > 0.20) {
    return {
      flag:         true,
      driftDelta:   Math.round(driftDelta * 100) / 100,
      coherenceDrop: Math.round(coherenceDrop * 100) / 100,
      adjustment:   'Stay on current topic. Avoid unnecessary expansion.'
    }
  }

  return { flag: false, driftDelta, coherenceDrop: 0, adjustment: null }
}

// ─────────────────────────────────────────────
// ٣. Style Stabilizer
// ─────────────────────────────────────────────

function analyzeStyle(reply) {
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

  const repetitionThreshold = 3
  const words = reply.toLowerCase().split(/\s+/)
  const wordCount = {}
  let maxRepeat = 0

  for (const word of words) {
    if (word.length > 5) {
      wordCount[word] = (wordCount[word] ?? 0) + 1
      if (wordCount[word] > maxRepeat) maxRepeat = wordCount[word]
    }
  }

  const hasMeta       = metaPatterns.some(p => p.test(reply))
  const hasRepetition = maxRepeat >= repetitionThreshold

  if (hasMeta || hasRepetition) {
    const parts = []
    if (hasMeta)       parts.push('No meta commentary.')
    if (hasRepetition) parts.push('Avoid repetition.')

    return {
      flag:       true,
      hasMeta,
      hasRepetition,
      adjustment: parts.join(' ')
    }
  }

  return { flag: false, hasMeta: false, hasRepetition: false, adjustment: null }
}

// ─────────────────────────────────────────────
// Main analyze()
// ─────────────────────────────────────────────

export function analyze({ reply, fieldBefore, fieldAfter, maxTokens = 250 }) {

  const verbosity  = analyzeVerbosity(reply, maxTokens)
  const drift      = analyzeDrift(fieldBefore, fieldAfter)
  const style      = analyzeStyle(reply)

 
  const adjustments = [
    verbosity.adjustment,
    drift.adjustment,
    style.adjustment
  ].filter(Boolean)

  maxTokens 
  let nextMaxTokens = maxTokens
  if (verbosity.flag) {
    nextMaxTokens = Math.max(80, Math.floor(maxTokens * 0.75))
  }

  return {
    flags: {
      verbosity: verbosity.flag,
      drift:     drift.flag,
      style:     style.flag
    },
    details: {
      verbosityRatio:  verbosity.ratio  ?? 1,
      driftDelta:      drift.driftDelta ?? 0,
      coherenceDrop:   drift.coherenceDrop ?? 0,
      hasMeta:         style.hasMeta    ?? false,
      hasRepetition:   style.hasRepetition ?? false
    },
    adjustments,
    nextMaxTokens,
    // structural hint 
    structuralHint: adjustments.length > 0
      ? adjustments.join(' ')
      : null
  }
}
