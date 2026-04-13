// vision.route.js
// كشف الأشياء على السيرفر بـ Transformers.js
// 1000+ صنف، JavaScript خالص، بدون Python

import express from "express"

const router = express.Router()

// تحميل النموذج مرة واحدة عند بدء السيرفر
let pipeline = null
let modelReady = false
let modelError = null

async function loadModel() {
  try {
    const { pipeline: createPipeline } = await import("@huggingface/transformers")

    pipeline = await createPipeline(
      "object-detection",
      "Xenova/detr-resnet-50",
      { device: "cpu" }
    )

    modelReady = true
    console.log("Vision model ready")
  } catch (e) {
    modelError = e.message
    console.error("Vision model failed:", e.message)
  }
}

// تحميل النموذج عند بدء السيرفر
loadModel()

// تحديد الـ zone بناءً على موقع الكائن
function getZone(box, imageWidth) {
  const cx = box.xmin + (box.xmax - box.xmin) / 2
  const zoneW = imageWidth / 3
  const margin = zoneW * 0.2
  if (cx < zoneW - margin) return "Left"
  if (cx > zoneW * 2 + margin) return "Right"
  return "Center"
}

// تقدير المسافة بناءً على حجم الكائن
function getDistance(box, imageWidth, imageHeight) {
  const w = box.xmax - box.xmin
  const h = box.ymax - box.ymin
  const area = w * h
  const frameArea = imageWidth * imageHeight
  const ratio = area / Math.max(frameArea, 1)
  if (ratio > 0.20) return "very_close"
  if (ratio > 0.08) return "close"
  if (ratio > 0.025) return "medium"
  return "far"
}

// POST /api/vision
// يستقبل صورة base64 ويرجع قائمة الأشياء المكتشفة
router.post("/", async (req, res) => {
  if (!modelReady) {
    if (modelError) {
      return res.status(503).json({
        error: "Model failed to load",
        details: modelError
      })
    }
    return res.status(503).json({ error: "Model loading, please wait" })
  }

  const { image, width, height } = req.body

  if (!image) {
    return res.status(400).json({ error: "image (base64) required" })
  }

  try {
    // تحويل base64 إلى buffer
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "")
    const buffer = Buffer.from(base64Data, "base64")

    // تشغيل الكشف
    const results = await pipeline(buffer, { threshold: 0.4 })

    const imageWidth  = width  || 640
    const imageHeight = height || 480

    // تحويل النتائج إلى format موحد
    const objects = results.map((item, index) => {
      const zone     = getZone(item.box, imageWidth)
      const distance = getDistance(item.box, imageWidth, imageHeight)

      return {
        id:         index + 1,
        label:      item.label,
        class:      item.label.toLowerCase(),
        score:      Math.round(item.score * 100),
        zone,
        distance,
        box: {
          x: Math.round(item.box.xmin),
          y: Math.round(item.box.ymin),
          w: Math.round(item.box.xmax - item.box.xmin),
          h: Math.round(item.box.ymax - item.box.ymin)
        }
      }
    })

    res.json({
      objects,
      count: objects.length,
      model: "detr-resnet-50"
    })

  } catch (e) {
    console.error("Vision error:", e.message)
    res.status(500).json({ error: "Detection failed", details: e.message })
  }
})

// GET /api/vision/status
router.get("/status", (_req, res) => {
  res.json({
    ready: modelReady,
    error: modelError || null,
    model: "detr-resnet-50",
    categories: "91 COCO + extended"
  })
})

export default router
