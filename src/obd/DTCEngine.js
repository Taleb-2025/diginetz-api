'use strict'

/**
 * DTCEngine.js
 * يقرأ أكواد الأعطال OBD-II ويفسرها
 *
 * Path: src/obd/DTCEngine.js
 */

// ─── قاعدة بيانات DTC الأساسية ───────────────────────────────────────────────
const DTC_DATABASE = {
  // ── Misfire ──
  P0300: { system: 'Engine',    severity: 'critical', en: 'Random/Multiple Cylinder Misfire',      de: 'Zufällige Mehrfachzündaussetzer',         ar: 'تعطل إشعال عشوائي في أسطوانات متعددة',   advice: { en: 'Check spark plugs, coils and fuel injectors', de: 'Zündkerzen, Spulen und Einspritzventile prüfen', ar: 'افحص البواجي والملفات والحاقنات' } },
  P0301: { system: 'Engine',    severity: 'critical', en: 'Cylinder 1 Misfire',                    de: 'Zündaussetzer Zylinder 1',                ar: 'تعطل إشعال الأسطوانة 1',                  advice: { en: 'Check cylinder 1 spark plug and coil', de: 'Zündkerze und Spule Zylinder 1 prüfen', ar: 'افحص بواجي وملف الأسطوانة 1' } },
  P0302: { system: 'Engine',    severity: 'critical', en: 'Cylinder 2 Misfire',                    de: 'Zündaussetzer Zylinder 2',                ar: 'تعطل إشعال الأسطوانة 2',                  advice: { en: 'Check cylinder 2 spark plug and coil', de: 'Zündkerze und Spule Zylinder 2 prüfen', ar: 'افحص بواجي وملف الأسطوانة 2' } },
  P0303: { system: 'Engine',    severity: 'critical', en: 'Cylinder 3 Misfire',                    de: 'Zündaussetzer Zylinder 3',                ar: 'تعطل إشعال الأسطوانة 3',                  advice: { en: 'Check cylinder 3 spark plug and coil', de: 'Zündkerze und Spule Zylinder 3 prüfen', ar: 'افحص بواجي وملف الأسطوانة 3' } },
  P0304: { system: 'Engine',    severity: 'critical', en: 'Cylinder 4 Misfire',                    de: 'Zündaussetzer Zylinder 4',                ar: 'تعطل إشعال الأسطوانة 4',                  advice: { en: 'Check cylinder 4 spark plug and coil', de: 'Zündkerze und Spule Zylinder 4 prüfen', ar: 'افحص بواجي وملف الأسطوانة 4' } },

  // ── Oxygen / Catalyst ──
  P0420: { system: 'Emissions', severity: 'warning',  en: 'Catalyst System Efficiency Below Threshold (Bank 1)', de: 'Katalysatoreffizienz unter Schwellenwert (Bank 1)', ar: 'كفاءة المحفز أقل من الحد (Bank 1)',  advice: { en: 'Check catalytic converter and O2 sensors', de: 'Katalysator und O2-Sensoren prüfen', ar: 'افحص المحفز الحراري وحساسات الأوكسجين' } },
  P0430: { system: 'Emissions', severity: 'warning',  en: 'Catalyst System Efficiency Below Threshold (Bank 2)', de: 'Katalysatoreffizienz unter Schwellenwert (Bank 2)', ar: 'كفاءة المحفز أقل من الحد (Bank 2)',  advice: { en: 'Check catalytic converter Bank 2', de: 'Katalysator Bank 2 prüfen', ar: 'افحص المحفز الحراري Bank 2' } },
  P0131: { system: 'Emissions', severity: 'warning',  en: 'O2 Sensor Low Voltage (Bank 1 Sensor 1)',            de: 'O2-Sensor Niederspannung (Bank 1 Sensor 1)',        ar: 'جهد منخفض لحساس O2 (Bank 1 Sensor 1)', advice: { en: 'Check O2 sensor and wiring', de: 'O2-Sensor und Verkabelung prüfen', ar: 'افحص حساس الأوكسجين والأسلاك' } },
  P0171: { system: 'Fuel',      severity: 'warning',  en: 'System Too Lean (Bank 1)',                           de: 'System zu mager (Bank 1)',                          ar: 'الخليط فقير جداً (Bank 1)',             advice: { en: 'Check for vacuum leaks and MAF sensor', de: 'Auf Vakuumlecks und MAF-Sensor prüfen', ar: 'افحص تسرب الهواء وحساس MAF' } },
  P0172: { system: 'Fuel',      severity: 'warning',  en: 'System Too Rich (Bank 1)',                           de: 'System zu fett (Bank 1)',                           ar: 'الخليط غني جداً (Bank 1)',              advice: { en: 'Check fuel injectors and fuel pressure', de: 'Einspritzventile und Kraftstoffdruck prüfen', ar: 'افحص الحاقنات وضغط الوقود' } },

  // ── Cooling ──
  P0115: { system: 'Cooling',   severity: 'critical', en: 'Engine Coolant Temperature Sensor Circuit',         de: 'Kühlmitteltemperaturfühler Kreisfehler',           ar: 'خلل دائرة حساس درجة حرارة المبرد',     advice: { en: 'Check coolant temp sensor and wiring', de: 'Kühlmitteltemperaturfühler und Kabel prüfen', ar: 'افحص حساس درجة الحرارة والأسلاك' } },
  P0117: { system: 'Cooling',   severity: 'warning',  en: 'Engine Coolant Temperature Sensor Low Input',       de: 'Kühlmitteltemperaturfühler Eingabe zu niedrig',    ar: 'إشارة منخفضة لحساس درجة حرارة المبرد', advice: { en: 'Check coolant temp sensor', de: 'Kühlmitteltemperaturfühler prüfen', ar: 'افحص حساس درجة حرارة المبرد' } },

  // ── Throttle / MAF ──
  P0100: { system: 'Air',       severity: 'warning',  en: 'Mass Air Flow Sensor Circuit',                      de: 'Luftmassenmesser Kreisfehler',                     ar: 'خلل دائرة حساس تدفق الهواء',           advice: { en: 'Check MAF sensor and air filter', de: 'MAF-Sensor und Luftfilter prüfen', ar: 'افحص حساس MAF وفلتر الهواء' } },
  P0121: { system: 'Throttle',  severity: 'warning',  en: 'Throttle Position Sensor Range/Performance',        de: 'Drosselklappensensor Bereich/Leistung',            ar: 'نطاق/أداء حساس موضع الخانق',           advice: { en: 'Check throttle position sensor', de: 'Drosselklappensensor prüfen', ar: 'افحص حساس موضع الخانق' } },

  // ── Battery / Charging ──
  P0562: { system: 'Electrical', severity: 'warning', en: 'System Voltage Low',                                de: 'Systemspannung zu niedrig',                        ar: 'جهد النظام منخفض',                     advice: { en: 'Check battery and alternator', de: 'Batterie und Lichtmaschine prüfen', ar: 'افحص البطارية والدينمو' } },
  P0563: { system: 'Electrical', severity: 'notice',  en: 'System Voltage High',                               de: 'Systemspannung zu hoch',                           ar: 'جهد النظام مرتفع',                     advice: { en: 'Check voltage regulator', de: 'Spannungsregler prüfen', ar: 'افحص منظم الجهد' } }
}

