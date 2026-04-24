'use strict'

/**
 * AnalyzerManager
 * Manages one CyclicDynamicsEngine + CyclicAnalyzer per OBD PID
 * Produces unified vehicle health status
 *
 * Path: src/obd/AnalyzerManager.js
 */

import { CyclicDynamicsEngine } from '../engines/CyclicDynamicsEngine.js'
import { CyclicAnalyzer }       from '../engines/CyclicAnalyzer.js'
import { BaselineManager }      from './BaselineManager.js'
import { CorrelationEngine }    from './CorrelationEngine.js'
import { AdvisorEngine }        from './AdvisorEngine.js'
import { ConfidenceEngine }     from './ConfidenceEngine.js'
import { TimeSeriesEngine }     from './TimeSeriesEngine.js'
import { DTCEngine }            from './DTCEngine.js'

// ─── PID Configurations ───────────────────────────────────────────────────────
// SPEED محذوف — VSS غير موثوق في هذه السيارة
const PID_CONFIGS = {
  RPM: {
    min:           0,
    max:           8000,
    maxVelocity:   1000,
    baseThreshold: 300,
    unit:          'rpm',
    label:         'Engine RPM'
  },
  COOLANT: {
    min:           -40,
    max:           215,
    maxVelocity:   5,
    baseThreshold: 8,
    unit:          '°C',
    label:         'Coolant Temp'
  },
  THROTTLE: {
    min:           0,
    max:           100,
    maxVelocity:   20,
    baseThreshold: 15,
    unit:          '%',
    label:         'Throttle Position'
  },
  LOAD: {
    min:           0,
    max:           100,
    maxVelocity:   20,
    baseThreshold: 15,
    unit:          '%',
    label:         'Engine Load'
  }
}

// ─── Health Score Weights per PID ─────────────────────────────────────────────
// SPEED محذوف — وزنه موزّع على RPM و COOLANT
const PID_WEIGHTS = {
  RPM:      0.35,
  COOLANT:  0.35,
  THROTTLE: 0.20,
  LOAD:     0.10
}

export class AnalyzerManager {

  constructor() {
    this._analyzers = {}
    this._results   = {}
    this._source    = 'simulation'

    this._baseline    = new BaselineManager({ minSamples: 30 })
    this._correlation = new CorrelationEngine()
    this._confidence  = new ConfidenceEngine()
    this._timeSeries  = new TimeSeriesEngine({ windowSize: 30 })
    this._dtc         = new DTCEngine()
    this._lang        = 'en'

    for (const [name, cfg] of Object.entries(PID_CONFIGS)) {
      const engine = new CyclicDynamicsEngine({
        cycle:        cfg.max - cfg.min,
        maxVelocity:  cfg.maxVelocity,
        initialState: 0
      })

      this._analyzers[name] = new CyclicAnalyzer(engine, {
        baseThreshold:    cfg.baseThreshold,
        intervalMs:       500,
        historyWindow:    20,
        scoreHistorySize: 10
      })
    }
  }

  // ─── Core ──────────────────────────────────────────────────────────────────

