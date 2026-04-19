'use strict'

/**
 * AdvisorEngine.js
 * يولّد توصيات مفهومة للمستخدم بناءً على التحليل
 *
 * Path: src/obd/AdvisorEngine.js
 */

export class AdvisorEngine {

  // ─── تقييم المخاطر ────────────────────────────────────────────────────────

  static assessRisk(behaviorScore) {
    if (behaviorScore >= 85) return { level: 'LOW',       label: 'System Healthy',       color: 'green'  }
    if (behaviorScore >= 70) return { level: 'LOW',       label: 'Minor Variations',     color: 'green'  }
    if (behaviorScore >= 55) return { level: 'MEDIUM',    label: 'Needs Monitoring',     color: 'yellow' }
    if (behaviorScore >= 40) return { level: 'HIGH',      label: 'Attention Required',   color: 'orange' }
    return                          { level: 'CRITICAL',  label: 'Immediate Action',     color: 'red'    }
  }

  // ─── توصيات بناءً على PID ─────────────────────────────────────────────────

  static advisePID(name, status, trend, value) {
    const advice = {
      COOLANT: {
        CRITICAL: { en: 'Stop vehicle immediately — risk of engine damage', de: 'Sofort anhalten — Motorschadenrisiko', ar: 'أوقف السيارة فوراً — خطر تلف المحرك' },
        WARNING:  { en: 'Monitor coolant temperature closely', de: 'Kühlmitteltemperatur genau beobachten', ar: 'راقب درجة حرارة المبرد بعناية' },
        NOTICE:   { en: 'Coolant temperature slightly elevated', de: 'Kühlmitteltemperatur leicht erhöht', ar: 'درجة حرارة المبرد مرتفعة قليلاً' },
        rising:   { en: 'Coolant rising — check cooling system soon', de: 'Kühlmittel steigt — Kühlsystem bald prüfen', ar: 'المبرد يرتفع — افحص نظام التبريد قريباً' }
      },
      RPM: {
        CRITICAL: { en: 'Irregular engine speed — check engine immediately', de: 'Unregelmäßige Motordrehzahl — Motor sofort prüfen', ar: 'سرعة محرك غير منتظمة — افحص المحرك فوراً' },
        WARNING:  { en: 'RPM instability detected', de: 'RPM-Instabilität festgestellt', ar: 'تم اكتشاف عدم استقرار في RPM' },
        NOTICE:   { en: 'Slight RPM fluctuation', de: 'Leichte RPM-Schwankung', ar: 'تذبذب خفيف في RPM' }
      },
      SPEED: {
        WARNING:  { en: 'Speed sensor may be faulty', de: 'Geschwindigkeitssensor möglicherweise defekt', ar: 'قد يكون حساس السرعة معطلاً' }
      },
      THROTTLE: {
        CRITICAL: { en: 'Throttle response abnormal — check throttle body', de: 'Drosselklappenreaktion abnormal', ar: 'استجابة الخانق غير طبيعية — افحص جسم الخانق' },
        WARNING:  { en: 'Throttle position irregular', de: 'Drosselklappenstellung unregelmäßig', ar: 'موضع الخانق غير منتظم' }
      },
      LOAD: {
        CRITICAL: { en: 'Engine overloaded — reduce demand immediately', de: 'Motor überlastet — Last sofort reduzieren', ar: 'المحرك محمّل زيادة — قلل الطلب فوراً' },
        WARNING:  { en: 'High engine load detected', de: 'Hohe Motorlast festgestellt', ar: 'تم اكتشاف حمل محرك عالٍ' }
      }
    }

    const pidAdvice = advice[name]
    if (!pidAdvice) return null

    // أعطِ أولوية للحالة الحرجة
    if (status === 'CRITICAL' && pidAdvice.CRITICAL) return pidAdvice.CRITICAL
    if (status === 'WARNING'  && pidAdvice.WARNING)  return pidAdvice.WARNING
    if (status === 'NOTICE'   && pidAdvice.NOTICE)   return pidAdvice.NOTICE
    if (trend  === 'rising'   && pidAdvice.rising)   return pidAdvice.rising

    return null
  }

