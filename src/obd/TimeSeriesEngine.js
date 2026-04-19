'use strict'

/**
 * TimeSeriesEngine.js
 * يحلل التغير مع الزمن — Drift / Slope / Oscillation
 *
 * Path: src/obd/TimeSeriesEngine.js
 */

export class TimeSeriesEngine {

  constructor(options = {}) {
    this._windowSize    = options.windowSize    ?? 30   // عدد القراءات
    this._driftThreshold = options.driftThreshold ?? 0.1  // 10% drift
    this._oscThreshold  = options.oscThreshold  ?? 3    // تغييرات اتجاه
    this._history       = {}  // { PID: [{ value, time }] }
  }

  // ─── إضافة قراءة ─────────────────────────────────────────────────────────

  add(name, value, time = Date.now()) {
    if (!this._history[name]) {
      this._history[name] = []
    }

    this._history[name].push({ value, time })

    // نحافظ على window محدود
    if (this._history[name].length > this._windowSize) {
      this._history[name].shift()
    }
  }

  // ─── تحليل PID ───────────────────────────────────────────────────────────

  analyze(name) {
    const series = this._history[name]
    if (!series || series.length < 5) {
      return { ready: false, reason: 'insufficient data' }
    }

    const values = series.map(s => s.value)

    return {
      ready:       true,
      slope:       this._computeSlope(values),
      drift:       this._detectDrift(values),
      oscillation: this._detectOscillation(values),
      trend:       this._classifyTrend(values),
      range:       this._computeRange(values)
    }
  }

  // ─── Slope (Linear Regression) ───────────────────────────────────────────

  _computeSlope(values) {
    const n  = values.length
    const xm = (n - 1) / 2
    const ym = values.reduce((s, v) => s + v, 0) / n

    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (i - xm) * (values[i] - ym)
      den += Math.pow(i - xm, 2)
    }

    const slope = den === 0 ? 0 : num / den
    return Math.round(slope * 1000) / 1000
  }

  // ─── Drift — انجراف تدريجي ───────────────────────────────────────────────

  _detectDrift(values) {
    const n     = values.length
    const first = values.slice(0, Math.floor(n / 3))
    const last  = values.slice(Math.floor(n * 2 / 3))

    const firstMean = first.reduce((s, v) => s + v, 0) / first.length
    const lastMean  = last.reduce((s, v) => s + v, 0)  / last.length

    if (firstMean === 0) return { detected: false, magnitude: 0 }

    const magnitude = Math.abs(lastMean - firstMean) / Math.abs(firstMean)
    const detected  = magnitude > this._driftThreshold

    return {
      detected,
      magnitude:  Math.round(magnitude  * 100) / 100,
      direction:  lastMean > firstMean ? 'rising' : 'falling',
      firstMean:  Math.round(firstMean  * 100) / 100,
      lastMean:   Math.round(lastMean   * 100) / 100
    }
  }

  // ─── Oscillation — تذبذب غير طبيعي ──────────────────────────────────────

  _detectOscillation(values) {
    let directionChanges = 0

    for (let i = 2; i < values.length; i++) {
      const prev = values[i - 1] - values[i - 2]
      const curr = values[i]     - values[i - 1]
      if (prev * curr < 0) directionChanges++
    }

    const ratio    = directionChanges / (values.length - 2)
    const detected = directionChanges >= this._oscThreshold && ratio > 0.4

    return {
      detected,
      directionChanges,
      ratio: Math.round(ratio * 100) / 100
    }
  }

  // ─── Trend تصنيف ─────────────────────────────────────────────────────────

  _classifyTrend(values) {
    const slope = this._computeSlope(values)

    // نسبّب الـ slope بالمتوسط
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    if (mean === 0) return 'stable'

    const normalizedSlope = slope / Math.abs(mean)

    if (normalizedSlope > 0.02)  return 'rising'
    if (normalizedSlope < -0.02) return 'falling'
    return 'stable'
  }

  // ─── Range ───────────────────────────────────────────────────────────────

  _computeRange(values) {
    const min = Math.min(...values)
    const max = Math.max(...values)
    return {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      span: Math.round((max - min) * 100) / 100
    }
  }

  // ─── تحليل كل PIDs ───────────────────────────────────────────────────────

  analyzeAll() {
    const results = {}
    for (const name of Object.keys(this._history)) {
      results[name] = this.analyze(name)
    }
    return results
  }

  // ─── كشف مبكر للمشاكل ────────────────────────────────────────────────────

  getWarnings() {
    const warnings = []
    const all      = this.analyzeAll()

    for (const [name, result] of Object.entries(all)) {
      if (!result.ready) continue

      // Drift كبير
      if (result.drift.detected && result.drift.magnitude > 0.2) {
        warnings.push({
          pid:     name,
          type:    'drift',
          message: `${name} drifting ${result.drift.direction} — ${Math.round(result.drift.magnitude * 100)}% change`,
          severity: result.drift.magnitude > 0.4 ? 'warning' : 'notice'
        })
      }

      // Oscillation
      if (result.oscillation.detected) {
        warnings.push({
          pid:      name,
          type:     'oscillation',
          message:  `${name} oscillating abnormally`,
          severity: 'warning'
        })
      }
    }

    return warnings
  }
}
