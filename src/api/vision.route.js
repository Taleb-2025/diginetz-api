// vision.route.js
// كشف الأشياء + وصف الصور بـ Transformers.js
// JavaScript خالص، بدون Python

import express from "express"

const router = express.Router()

// نموذج كشف الأشياء
let detector     = null
let detectorReady = false
let detectorError = null

// نموذج وصف الصور (BLIP)
let captioner      = null
let captionerReady = false
let captionerError = null

async function loadDetector() {
  try {
    const { pipeline } = await import("@huggingface/transformers")
    detector      = await pipeline("object-detection", "Xenova/detr-resnet-50", { device: "cpu" })
    detectorReady = true
    console.log("Detector ready")
  } catch (e) {
    detectorError = e.message
    console.error("Detector failed:", e.message)
  }
}

async function loadCaptioner() {
  try {
    const { pipeline } = await import("@huggingface/transformers")
    captioner      = await pipeline("image-to-text", "Xenova/blip-image-captioning-base", { device: "cpu" })
    captionerReady = true
    console.log("Captioner ready")
  } catch (e) {
    captionerError = e.message
    console.error("Captioner failed:", e.message)
  }
}

// تحميل النموذجين عند بدء السيرفر
loadDetector()
loadCaptioner()

// تحديد الـ zone
function getZone(box, imageWidth) {
  const cx     = box.xmin + (box.xmax - box.xmin) / 2
  const zoneW  = imageWidth / 3
  const margin = zoneW * 0.2
  if (cx < zoneW - margin) return "Left"
  if (cx > zoneW * 2 + margin) return "Right"
  return "Center"
}

// تقدير المسافة
function getDistance(box, imageWidth, imageHeight) {
  const w         = box.xmax - box.xmin
  const h         = box.ymax - box.ymin
  const area      = w * h
  const frameArea = imageWidth * imageHeight
  const ratio     = area / Math.max(frameArea, 1)
  if (ratio > 0.20)  return "very_close"
  if (ratio > 0.08)  return "close"
  if (ratio > 0.025) return "medium"
  return "far"
}

// استخراج الكلمة الرئيسية من وصف BLIP
function extractMainObject(caption) {
  if (!caption) return ""

  // إزالة كلمات شائعة غير مفيدة
  const stopWords = ["a", "an", "the", "is", "are", "on", "in", "at", "of",
                     "with", "there", "some", "two", "three", "many", "several",
                     "standing", "sitting", "walking", "holding", "wearing",
                     "large", "small", "red", "blue", "green", "white", "black",
                     "and", "or", "near", "next", "front", "back", "side"]

  const words = caption.toLowerCase().split(/\s+/)

  // ابحث عن اسم جوهري (noun)
  const nouns = words.filter(w => !stopWords.includes(w) && w.length > 2)

  // أول اسم جوهري هو الشيء الرئيسي
  return nouns[0] || caption.split(" ").slice(0, 3).join(" ")
}

// ─── POST /api/vision ─────────────────────────────────────────────────────────
// كشف الأشياء في الكاميرا
router.post("/", async (req, res) => {
  if (!detectorReady) {
    if (detectorError) {
      return res.status(503).json({ error: "Detector failed", details: detectorError })
    }
    return res.status(503).json({ error: "Detector loading, please wait" })
  }

  const { image, width, height } = req.body

  if (!image) {
    return res.status(400).json({ error: "image (base64) required" })
  }

  try {
    // تحويل base64 إلى RawImage
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "")
    const buffer     = Buffer.from(base64Data, "base64")
    const { RawImage } = await import("@huggingface/transformers")
    const rawImage   = await RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" }))
    const results    = await detector(rawImage, { threshold: 0.4 })
    const imageWidth  = width  || 640
    const imageHeight = height || 480

    const objects = results.map((item, index) => {
      const zone     = getZone(item.box, imageWidth)
      const distance = getDistance(item.box, imageWidth, imageHeight)
      return {
        id:       index + 1,
        label:    item.label,
        class:    item.label.toLowerCase(),
        score:    Math.round(item.score * 100),
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

    res.json({ objects, count: objects.length, model: "detr-resnet-50" })

  } catch (e) {
    console.error("Vision error:", e.message)
    res.status(500).json({ error: "Detection failed", details: e.message })
  }
})

// ─── POST /api/vision/describe ────────────────────────────────────────────────
// وصف صورة مرفوعة من المستخدم للبحث عن أي شيء
router.post("/describe", async (req, res) => {
  if (!captionerReady) {
    if (captionerError) {
      return res.status(503).json({ error: "Captioner failed", details: captionerError })
    }
    return res.status(503).json({ error: "Captioner loading, please wait" })
  }

  const { image } = req.body

  if (!image) {
    return res.status(400).json({ error: "image (base64) required" })
  }

  try {
    // تحويل base64 إلى RawImage
    const base64Data2 = image.replace(/^data:image\/\w+;base64,/, "")
    const buffer2     = Buffer.from(base64Data2, "base64")
    const { RawImage: RI } = await import("@huggingface/transformers")
    const rawImage2   = await RI.fromBlob(new Blob([buffer2], { type: "image/jpeg" }))
    const result      = await captioner(rawImage2, { max_new_tokens: 50 })
    const caption   = result?.[0]?.generated_text || ""
    const mainObject = extractMainObject(caption)

    res.json({
      caption,
      mainObject,
      model: "blip-image-captioning-base"
    })

  } catch (e) {
    console.error("Captioner error:", e.message)
    res.status(500).json({ error: "Caption failed", details: e.message })
  }
})

// ─── GET /api/vision/status ───────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({
    detector:  { ready: detectorReady,  error: detectorError  || null, model: "detr-resnet-50" },
    captioner: { ready: captionerReady, error: captionerError || null, model: "blip-image-captioning-base" }
  })
})

export default router
