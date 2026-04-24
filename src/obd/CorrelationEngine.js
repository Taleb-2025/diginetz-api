'use strict'

/**
 * CorrelationEngine.js
 * يكتشف العلاقات والتناقضات بين PIDs
 * SPEED محذوف — VSS غير موثوق
 *
 * Path: src/obd/CorrelationEngine.js
 */

export class CorrelationEngine {

  constructor() {
    this._lastValues = {}
    this._alerts     = []
  }

  // ─── تحديث القيم ──────────────────────────────────────────────────────────

  update(name, value) {
    // SPEED مُتجاهل تماماً
    if (name === 'SPEED') return
    this._lastValues[name] = value
  }

  // ─── تشغيل جميع قواعد الارتباط ──────────────────────────────────────────

  analyze() {
    const v      = this._lastValues
    const alerts = []

    if (v.RPM === undefined) return []

    // ─── 1. Throttle عالي + RPM لا يرتفع → اختناق/انسداد ────────────────
    if (v.THROTTLE !== undefined) {
      if (v.THROTTLE > 50 && v.RPM < 1500) {
        alerts.push({
          rule:     'THROTTLE_RPM_MISMATCH',
          severity: 'warning',
          message:  'High throttle but RPM not responding',
          advice:   'Check air filter or throttle body',
          pids:     ['THROTTLE', 'RPM'],
          values:   { THROTTLE: v.THROTTLE, RPM: v.RPM }
        })
      }
    }

    // ─── 2. Load عالي + Throttle منخفض → Anomaly ─────────────────────────
    if (v.LOAD !== undefined && v.THROTTLE !== undefined) {
      if (v.LOAD > 70 && v.THROTTLE < 15) {
        alerts.push({
          rule:     'LOAD_THROTTLE_ANOMALY',
          severity: 'notice',
          message:  'High engine load with low throttle position',
          advice:   'Check for engine drag or transmission issue',
          pids:     ['LOAD', 'THROTTLE'],
          values:   { LOAD: v.LOAD, THROTTLE: v.THROTTLE }
        })
      }
    }

    // ─── 3. Coolant عالي + Load منخفض → تبريد ضعيف ──────────────────────
    if (v.COOLANT !== undefined && v.LOAD !== undefined) {
      if (v.COOLANT > 110 && v.LOAD < 30) {
        alerts.push({
          rule:     'COOLING_SYSTEM_WEAK',
          severity: 'critical',
          message:  'Overheating with low engine load',
          advice:   'Check coolant level and thermostat',
          pids:     ['COOLANT', 'LOAD'],
          values:   { COOLANT: v.COOLANT, LOAD: v.LOAD }
        })
      }
    }

    // ─── 4. RPM مرتفع جداً + Load عالي → إجهاد محرك ─────────────────────
    if (v.LOAD !== undefined) {
      if (v.LOAD > 85 && v.RPM > 4000) {
        alerts.push({
          rule:     'ENGINE_STRESS',
          severity: 'warning',
          message:  'Engine under high stress — heavy load at high RPM',
          advice:   'Reduce load or shift to lower gear',
          pids:     ['LOAD', 'RPM'],
          values:   { LOAD: v.LOAD, RPM: v.RPM }
        })
      }
    }

    // ─── 5. Coolant عالي + RPM مرتفع → خطر حرارة ────────────────────────
    if (v.COOLANT !== undefined) {
      if (v.COOLANT > 105 && v.RPM > 2500) {
        alerts.push({
          rule:     'OVERHEAT_RISK',
          severity: 'warning',
          message:  'High coolant temp at high RPM — overheating risk',
          advice:   'Reduce speed and check cooling system',
          pids:     ['COOLANT', 'RPM'],
          values:   { COOLANT: v.COOLANT, RPM: v.RPM }
        })
      }
    }

    this._alerts = alerts
    return alerts
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  getAlerts()     { return this._alerts }
  getLastValues() { return { ...this._lastValues } }
  hasAlerts()     { return this._alerts.length > 0 }

  getWorstSeverity() {
    if (this._alerts.some(a => a.severity === 'critical')) return 'critical'
    if (this._alerts.some(a => a.severity === 'warning'))  return 'warning'
    if (this._alerts.some(a => a.severity === 'notice'))   return 'notice'
    return 'normal'
  }
}
