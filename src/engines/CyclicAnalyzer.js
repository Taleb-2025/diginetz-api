'use strict'

/**
 * CyclicAnalyzer
 * Predictive behavioral analyzer for cyclic signals
 * Part of DigiNetz Engine Suite
 *
 * Path: src/engines/CyclicAnalyzer.js
 */

export class CyclicAnalyzer {
  constructor(engine, options = {}) {
    this._engine           = engine
    this._historyWindow    = options.historyWindow    ?? 20
    this._baseThreshold    = options.baseThreshold    ?? 50
    this._trendBufferSize  = options.trendBufferSize  ?? 5
    this._scoreHistorySize = options.scoreHistorySize ?? 10
    this._intervalMs       = options.intervalMs       ?? 3600000

    this._adaptiveThreshold = this._baseThreshold
    this._learnedSteps      = []
    this._learnedZScores    = []
    this._anomalyStartTime  = null
    this._lastSeverity      = 0
    this._trendBuffer       = []
    this._hasData           = false
    this._readingCount      = 0
    this._scoreHistory      = []
  }

  // ─── Private: Statistics ────────────────────────────────────────────────────

  _zNormalize(arr) {
    const n = arr.length
    if (n === 0) return []
    const mean = arr.reduce((s, v) => s + v, 0) / n
    const std  = n > 1
      ? Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1))
      : 0
    if (std === 0) return arr.map(() => 0)
    return arr.map(v => (v - mean) / std)
  }

  _slidingWindowSimilarity(currentSteps, learnedZScores) {
    if (learnedZScores.length === 0 || currentSteps.length === 0) return null
    const windowSize = Math.min(currentSteps.length, learnedZScores.length)
    const cWindow    = currentSteps.slice(-windowSize)
    const lWindow    = learnedZScores.slice(-windowSize)
    const cNorm      = this._zNormalize(cWindow)
    let   sumDiff    = 0
    for (let i = 0; i < windowSize; i++) {
      sumDiff += Math.pow(cNorm[i] - lWindow[i], 2)
    }
    const rmse       = Math.sqrt(sumDiff / windowSize)
    const similarity = Math.max(0, 1 - rmse / 2)
    return Math.round(similarity * 100) / 100
  }

  _extractSteps(historySlice) {
    const steps = []
    for (let i = 1; i < historySlice.length; i++) {
      steps.push(Math.abs(
        this._engine.signedDistance(historySlice[i - 1].next, historySlice[i].next)
      ))
    }
    return steps
  }

  _extractStepsFromValues(values) {
    const steps = []
    for (let i = 1; i < values.length; i++) {
      steps.push(Math.abs(
        this._engine.signedDistance(values[i - 1], values[i])
      ))
    }
    return steps
  }

  _linearSlope(buffer) {
    const n = buffer.length
    if (n < 2) return 0
    const xm  = (n - 1) / 2
    const ym  = buffer.reduce((s, v) => s + v, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (i - xm) * (buffer[i] - ym)
      den += Math.pow(i - xm, 2)
    }
    return den === 0 ? 0 : num / den
  }

  _weightedSlope(buffer) {
    const n = buffer.length
    if (n < 2) return 0
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      const w = (i + 1) / n
      num += w * (i - (n - 1) / 2) * buffer[i]
      den += w * Math.pow(i - (n - 1) / 2, 2)
    }
    return den === 0 ? 0 : num / den
  }

  // ─── Private: Trend & Threshold ─────────────────────────────────────────────

  _getTrend() {
    if (this._trendBuffer.length < 2) return 'stable'
    const slope = this._linearSlope(this._trendBuffer)
    if (slope > 0.5)  return 'rising'
    if (slope < -0.5) return 'falling'
    return 'stable'
  }

  _computeThresholdCeiling() {
    return this._engine.getMaxVelocity() * 6
  }

  // ─── Private: Forecast ──────────────────────────────────────────────────────

  _estimateETA(trend, deviation) {
    if (trend !== 'rising') return null
    const remaining = (this._adaptiveThreshold * 2) - deviation
    if (remaining <= 0) return '0.0s'
    const slope = this._weightedSlope(this._trendBuffer)
    if (slope <= 0) return null
    return (remaining / slope).toFixed(1) + 's'
  }

  _computeForecastConfidence(scores, slope) {
    const historyWeight = this._scoreHistory.length / this._scoreHistorySize
    const mean          = scores.reduce((s, v) => s + v, 0) / scores.length
    const ssTot         = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0)
    const predicted     = scores.map((_, i) =>
      mean + slope * (i - (scores.length - 1) / 2)
    )
    const ssRes = scores.reduce((s, v, i) => s + Math.pow(v - predicted[i], 2), 0)
    const r2    = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot)
    return Math.min(99, Math.round(historyWeight * r2 * 99))
  }

  _computeForecast(currentScore) {
    if (this._scoreHistory.length < 3) return null
    const scores = this._scoreHistory.map(e => e.score)
    const slope  = this._linearSlope(scores)
    if (slope >= 0) return null

    const degradationPerInterval = Math.abs(slope)
    const msPerInterval          = this._intervalMs

    const intervalsTo = (target) => {
      const gap = currentScore - target
      if (gap <= 0) return null
      return Math.round(gap / degradationPerInterval)
    }

    const formatDuration = (intervals) => {
      if (intervals === null) return null
      const ms   = intervals * msPerInterval
      const mins = Math.round(ms / 60000)
      const hrs  = Math.round(ms / 3600000)
      const days = Math.round(ms / 86400000)
      if (days >= 2) return days + ' days'
      if (hrs  >= 2) return hrs  + ' hours'
      return mins + ' minutes'
    }

    const confidence = this._computeForecastConfidence(scores, slope)

    return {
      degradationRate: Math.round(degradationPerInterval * 100) / 100,
      score50in:       formatDuration(intervalsTo(50)),
      score30in:       formatDuration(intervalsTo(30)),
      confidence
    }
  }

  // ─── Private: Classification ────────────────────────────────────────────────

  _buildReason(status, deviation) {
    const t = this._adaptiveThreshold
    if (status === 'CRITICAL') {
      return 'deviation ' + Math.round(deviation) + ' exceeded critical threshold ' + Math.round(t * 2)
    }
    if (status === 'WARNING') return 'velocity exceeded max allowed limit'
    if (status === 'NOTICE') {
      return 'deviation ' + Math.round(deviation) + ' above notice threshold ' + Math.round(t)
    }
    return 'within normal range'
  }

  _classifyPattern(similarity) {
    if (similarity === null)  return 'no pattern learned yet'
    if (similarity > 0.8)    return 'high match with learned pattern'
    if (similarity > 0.5)    return 'partial match'
    return 'low match - unknown pattern'
  }

  _computeBehaviorVector(stdDev, deviation, similarity) {
    const hasPattern    = this._learnedZScores.length > 0
    const patternWeight = hasPattern
      ? Math.min(0.2, 0.2 * (this._readingCount / this._historyWindow))
      : 0

    const remainingWeight = 1 - patternWeight
    const stabilityWeight = remainingWeight * 0.5
    const deviationWeight = remainingWeight * 0.5

    const stabilityScore = Math.max(0, Math.min(1,
      1 - (stdDev / (this._adaptiveThreshold + 1))
    ))
    const deviationScore = Math.min(1,
      deviation / (this._adaptiveThreshold * 2)
    )
    const patternScore = similarity ?? 0

    const behaviorScore = Math.round((
      stabilityScore       * stabilityWeight +
      (1 - deviationScore) * deviationWeight +
      patternScore         * patternWeight
    ) * 100)

    return {
      stability: Math.round(stabilityScore * 100),
      deviation: Math.round(deviationScore * 100),
      pattern:   Math.round(patternScore   * 100),
      behavior:  behaviorScore
    }
  }

  _classifyHealth(behaviorScore) {
    if (behaviorScore >= 80) return 'Stable'
    if (behaviorScore >= 60) return 'Drift'
    if (behaviorScore >= 40) return 'Risk'
    return 'Critical'
  }

  // ─── Public: Core ───────────────────────────────────────────────────────────

  analyze(value) {
    const prev    = this._engine.getState()
    const result  = this._engine.transitionTo(value)
    const current = this._engine.getState()
    const diff    = Math.abs(this._engine.signedDistance(prev, current))

    // Trend buffer
    this._trendBuffer.push(diff)
    if (this._trendBuffer.length > this._trendBufferSize) this._trendBuffer.shift()
    this._hasData = true
    this._readingCount++

    // History stats
    const history = this._engine.getHistory().slice(-this._historyWindow)
    let avgStep = 0, stdDev = 0, steps = []

    if (history.length > 1) {
      steps   = this._extractSteps(history)
      avgStep = steps.reduce((s, v) => s + v, 0) / steps.length

      const variance = steps.reduce(
        (s, v) => s + Math.pow(v - avgStep, 2), 0
      ) / Math.max(steps.length - 1, 1)
      stdDev = Math.sqrt(variance)

      const raw     = avgStep + stdDev * 2.5
      const ceiling = this._computeThresholdCeiling()
      this._adaptiveThreshold = Math.max(
        this._baseThreshold,
        Math.min(raw, ceiling)
      )
    }

    const trend     = this._getTrend()
    const deviation = Math.abs(diff - avgStep)

    this._lastSeverity = Math.min(
      100,
      Math.round((deviation / (this._adaptiveThreshold * 2)) * 100)
    )

    const similarity = this._slidingWindowSimilarity(steps, this._learnedZScores)

    const confidence = similarity !== null
      ? Math.min(99, Math.round(50 + similarity * 49))
      : Math.min(99, Math.round(40 + (history.length / this._historyWindow) * 50))

    const confidenceSource = similarity !== null ? 'pattern' : 'history'
    const eta              = this._estimateETA(trend, deviation)

    // Status classification
    let status = 'NORMAL'
    if      (deviation > this._adaptiveThreshold * 2)              status = 'CRITICAL'
    else if (result.velocity > this._engine.getMaxVelocity())      status = 'WARNING'
    else if (deviation > this._adaptiveThreshold)                  status = 'NOTICE'

    // Anomaly timing
    if (status !== 'NORMAL' && !this._anomalyStartTime) {
      this._anomalyStartTime = Date.now()
    } else if (status === 'NORMAL') {
      this._anomalyStartTime = null
    }

    const sinceSec = this._anomalyStartTime
      ? ((Date.now() - this._anomalyStartTime) / 1000).toFixed(1)
      : null

    // Behavior vector & health
    const behaviorVector = this._computeBehaviorVector(stdDev, deviation, similarity)
    const health         = this._classifyHealth(behaviorVector.behavior)

    // Score history
    this._scoreHistory.push({ score: behaviorVector.behavior, time: Date.now() })
    if (this._scoreHistory.length > this._scoreHistorySize) this._scoreHistory.shift()

    const forecast = this._computeForecast(behaviorVector.behavior)

    return {
      status,
      severity:         this._lastSeverity,
      trend,
      eta,
      confidence,
      confidenceSource,
      similarity:       similarity !== null ? Math.round(similarity * 100) + '%' : null,
      avgStep:          Math.round(avgStep * 100) / 100,
      stdDev:           Math.round(stdDev  * 100) / 100,
      threshold:        Math.round(this._adaptiveThreshold),
      behaviorVector,
      health,
      forecast,
      explain: {
        reason:  this._buildReason(status, deviation),
        since:   sinceSec ? sinceSec + 's' : null,
        pattern: this._classifyPattern(similarity),
        etaUnavailableReason: trend !== 'rising' && status === 'CRITICAL'
          ? 'trend is ' + trend + ' - deviation may be resolving'
          : null
      }
    }
  }

  // ─── Public: Learning & Calibration ─────────────────────────────────────────

  learnPattern(values) {
    const steps             = this._extractStepsFromValues(values)
    this._learnedSteps      = steps
    this._learnedZScores    = this._zNormalize(steps)
    this._adaptiveThreshold = this._baseThreshold
    this._trendBuffer       = []
    this._anomalyStartTime  = null
    this._hasData           = false
    this._readingCount      = 0
    this._scoreHistory      = []
  }

  recalibrate() {
    this._adaptiveThreshold = this._baseThreshold
    this._learnedSteps      = []
    this._learnedZScores    = []
    this._trendBuffer       = []
    this._anomalyStartTime  = null
    this._lastSeverity      = 0
    this._hasData           = false
    this._readingCount      = 0
    this._scoreHistory      = []
  }

  getSeverity() {
    if (!this._hasData) return { severity: null, trend: null, ready: false }
    return {
      severity: this._lastSeverity,
      trend:    this._getTrend(),
      ready:    true
    }
  }
}