export class DTCEngine {

  constructor() {
    this._codes   = []
    this._lastRead = null
  }

  // ─── تحليل كود خام من OBD ────────────────────────────────────────────────

  parseRawCodes(rawResponse) {
    if (!rawResponse) return []

    const codes = []
    const clean = rawResponse.replace(/\s+/g, '').toUpperCase()

    // Mode 03 response: 43 followed by pairs
    const match = clean.match(/43([0-9A-F]+)/)
    if (!match) return []

    const data = match[1]

    for (let i = 0; i < data.length - 3; i += 4) {
      const byte1 = parseInt(data.slice(i,     i + 2), 16)
      const byte2 = parseInt(data.slice(i + 2, i + 4), 16)

      if (byte1 === 0 && byte2 === 0) continue

      // تحويل Bytes لكود DTC
      const type = (byte1 >> 6) & 0x03
      const prefix = ['P', 'C', 'B', 'U'][type]
      const digit2 = (byte1 >> 4) & 0x03
      const digit3 = byte1 & 0x0F
      const digit4 = (byte2 >> 4) & 0x0F
      const digit5 = byte2 & 0x0F

      const code = `${prefix}${digit2}${digit3.toString(16).toUpperCase()}${digit4.toString(16).toUpperCase()}${digit5.toString(16).toUpperCase()}`
      codes.push(code)
    }

    return codes
  }

