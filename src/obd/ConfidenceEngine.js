'use strict'

/**
 * ConfidenceEngine.js
 * يقيّم موثوقية نتائج التحليل
 *
 * Path: src/obd/ConfidenceEngine.js
 */

export class ConfidenceEngine {

  constructor(options = {}) {
    this._minSamples     = options.minSamples     ?? 30
    this._minStableRatio = options.minStableRatio ?? 0.7
    this._weights = {
      sampleCount:  0.30,  // عدد العينات
      stability:    0.30,  // استقرار البيانات
      consistency:  0.25,  // تناسق القراءات
      baseline:     0.15   // وجود baseline
    }
  }

  // ─── تقييم موثوقية PID واحد ──────────────────────────────────────────────

  evaluatePID({ sampleCount, stdDev, mean, hasBaseline, historyLength }) {

    // 1. عدد العينات
    const sampleScore = Math.min(1, sampleCount / this._minSamples)

    // 2. الاستقرار — stdDev منخفض نسبةً للمتوسط
    const cv = mean > 0 ? stdDev / mean : 1
    const stabilityScore = Math.max(0, 1 - cv)

    // 3. تناسق القراءات — مبني على حجم التاريخ
    const consistencyScore = Math.min(1, historyLength / 20)

    // 4. وجود Baseline
    const baselineScore = hasBaseline ? 1 : 0

    // الدرجة المرجّحة
    const raw = (
      sampleScore      * this._weights.sampleCount +
      stabilityScore   * this._weights.stability   +
      consistencyScore * this._weights.consistency +
      baselineScore    * this._weights.baseline
    )

    const score = Math.round(raw * 100)

    return {
      score,
      level:      this._classifyLevel(score),
      factors: {
        samples:     Math.round(sampleScore    * 100),
        stability:   Math.round(stabilityScore * 100),
        consistency: Math.round(consistencyScore * 100),
        baseline:    Math.round(baselineScore  * 100)
      }
    }
  }

  // ─── تقييم موثوقية النظام الكلي ─────────────────────────────────────────

  evaluateOverall(pidScores, correlationCount) {

    if (pidScores.length === 0) {
      return { score: 0, level: 'insufficient', message: 'No data available' }
    }

    const avg = pidScores.reduce((s, v) => s + v, 0) / pidScores.length

    // عقوبة إذا كانت Correlation alerts كثيرة
    const correlationPenalty = Math.min(20, correlationCount * 5)

    const score = Math.max(0, Math.round(avg - correlationPenalty))

    return {
      score,
      level:   this._classifyLevel(score),
      message: this._getMessage(score)
    }
  }

  // ─── تصنيف المستوى ────────────────────────────────────────────────────────

  _classifyLevel(score) {
    if (score >= 80) return 'high'
    if (score >= 60) return 'medium'
    if (score >= 40) return 'low'
    return 'insufficient'
  }

  // ─── رسالة للمستخدم ───────────────────────────────────────────────────────

  _getMessage(score) {
    if (score >= 80) return 'High confidence — results are reliable'
    if (score >= 60) return 'Medium confidence — collect more data for accuracy'
    if (score >= 40) return 'Low confidence — drive for a few more minutes'
    return 'Insufficient data — results may not be accurate'
  }
}
