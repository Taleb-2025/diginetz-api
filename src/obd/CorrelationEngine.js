'use strict'

/**
 * CorrelationEngine.js
 * يكتشف العلاقات والتناقضات بين PIDs
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
    this._lastValues[name] = value
  }

  // ─── تشغيل جميع قواعد الارتباط ──────────────────────────────────────────

  analyze() {
    const v       = this._lastValues
    const alerts  = []

    // نحتاج على الأقل RPM
    if (v.RPM === undefined) return []

    // ─── 1. Speed عالية + RPM منخفض (Idle) ──────────────────────────────
    // السيارة واقفة لكن Speed يظهر قيمة عالية → تناقض
    if (v.SPEED !== undefined) {
      if (v.RPM < 1000 && v.SPEED > 10) {
        alerts.push({
          rule:     'SPEED_RPM_CONTRADICTION',
          severity: 'warning',
          message:  'Speed reading inconsistent with idle RPM',
          advice:   'Check vehicle speed sensor (VSS)',
          pids:     ['SPEED', 'RPM'],
          values:   { RPM: v.RPM, SPEED: v.SPEED }
        })
      }
    }

    // ─── 2. Throttle عالي + RPM لا يرتفع → اختناق/انسداد ────────────────
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

    // ─── 3. Load عالي + Throttle منخفض → Anomaly ─────────────────────────
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

    // ─── 4. Coolant عالي + Load منخفض → تبريد ضعيف ──────────────────────
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

    // ─── 5. RPM عالي + Speed = 0 → Neutral أو خلل ────────────────────────
    if (v.SPEED !== undefined) {
      if (v.RPM > 2000 && v.SPEED === 0) {
        alerts.push({
          rule:     'HIGH_RPM_NO_SPEED',
          severity: 'notice',
          message:  'High RPM with no vehicle movement',
          advice:   'Vehicle may be in neutral or clutch slipping',
          pids:     ['RPM', 'SPEED'],
          values:   { RPM: v.RPM, SPEED: v.SPEED }
        })
      }
    }

    // ─── 6. Coolant طبيعي لكن Load مرتفع جداً → إجهاد محرك ──────────────
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

    this._alerts = alerts
    return alerts
  }

  // ─── الحصول على آخر التنبيهات ─────────────────────────────────────────────

  getAlerts()      { return this._alerts }
  getLastValues()  { return { ...this._lastValues } }
  hasAlerts()      { return this._alerts.length > 0 }

  // ─── أسوأ مستوى خطورة ────────────────────────────────────────────────────

  getWorstSeverity() {
    if (this._alerts.some(a => a.severity === 'critical')) return 'critical'
    if (this._alerts.some(a => a.severity === 'warning'))  return 'warning'
    if (this._alerts.some(a => a.severity === 'notice'))   return 'notice'
    return 'normal'
  }
}
