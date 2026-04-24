// camera.route.js
// Tapo C52A - Cloud API Integration
// التحكم بالكاميرا عبر Tapo Cloud

import express from "express"
import https from "https"
import crypto from "crypto"

const router = express.Router()

// Tapo Cloud credentials - من Environment Variables
const TAPO_EMAIL    = process.env.TAPO_EMAIL    || "Bental.herne@gmail.com"
const TAPO_PASSWORD = process.env.TAPO_PASSWORD || "Visionage2026!!"
const CAMERA_IP     = process.env.CAMERA_IP     || "192.168.178.135"

// Tapo Cloud API
const TAPO_CLOUD_URL = "https://wap.tplinkcloud.com"

let cloudToken   = null
let deviceId     = null
let sessionReady = false
let sessionError = null

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function tapocloudRequest(url, body) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body)
    const options = {
      method:  "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    }

    const urlObj = new URL(url)
    options.hostname = urlObj.hostname
    options.path     = urlObj.pathname + urlObj.search
    options.port     = 443

    const req = https.request(options, (res) => {
      let raw = ""
      res.on("data", chunk => { raw += chunk })
      res.on("end", () => {
        try { resolve(JSON.parse(raw)) }
        catch (e) { reject(new Error("Parse error: " + raw)) }
      })
    })

    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

async function login() {
  try {
    const res = await tapocloudRequest(TAPO_CLOUD_URL, {
      method:          "login",
      params: {
        appType:         "Tapo_Ios",
        cloudPassword:   TAPO_PASSWORD,
        cloudUserName:   TAPO_EMAIL,
        terminalUUID:    crypto.randomUUID()
      }
    })

    if (res.error_code !== 0) throw new Error("Login failed: " + JSON.stringify(res))

    cloudToken = res.result.token
    console.log("Tapo Cloud login OK")
    return cloudToken

  } catch (e) {
    sessionError = e.message
    console.error("Tapo login error:", e.message)
    throw e
  }
}

async function getDeviceList() {
  if (!cloudToken) await login()

  const res = await tapocloudRequest(TAPO_CLOUD_URL + "?token=" + cloudToken, {
    method: "getDeviceList",
    params: {}
  })

  if (res.error_code !== 0) throw new Error("getDeviceList failed")

  const devices = res.result.deviceList || []
  console.log("Devices found:", devices.length)

  // ابحث عن C52A
  const cam = devices.find(d =>
    d.deviceModel && d.deviceModel.toUpperCase().includes("C52A")
  ) || devices[0]

  if (cam) {
    deviceId = cam.deviceId
    console.log("Camera found:", cam.alias, cam.deviceModel)
  }

  return devices
}

async function sendCameraCommand(method, params) {
  if (!cloudToken) await login()
  if (!deviceId)   await getDeviceList()

  const res = await tapocloudRequest(TAPO_CLOUD_URL + "?token=" + cloudToken, {
    method:   "passthrough",
    params: {
      deviceId,
      requestData: JSON.stringify({
        method,
        params: params || {}
      })
    }
  })

  if (res.error_code !== 0) throw new Error("Command failed: " + JSON.stringify(res))

  try {
    return JSON.parse(res.result.responseData)
  } catch (e) {
    return res.result
  }
}

// بدء الجلسة عند تشغيل السيرفر
async function initSession() {
  try {
    await login()
    await getDeviceList()
    sessionReady = true
    console.log("Camera session ready")
  } catch (e) {
    sessionError = e.message
    console.error("Camera session failed:", e.message)
  }
}

initSession()

// ─── GET /api/camera/status ───────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({
    ready:     sessionReady,
    error:     sessionError || null,
    deviceId:  deviceId    || null,
    model:     "Tapo C52A"
  })
})