  // ─── توصية من Correlation alerts ─────────────────────────────────────────

  static adviseCorrelation(alert, lang = 'en') {
    const msg = {
      SPEED_RPM_CONTRADICTION: {
        en: 'Speed sensor reading inconsistent — verify VSS sensor',
        de: 'Geschwindigkeitssensor inkonsistent — VSS-Sensor prüfen',
        ar: 'قراءة حساس السرعة غير متسقة — تحقق من حساس VSS'
      },
      THROTTLE_RPM_MISMATCH: {
        en: 'Engine not responding to throttle — check air filter',
        de: 'Motor reagiert nicht auf Gaspedal — Luftfilter prüfen',
        ar: 'المحرك لا يستجيب للخانق — افحص فلتر الهواء'
      },
      LOAD_THROTTLE_ANOMALY: {
        en: 'Unusual load pattern — check transmission',
        de: 'Ungewöhnliches Lastmuster — Getriebe prüfen',
        ar: 'نمط حمل غير طبيعي — افحص ناقل الحركة'
      },
      COOLING_SYSTEM_WEAK: {
        en: 'Cooling system underperforming — check coolant and thermostat',
        de: 'Kühlsystem unterdimensioniert — Kühlmittel und Thermostat prüfen',
        ar: 'نظام التبريد ضعيف — افحص سائل التبريد والثرموستات'
      },
      HIGH_RPM_NO_SPEED: {
        en: 'Vehicle stationary at high RPM — check transmission or clutch',
        de: 'Fahrzeug steht bei hoher Drehzahl — Getriebe oder Kupplung prüfen',
        ar: 'السيارة واقفة بـ RPM عالٍ — افحص ناقل الحركة أو القابض'
      },
      ENGINE_STRESS: {
        en: 'Engine under heavy stress — ease off throttle',
        de: 'Motor unter starker Belastung — Gas wegnehmen',
        ar: 'المحرك تحت ضغط شديد — خفف الضغط على دواسة الوقود'
      }
    }

    return msg[alert.rule]?.[lang] ?? msg[alert.rule]?.['en'] ?? alert.message
  }

  // ─── تقرير كامل ───────────────────────────────────────────────────────────

  static buildReport(overallScore, pidResults, correlationAlerts, lang = 'en') {
    const risk        = AdvisorEngine.assessRisk(overallScore)
    const pidAdvices  = []
    const corrAdvices = []

    // توصيات PIDs
    for (const [name, result] of Object.entries(pidResults)) {
      const advice = AdvisorEngine.advisePID(
        name,
        result.status,
        result.trend,
        result.value
      )
      if (advice) {
        pidAdvices.push({
          pid:    name,
          advice: advice[lang] ?? advice.en
        })
      }
    }

    // توصيات Correlation
    for (const alert of correlationAlerts) {
      corrAdvices.push({
        rule:   alert.rule,
        advice: AdvisorEngine.adviseCorrelation(alert, lang)
      })
    }

    // الملخص العام
    const summary = {
      LOW:      { en: 'Vehicle operating normally',              de: 'Fahrzeug funktioniert normal',                 ar: 'السيارة تعمل بشكل طبيعي'         },
      MEDIUM:   { en: 'Some parameters need attention',         de: 'Einige Parameter benötigen Aufmerksamkeit',    ar: 'بعض المعاملات تحتاج انتباهاً'    },
      HIGH:     { en: 'Multiple issues detected — check soon',  de: 'Mehrere Probleme — bald prüfen',               ar: 'مشاكل متعددة — افحص قريباً'       },
      CRITICAL: { en: 'Critical issues — immediate attention',  de: 'Kritische Probleme — sofortige Aufmerksamkeit', ar: 'مشاكل حرجة — انتباه فوري'        }
    }

    return {
      risk,
      summary:    summary[risk.level]?.[lang] ?? summary[risk.level]?.en,
      pidAdvices,
      corrAdvices,
      hasAdvice:  pidAdvices.length > 0 || corrAdvices.length > 0
    }
  }
}
