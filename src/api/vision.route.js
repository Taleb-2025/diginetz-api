// vision.route.js
// Search Engine: OWL-ViT + OCR + Image Match
// بدون كشف تلقائي - يشتغل فقط عند طلب المستخدم

import express from "express"

const router = express.Router()

// نموذج OWL-ViT للبحث بالكلمات
let owlvit      = null
let owlvitReady = false
let owlvitError = null

// نموذج OCR للقراءة
let ocrPipeline  = null
let ocrReady     = false
let ocrError     = null

async function loadOwlVit() {
  try {
    const { pipeline } = await import("@huggingface/transformers")
    owlvit      = await pipeline("zero-shot-object-detection", "Xenova/owlvit-base-patch32", { device: "cpu" })
    owlvitReady = true
    console.log("OWL-ViT ready")
  } catch (e) {
    owlvitError = e.message
    console.error("OWL-ViT failed:", e.message)
  }
}

async function loadOCR() {
  try {
    const { pipeline } = await import("@huggingface/transformers")
    ocrPipeline = await pipeline("image-to-text", "Xenova/trocr-small-printed", { device: "cpu" })
    ocrReady    = true
    console.log("OCR ready")
  } catch (e) {
    ocrError = e.message
    console.error("OCR failed:", e.message)
  }
}

// تحميل النماذج عند بدء السيرفر
loadOwlVit()
loadOCR()

// تحويل base64 إلى RawImage
async function toRawImage(image) {
  const { RawImage } = await import("@huggingface/transformers")
  const base64Data   = image.replace(/^data:image\/\w+;base64,/, "")
  const buffer       = Buffer.from(base64Data, "base64")
  return await RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" }))
}

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

// ─── POST /api/vision/search ──────────────────────────────────────────────────
// البحث بالكلمة - OWL-ViT يبحث عن الشيء في الكاميرا
router.post("/search", async (req, res) => {
  if (!owlvitReady) {
    return res.status(503).json({
      error: owlvitError ? "OWL-ViT failed: " + owlvitError : "OWL-ViT loading..."
    })
  }

  const { image, query, width, height } = req.body

  if (!image) return res.status(400).json({ error: "image required" })
  if (!query) return res.status(400).json({ error: "query required" })

  try {
    const rawImage    = await toRawImage(image)
    const imageWidth  = width  || 640
    const imageHeight = height || 480

    // OWL-ViT يبحث عن الكلمة في الصورة
    const queries = Array.isArray(query) ? query : [query]
    const results = await owlvit(rawImage, queries, { threshold: 0.15 })

    if (!results || results.length === 0) {
      return res.json({ found: false, query, objects: [] })
    }

    const objects = results.map((item, i) => ({
      id:       i + 1,
      label:    item.label,
      score:    Math.round(item.score * 100),
      zone:     getZone(item.box, imageWidth),
      distance: getDistance(item.box, imageWidth, imageHeight),
      box: {
        x: Math.round(item.box.xmin),
        y: Math.round(item.box.ymin),
        w: Math.round(item.box.xmax - item.box.xmin),
        h: Math.round(item.box.ymax - item.box.ymin)
      }
    }))

    res.json({ found: true, query, objects, count: objects.length })

  } catch (e) {
    console.error("Search error:", e.message)
    res.status(500).json({ error: "Search failed", details: e.message })
  }
})

// ─── POST /api/vision/match ───────────────────────────────────────────────────
// مقارنة صورة مرجع مع الكاميرا
// يستخدم OWL-ViT مع وصف مستخرج من الصورة المرجعية
router.post("/match", async (req, res) => {
  if (!owlvitReady) {
    return res.status(503).json({ error: "OWL-ViT loading..." })
  }

  const { referenceImage, cameraImage, label, width, height } = req.body

  if (!cameraImage) return res.status(400).json({ error: "cameraImage required" })
  if (!label)       return res.status(400).json({ error: "label required" })

  try {
    const rawCamera   = await toRawImage(cameraImage)
    const imageWidth  = width  || 640
    const imageHeight = height || 480

    // نبحث عن الـ label في الكاميرا
    const results = await owlvit(rawCamera, [label], { threshold: 0.15 })

    if (!results || results.length === 0) {
      return res.json({ matched: false, label, objects: [] })
    }

    // الأعلى ثقة هو الأفضل
    const best = results.sort((a, b) => b.score - a.score)[0]

    res.json({
      matched:  true,
      label,
      score:    Math.round(best.score * 100),
      zone:     getZone(best.box, imageWidth),
      distance: getDistance(best.box, imageWidth, imageHeight),
      box: {
        x: Math.round(best.box.xmin),
        y: Math.round(best.box.ymin),
        w: Math.round(best.box.xmax - best.box.xmin),
        h: Math.round(best.box.ymax - best.box.ymin)
      }
    })

  } catch (e) {
    console.error("Match error:", e.message)
    res.status(500).json({ error: "Match failed", details: e.message })
  }
})

// ─── POST /api/vision/ocr ─────────────────────────────────────────────────────
// قراءة النص من الكاميرا
router.post("/ocr", async (req, res) => {
  if (!ocrReady) {
    return res.status(503).json({
      error: ocrError ? "OCR failed: " + ocrError : "OCR loading..."
    })
  }

  const { image, query } = req.body
  if (!image) return res.status(400).json({ error: "image required" })

  try {
    const rawImage = await toRawImage(image)
    const result   = await ocrPipeline(rawImage)
    const text     = (result?.[0]?.generated_text || "").trim()

    // لو فيه query → ابحث عنه في النص
    if (query) {
      const found = text.toLowerCase().includes(query.toLowerCase())
      return res.json({ text, query, found })
    }

    res.json({ text, found: text.length > 0 })

  } catch (e) {
    console.error("OCR error:", e.message)
    res.status(500).json({ error: "OCR failed", details: e.message })
  }
})

// ─── GET /api/vision/status ───────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({
    owlvit:    { ready: owlvitReady, error: owlvitError  || null, model: "owlvit-base-patch32" },
    ocr:       { ready: ocrReady,    error: ocrError     || null, model: "trocr-small-printed" }
  })
})

export default router
