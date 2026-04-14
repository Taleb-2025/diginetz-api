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

// ─── PID Configurations ───────────────────────────────────────────────────────
const PID_CONFIGS = {
  RPM: {
    min:           0,
    max:           8000,
    maxVelocity:   1000,
    baseThreshold: 300,
    unit:          'rpm',
    label:         'Engine RPM'
  },
  SPEED: {
    min:           0,
    max:           260,
    maxVelocity:   30,
    baseThreshold: 10,
    unit:          'km/h',
    label:         'Vehicle Speed'
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
const PID_WEIGHTS = {
  RPM:      0.30,
  COOLANT:  0.30,
  SPEED:    0.15,
  THROTTLE: 0.15,
  LOAD:     0.10
}

export class AnalyzerManager {

  constructor() {
    this._analyzers = {}
    this._results   = {}
    this._source    = 'simulation'   // 'simulation' | 'obd'

    for (const [name, cfg] of Object.entries(PID_CONFIGS)) {
      const engine = new CyclicDynamicsEngine({
        min:         cfg.min,
        max:         cfg.max,
        maxVelocity: cfg.maxVelocity
      })

      this._analyzers[name] = new CyclicAnalyzer(engine, {
        baseThreshold:   cfg.baseThreshold,
        intervalMs:      500,
        historyWindow:   20,
        scoreHistorySize: 10
      })
    }
  }

  // ─── Core ──────────────────────────────────────────────────────────────────

  process({ name, value, time, source }) {
    const analyzer = this._analyzers[name]
    if (!analyzer) return null

    this._source = source ?? this._source

    const result = analyzer.analyze(value)

    this._results[name] = {
      ...result,
      value,
      time:  time ?? Date.now(),
      unit:  PID_CONFIGS[name]?.unit  ?? '',
      label: PID_CONFIGS[name]?.label ?? name
    }

    return this._results[name]
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  getStatus() {
    const analyzers = {}
    let   weightedSum   = 0
    let   totalWeight   = 0
    let   worstStatus   = 'NORMAL'
    let   worstHealth   = 'Stable'

    const statusPriority = { CRITICAL: 4, WARNING: 3, NOTICE: 2, NORMAL: 1 }
    const healthPriority = { Critical: 4, Risk: 3, Drift: 2, Stable: 1 }

    for (const [name, r] of Object.entries(this._results)) {
      const behavior = r.behaviorVector?.behavior ?? 0
      const weight   = PID_WEIGHTS[name] ?? 0.1

      weightedSum += behavior * weight
      totalWeight += weight

      // Track worst status
      if ((statusPriority[r.status] ?? 0) > (statusPriority[worstStatus] ?? 0)) {
        worstStatus = r.status
      }
      if ((healthPriority[r.health] ?? 0) > (healthPriority[worstHealth] ?? 0)) {
        worstHealth = r.health
      }

      analyzers[name] = {
        label:    r.label,
        value:    r.value,
        unit:     r.unit,
        health:   r.health,
        status:   r.status,
        severity: r.severity,
        behavior: behavior,
        trend:    r.trend,
        forecast: r.forecast  ?? null,
        eta:      r.eta       ?? null,
        explain:  r.explain   ?? null
      }
    }

    const overall = totalWeight > 0
      ? Math.round(weightedSum / totalWeight)
      : null

    return {
      source:      this._source,
      overall,
      worstStatus,
      worstHealth,
      analyzers,
      timestamp:   Date.now()
    }
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
      this._results = {}
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