  // ─── تفسير كود DTC ────────────────────────────────────────────────────────

  interpret(code, lang = 'en') {
    const info = DTC_DATABASE[code]

    if (!info) {
      return {
        code,
        known:    false,
        severity: 'unknown',
        system:   'Unknown',
        message:  `Unknown fault code: ${code}`,
        advice:   'Consult a mechanic for this code'
      }
    }

    return {
      code,
      known:    true,
      severity: info.severity,
      system:   info.system,
      message:  info[lang]    ?? info.en,
      advice:   info.advice[lang] ?? info.advice.en
    }
  }

  // ─── تخزين وتفسير الأكواد ────────────────────────────────────────────────

  processCodes(rawResponse, lang = 'en') {
    const rawCodes    = this.parseRawCodes(rawResponse)
    this._codes       = rawCodes.map(code => this.interpret(code, lang))
    this._lastRead    = Date.now()
    return this._codes
  }

  // ─── ربط الأكواد بالتحليل ────────────────────────────────────────────────

  correlateWithAnalysis(analyzerResults) {
    const insights = []

    for (const dtc of this._codes) {
      if (!dtc.known) continue

      // ربط DTC بـ PID ذي صلة
      const relatedPID = this._getRelatedPID(dtc.code)

      if (relatedPID && analyzerResults[relatedPID]) {
        const pidResult = analyzerResults[relatedPID]
        insights.push({
          dtc:        dtc.code,
          pid:        relatedPID,
          pidStatus:  pidResult.status,
          message:    dtc.message,
          advice:     dtc.advice,
          severity:   dtc.severity,
          confirmed:  pidResult.status !== 'NORMAL'
        })
      } else {
        insights.push({
          dtc:       dtc.code,
          pid:       null,
          message:   dtc.message,
          advice:    dtc.advice,
          severity:  dtc.severity,
          confirmed: false
        })
      }
    }

    return insights
  }

  // ─── ربط كود بـ PID ──────────────────────────────────────────────────────

  _getRelatedPID(code) {
    const map = {
      P0115: 'COOLANT', P0117: 'COOLANT',
      P0100: 'LOAD',
      P0121: 'THROTTLE',
      P0171: 'LOAD',    P0172: 'LOAD',
      P0300: 'RPM',     P0301: 'RPM',
      P0302: 'RPM',     P0303: 'RPM',    P0304: 'RPM',
      P0131: 'LOAD',    P0420: 'LOAD',   P0430: 'LOAD'
    }
    return map[code] ?? null
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  getCodes()         { return this._codes }
  hasCodes()         { return this._codes.length > 0 }
  getCritical()      { return this._codes.filter(c => c.severity === 'critical') }
  getLastReadTime()  { return this._lastRead }

  getWorstSeverity() {
    if (this._codes.some(c => c.severity === 'critical')) return 'critical'
    if (this._codes.some(c => c.severity === 'warning'))  return 'warning'
    if (this._codes.some(c => c.severity === 'notice'))   return 'notice'
    return 'none'
  }
}
