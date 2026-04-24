// cam.security.route.js
// Visionage Security Cam - Smart Analysis
// CyclicDynamicsEngine + CyclicAnalyzer

import express from "express"
import { CyclicDynamicsEngine } from "../engines/CyclicDynamicsEngine.js"
import { CyclicAnalyzer }       from "../engines/CyclicAnalyzer.js"

const router = express.Router()

// محرك PTZ - يتتبع زاوية الكاميرا
const ptzEngine = new CyclicDynamicsEngine({
  cycle:       360,
  step:        5,
  maxVelocity: 180,
  maxHistory:  500
})

// محلل السلوك - يكتشف الشذوذ ويتنبأ
const analyzer = new CyclicAnalyzer(ptzEngine, {
  historyWindow:    30,
  baseThreshold:    15,
  trendBufferSize:  6,
  scoreHistorySize: 20,
  intervalMs:       1000
})

// تتبع الأجسام المكتشفة
const objectTracker = new Map()  // id → { firstSeen, lastSeen, zone, label }

// ─── POST /api/security/analyze ───────────────────────────────────────────────
// يستقبل زاوية الكاميرا + الأجسام المكتشفة → يحلل السلوك
router.post("/analyze", (req, res) => {
  const { angle, objects } = req.body

  if (typeof angle !== "number") {
    return res.status(400).json({ error: "angle required" })
  }

  const now     = Date.now()
  const items   = Array.isArray(objects) ? objects : []

  // 1. CyclicDynamicsEngine - تحليل حركة الكاميرا
  const motion  = ptzEngine.transitionTo(angle, { mode: "shortest" })

  // 2. CyclicAnalyzer - تحليل السلوك
  const analysis = analyzer.analyze(angle)

  // 3. تتبع الأجسام وقياس المدة
  const alerts = []

  for (const obj of items) {
    const key = obj.id || (obj.label + "_" + obj.zone)

    if (!objectTracker.has(key)) {
      objectTracker.set(key, {
        firstSeen: now,
        lastSeen:  now,
        zone:      obj.zone,
        label:     obj.label || obj.class || "object"
      })
    } else {
      const tracked  = objectTracker.get(key)
      tracked.lastSeen = now
      const duration = (now - tracked.firstSeen) / 1000  // بالثوان

      // تنبيه: شخص عند الباب أكثر من 20 ثانية
      if (duration > 20 && obj.zone === "Center") {
        alerts.push({
          type:     "LOITERING",
          label:    tracked.label,
          zone:     tracked.zone,
          duration: Math.round(duration) + "s",
          severity: duration > 60 ? "CRITICAL" : "WARNING"
        })
      }

      // تنبيه: جسم يقترب باستمرار
      if (obj.distance === "very_close" && duration > 5) {
        alerts.push({
          type:     "APPROACHING",
          label:    tracked.label,
          zone:     tracked.zone,
          duration: Math.round(duration) + "s",
          severity: "WARNING"
        })
      }
    }
  }

  // تنظيف الأجسام التي اختفت (أكثر من 10 ثوان)
  for (const [key, tracked] of objectTracker.entries()) {
    if (now - tracked.lastSeen > 10000) objectTracker.delete(key)
  }

  // 4. حساب حركة PTZ المقترحة
  const ptzCommand = computePTZCommand(analysis, items, motion)

  res.json({
    // حالة المحرك
    angle:    ptzEngine.getState(),
    velocity: Math.abs(motion.velocity || 0),

    // تحليل السلوك
    status:   analysis.status,
    health:   analysis.health,
    severity: analysis.severity,
    trend:    analysis.trend,
    forecast: analysis.forecast,

    // تنبيهات السلوك
    alerts,

    // أمر PTZ مقترح
    ptzCommand,

    // تفسير
    explain: analysis.explain
  })
})

// ─── POST /api/security/learn ─────────────────────────────────────────────────
// تعليم النظام النمط الطبيعي للكاميرا
router.post("/learn", (req, res) => {
  const { angles } = req.body

  if (!Array.isArray(angles) || angles.length < 5) {
    return res.status(400).json({ error: "angles array required (min 5)" })
  }

  analyzer.learnPattern(angles)

  res.json({
    ok:      true,
    learned: angles.length,
    message: "Pattern learned successfully"
  })
})

// ─── POST /api/security/recalibrate ──────────────────────────────────────────
router.post("/recalibrate", (_req, res) => {
  analyzer.recalibrate()
  ptzEngine.reset(0)
  objectTracker.clear()
  res.json({ ok: true, message: "System recalibrated" })
})

// ─── GET /api/security/status ─────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  const severity = analyzer.getSeverity()
  res.json({
    engine:        "CyclicDynamicsEngine + CyclicAnalyzer",
    angle:         ptzEngine.getState(),
    historySize:   ptzEngine.getHistory().length,
    trackedObjects: objectTracker.size,
    severity:      severity.severity,
    trend:         severity.trend,
    ready:         severity.ready
  })
})

// ─── HELPER: حساب أمر PTZ ────────────────────────────────────────────────────
function computePTZCommand(analysis, objects, motion) {
  // لو السلوك خطر → اثبت الكاميرا
  if (analysis.status === "CRITICAL") {
    return { action: "STOP", reason: "Critical behavior detected" }
  }

  // لو فيه جسم في المنتصف → تتبعه
  const centerObj = objects.find(o => o.zone === "Center")
  if (centerObj) {
    return { action: "TRACK", target: centerObj.label, zone: "Center" }
  }

  // لو فيه جسم على اليسار → تحرك يساراً
  const leftObj = objects.find(o => o.zone === "Left")
  if (leftObj) {
    return { action: "PAN", direction: "left", target: leftObj.label }
  }

  // لو فيه جسم على اليمين → تحرك يميناً
  const rightObj = objects.find(o => o.zone === "Right")
  if (rightObj) {
    return { action: "PAN", direction: "right", target: rightObj.label }
  }

  // لو لا شيء → استمر في المسح
  return { action: "SCAN", reason: "No target detected" }
}

export default router