  process({ name, value, time, source }) {
    // SPEED مُتجاهل تماماً — VSS غير موثوق
    if (name === 'SPEED') return null

    const analyzer = this._analyzers[name]
    if (!analyzer) return null

    this._source = source ?? this._source

    const cfg           = PID_CONFIGS[name]
    const normalizedVal = cfg ? Math.max(0, value - cfg.min) : value

    const result = analyzer.analyze(normalizedVal)

    this._baseline.addSample(name, value)
    this._correlation.update(name, value)
    this._timeSeries.add(name, value, time ?? Date.now())

    if (!this._baseline.isReady()) {
      this._baseline.lock()
    }

    const baselineCompare = this._baseline.isReady()
      ? this._baseline.compare(name, value)
      : null

    const timeSeries = this._timeSeries.analyze(name)

    this._results[name] = {
      ...result,
      value,
      time:            time ?? Date.now(),
      unit:            cfg?.unit  ?? '',
      label:           cfg?.label ?? name,
      baselineCompare,
      timeSeries:      timeSeries.ready ? timeSeries : null
    }

    return this._results[name]
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  getStatus() {
    const analyzers     = {}
    let   weightedSum   = 0
    let   totalWeight   = 0
    let   worstStatus   = 'NORMAL'
    let   worstHealth   = 'Stable'

    const statusPriority = { CRITICAL: 4, WARNING: 3, NOTICE: 2, NORMAL: 1 }
    const healthPriority = { Critical: 4, Risk: 3, Drift: 2, Stable: 1 }

    const correlationAlerts  = this._correlation.analyze()
    const timeSeriesWarnings = this._timeSeries.getWarnings()
    const pidScores          = []

    for (const [name, r] of Object.entries(this._results)) {
      const behavior = r.behaviorVector?.behavior ?? 0
      const weight   = PID_WEIGHTS[name] ?? 0.1

      weightedSum += behavior * weight
      totalWeight += weight

      if ((statusPriority[r.status] ?? 0) > (statusPriority[worstStatus] ?? 0)) {
        worstStatus = r.status
      }
      if ((healthPriority[r.health] ?? 0) > (healthPriority[worstHealth] ?? 0)) {
        worstHealth = r.health
      }

      const confidenceResult = this._confidence.evaluatePID({
        sampleCount:   r.behaviorVector ? 10 : 0,
        stdDev:        r.stdDev  ?? 0,
        mean:          r.avgStep ?? 1,
        hasBaseline:   this._baseline.isReady(),
        historyLength: 10
      })

      pidScores.push(confidenceResult.score)

      const pidAdvice = AdvisorEngine.advisePID(
        name,
        r.status,
        r.trend,
        r.value
      )

      analyzers[name] = {
        label:           r.label,
        value:           r.value,
        unit:            r.unit,
        health:          r.health,
        status:          r.status,
        severity:        r.severity,
        behavior:        behavior,
        trend:           r.trend,
        forecast:        r.forecast         ?? null,
        eta:             r.eta              ?? null,
        explain:         r.explain          ?? null,
        stdDev:          r.stdDev           ?? null,
        avgStep:         r.avgStep          ?? null,
        baselineCompare: r.baselineCompare  ?? null,
        timeSeries:      r.timeSeries       ?? null,
        confidence:      confidenceResult,
        advice:          pidAdvice
          ? { [this._lang]: pidAdvice[this._lang] ?? pidAdvice.en }
          : null
      }
    }

    const overall = totalWeight > 0
      ? Math.round(weightedSum / totalWeight)
      : null

    const overallConfidence = this._confidence.evaluateOverall(
      pidScores,
      correlationAlerts.length
    )

    const risk = overall !== null
      ? AdvisorEngine.assessRisk(overall)
      : null

    const advisorReport = overall !== null
      ? AdvisorEngine.buildReport(
          overall,
          this._results,
          correlationAlerts,
          this._lang
        )
      : null

    const dtcCodes    = this._dtc.getCodes()
    const dtcInsights = dtcCodes.length > 0
      ? this._dtc.correlateWithAnalysis(this._results)
      : []

    const baselineStatus = {
      ready:    this._baseline.isReady(),
      progress: this._baseline.getProgress()
    }

    return {
      source:           this._source,
      overall,
      worstStatus,
      worstHealth,
      analyzers,
      timestamp:        Date.now(),
      confidence:       overallConfidence,
      risk,
      advisor:          advisorReport,
      correlations:     correlationAlerts,
      timeSeriesAlerts: timeSeriesWarnings,
      dtc:              { codes: dtcCodes, insights: dtcInsights },
      baseline:         baselineStatus
    }
  }

  // ─── DTC Processing ────────────────────────────────────────────────────────

  processDTC(rawResponse, lang = 'en') {
    return this._dtc.processCodes(rawResponse, lang)
  }

  // ─── Language ──────────────────────────────────────────────────────────────

  setLang(lang) {
    this._lang = lang
  }

  // ─── Pattern Learning ──────────────────────────────────────────────────────

  learnPattern(name, samples) {
    if (!this._analyzers[name]) return false
    this._analyzers[name].learnPattern(samples)
    return true
  }

  learnAll(samplesMap) {
    for (const [name, samples] of Object.entries(samplesMap)) {
      this.learnPattern(name, samples)
    }
  }

  // ─── Calibration ──────────────────────────────────────────────────────────

  recalibrate(name) {
    if (name) {
      this._analyzers[name]?.recalibrate()
    } else {
      for (const analyzer of Object.values(this._analyzers)) {
        analyzer.recalibrate()
      }
      this._results     = {}
      this._baseline.reset()
      this._timeSeries  = new TimeSeriesEngine({ windowSize: 30 })
      this._correlation = new CorrelationEngine()
    }
  }

  // ─── Info ──────────────────────────────────────────────────────────────────

  getPIDList() {
    return Object.entries(PID_CONFIGS).map(([name, cfg]) => ({
      name,
      label:   cfg.label,
      unit:    cfg.unit,
      min:     cfg.min,
      max:     cfg.max,
      weight:  PID_WEIGHTS[name]
    }))
  }

  hasData() {
    return Object.keys(this._results).length > 0
  }
}
