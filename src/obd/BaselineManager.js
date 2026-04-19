'use strict'

/**
 * BaselineManager.js
 * يتعلم النمط الطبيعي لكل سيارة ويقارن القراءات به
 *
 * Path: src/obd/BaselineManager.js
 */

export class BaselineManager {

  constructor(options = {}) {
    this._minSamples    = options.minSamples    ?? 30   // حد أدنى للعينات
    this._stableWindow  = options.stableWindow  ?? 60   // ثانية للاستقرار
    this._maxDeviation  = options.maxDeviation  ?? 3.0  // σ للانحراف الشديد

    this._samples  = {}   // { PID: [values] }
    this._baseline = {}   // { PID: { mean, std, min, max, count } }
    this._locked   = false
    this._startTime = Date.now()
  }

  // ─── إضافة عينة جديدة ────────────────────────────────────────────────────

  addSample(name, value) {
    if (this._locked) return

    if (!this._samples[name]) {
      this._samples[name] = []
    }

    this._samples[name].push(value)
  }

  // ─── حساب الـ Baseline ───────────────────────────────────────────────────

  _compute(values) {
    const n    = values.length
    if (n === 0) return null

    const mean = values.reduce((s, v) => s + v, 0) / n

    const variance = values.reduce(
      (s, v) => s + Math.pow(v - mean, 2), 0
    ) / Math.max(n - 1, 1)

    const std = Math.sqrt(variance)
    const min = Math.min(...values)
    const max = Math.max(...values)

    return {
      mean:  Math.round(mean  * 100) / 100,
      std:   Math.round(std   * 100) / 100,
      min:   Math.round(min   * 100) / 100,
      max:   Math.round(max   * 100) / 100,
      count: n
    }
  }

  // ─── قفل الـ Baseline ────────────────────────────────────────────────────

  lock() {
    if (this._locked) return false

    let allReady = true

    for (const [name, values] of Object.entries(this._samples)) {
      if (values.length < this._minSamples) {
        allReady = false
        continue
      }
      this._baseline[name] = this._compute(values)
    }

    if (Object.keys(this._baseline).length === 0) return false

    this._locked = true
    return true
  }

  // ─── مقارنة قراءة مع الـ Baseline ────────────────────────────────────────

  compare(name, value) {
    const base = this._baseline[name]
    if (!base || base.std === 0) {
      return { deviation: 0, sigma: 0, level: 'unknown' }
    }

    const deviation = Math.abs(value - base.mean)
    const sigma     = deviation / base.std

    let level = 'normal'
    if (sigma > this._maxDeviation * 2) level = 'critical'
    else if (sigma > this._maxDeviation)  level = 'warning'
    else if (sigma > this._maxDeviation * 0.6) level = 'notice'

    return {
      deviation: Math.round(deviation * 100) / 100,
      sigma:     Math.round(sigma     * 100) / 100,
      level,
      baseline:  base.mean,
      std:       base.std
    }
  }

  // ─── هل الـ Baseline جاهز؟ ───────────────────────────────────────────────

  isReady() { return this._locked }

  isCollecting() {
    return !this._locked &&
      Object.values(this._samples).some(v => v.length > 0)
  }

  getProgress() {
    if (this._locked) return 100

    const counts  = Object.values(this._samples).map(v => v.length)
    if (counts.length === 0) return 0

    const avg = counts.reduce((s, v) => s + v, 0) / counts.length
    return Math.min(99, Math.round((avg / this._minSamples) * 100))
  }

  getBaseline() { return { ...this._baseline } }

  reset() {
    this._samples   = {}
    this._baseline  = {}
    this._locked    = false
    this._startTime = Date.now()
  }
}