// ─── GET /api/camera/frame ────────────────────────────────────────────────────
// جلب معلومات الكاميرا (Snapshot غير متاح عبر Cloud API)
router.get("/frame", async (req, res) => {
  if (!sessionReady) {
    return res.status(503).json({ error: "Camera not ready" })
  }

  try {
    // جلب حالة الكاميرا الحالية
    const result = await sendCameraCommand("getDeviceInfo", {})
    res.json({
      ok:          true,
      online:      true,
      model:       "Tapo C52A",
      imageBase64: null,
      note:        "Direct snapshot requires local network access",
      deviceInfo:  result
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/camera/snapshot ────────────────────────────────────────────────
// محاولة جلب snapshot عبر HTTP محلي (يشتغل فقط على نفس الشبكة)
router.post("/snapshot", async (req, res) => {
  try {
    const snapUrl = "http://" + CAMERA_IP + "/stream/snap.jpg"
    const https   = await import("http")
    const snap    = await new Promise((resolve, reject) => {
      const req2 = https.get(snapUrl, (r) => {
        const chunks = []
        r.on("data", c => chunks.push(c))
        r.on("end",  () => resolve(Buffer.concat(chunks)))
        r.on("error", reject)
      })
      req2.on("error", reject)
      req2.setTimeout(3000, () => { req2.destroy(); reject(new Error("timeout")) })
    })
    const b64 = snap.toString("base64")
    res.json({ ok: true, imageBase64: b64 })
  } catch (e) {
    res.status(500).json({ error: "Snapshot failed - camera may not be on same network", details: e.message })
  }
})

// ─── POST /api/camera/pan ─────────────────────────────────────────────────────
// تحريك الكاميرا يمين/يسار
// angle: درجة التحريك (موجب = يمين، سالب = يسار)
router.post("/pan", async (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: "Camera not ready" })

  const { angle } = req.body
  if (typeof angle !== "number") return res.status(400).json({ error: "angle required" })

  try {
    // Tapo PTZ commands
    const speed  = Math.min(Math.abs(angle), 100)
    const dir    = angle > 0 ? "right" : "left"
    let result
    try {
      result = await sendCameraCommand("motorMove", { x_speed: angle > 0 ? speed : -speed, y_speed: 0 })
    } catch (e1) {
      try {
        result = await sendCameraCommand("move", { direction: dir, speed })
      } catch (e2) {
        result = { tried: ["motorMove", "move"], error: e2.message }
      }
    }
    res.json({ ok: true, angle, direction: dir, result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/camera/tilt ────────────────────────────────────────────────────
// تحريك الكاميرا أعلى/أسفل
router.post("/tilt", async (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: "Camera not ready" })

  const { angle } = req.body
  if (typeof angle !== "number") return res.status(400).json({ error: "angle required" })

  try {
    const result = await sendCameraCommand("motorMove", {
      x_speed: 0,
      y_speed: Math.sign(angle) * Math.min(Math.abs(angle), 100)
    })
    res.json({ ok: true, angle, result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/camera/goto ────────────────────────────────────────────────────
// تحريك الكاميرا لزاوية محددة
router.post("/goto", async (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: "Camera not ready" })

  const { x, y } = req.body

  try {
    const result = await sendCameraCommand("motorMoveToPreset", {
      id: 0,
      x:  x || 0,
      y:  y || 0
    })
    res.json({ ok: true, x, y, result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/camera/scan ────────────────────────────────────────────────────
// مسح 360° كامل
router.post("/scan", async (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: "Camera not ready" })

  try {
    // تشغيل وضع Patrol (مسح تلقائي)
    const result = await sendCameraCommand("startPatrol", {})
    res.json({ ok: true, scanning: true, result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/camera/stop ────────────────────────────────────────────────────
router.post("/stop", async (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: "Camera not ready" })

  try {
    const result = await sendCameraCommand("motorStop", {})
    res.json({ ok: true, result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/camera/search ─────────────────────────────────────────────────
// بحث ذكي: تدور الكاميرا + OWL-ViT يبحث في كل frame
// هذا يستدعي /api/vision/search داخلياً
router.post("/search", async (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: "Camera not ready" })

  const { query } = req.body
  if (!query) return res.status(400).json({ error: "query required" })

  res.json({
    ok:      true,
    query,
    message: "Smart search started - camera will scan 360",
    note:    "Implement frame capture + OWL-ViT search loop"
  })
})

// ─── POST /api/camera/preset ─────────────────────────────────────────────────
// حفظ موضع الكاميرا الحالي
router.post("/preset", async (req, res) => {
  if (!sessionReady) return res.status(503).json({ error: "Camera not ready" })

  const { id, name } = req.body

  try {
    const result = await sendCameraCommand("setPresetPoint", {
      id:   id   || 1,
      name: name || "preset_" + (id || 1)
    })
    res.json({ ok: true, id, name, result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
