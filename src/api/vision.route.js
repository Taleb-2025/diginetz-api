// vision.route.js
// Search Engine: OWL-ViT + OCR + Captioner
// بدون كشف تلقائي

import express from "express"

const router = express.Router()

// OWL-ViT للبحث بالكلمات
let owlvit      = null
let owlvitReady = false
let owlvitError = null

// CLIP للمقارنة البصرية
let clipModel      = null
let clipReady      = false
let clipError      = null

// OCR لقراءة النصوص
let ocrPipeline = null
let ocrReady    = false
let ocrError    = null

// Captioner لوصف الصور (VIT-GPT2)
let captioner      = null
let captionerReady = false
let captionerError = null

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

async function loadCaptioner() {
  try {
    const { pipeline } = await import("@huggingface/transformers")
    captioner      = await pipeline("image-to-text", "Xenova/vit-gpt2-image-captioning", { device: "cpu" })
    captionerReady = true
    console.log("Captioner ready")
  } catch (e) {
    captionerError = e.message
    console.error("Captioner failed:", e.message)
  }
}

loadOwlVit()
loadOCR()
loadCaptioner()
loadClip()

async function loadClip() {
  try {
    const { AutoProcessor, CLIPVisionModelWithProjection, RawImage } = await import("@huggingface/transformers")
    clipModel = {
      processor: await AutoProcessor.from_pretrained("Xenova/clip-vit-base-patch32"),
      model:     await CLIPVisionModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32")
    }
    clipReady = true
    console.log("CLIP ready")
  } catch (e) {
    clipError = e.message
    console.error("CLIP failed:", e.message)
  }
}

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
// OWL-ViT يبحث عن كلمة في الكاميرا
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
    const queries     = Array.isArray(query) ? query : [query]
    const results     = await owlvit(rawImage, queries, { threshold: 0.15 })

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

// ─── POST /api/vision/describe ────────────────────────────────────────────────
// يصف الصورة تلقائياً + OCR
// يُستخدم عند رفع صورة مرجع بدون كتابة
router.post("/describe", async (req, res) => {
  const { image } = req.body
  if (!image) return res.status(400).json({ error: "image required" })

  try {
    const rawImage = await toRawImage(image)
    let text       = ""
    let caption    = ""

    // 1. جرب OCR أولاً
    if (ocrReady) {
      try {
        const ocrResult = await ocrPipeline(rawImage)
        text = (ocrResult?.[0]?.generated_text || "").trim()
      } catch (e) {}
    }

    // 2. لو ما فيه نص → صف الصورة بـ Captioner
    if ((!text || text.length < 3) && captionerReady) {
      try {
        const capResult = await captioner(rawImage, { max_new_tokens: 30 })
        caption = (capResult?.[0]?.generated_text || "").trim()
      } catch (e) {}
    }

    // الأولوية: OCR ثم Caption
    const result = text.length > 2 ? text : caption

    res.json({
      text,
      caption,
      result,
      source: text.length > 2 ? "ocr" : "caption"
    })

  } catch (e) {
    console.error("Describe error:", e.message)
    res.status(500).json({ error: "Describe failed", details: e.message })
  }
})

// ─── POST /api/vision/ocr ─────────────────────────────────────────────────────
// قراءة النص من الكاميرا (Smart OCR)
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

// ─── POST /api/vision/match-visual ───────────────────────────────────────────
// CLIP يقارن صورة مرجع مع frame الكاميرا بصرياً
router.post("/match-visual", async (req, res) => {
  if (!clipReady) {
    return res.status(503).json({
      error: clipError ? "CLIP failed: " + clipError : "CLIP loading..."
    })
  }

  const { referenceImage, cameraImage } = req.body
  if (!referenceImage) return res.status(400).json({ error: "referenceImage required" })
  if (!cameraImage)    return res.status(400).json({ error: "cameraImage required" })

  try {
    const { RawImage } = await import("@huggingface/transformers")

    // تحويل الصورتين
    const refBase64  = referenceImage.replace(/^data:image\/\w+;base64,/, "")
    const camBase64  = cameraImage.replace(/^data:image\/\w+;base64,/, "")
    const refBuffer  = Buffer.from(refBase64, "base64")
    const camBuffer  = Buffer.from(camBase64, "base64")
    const refRaw     = await RawImage.fromBlob(new Blob([refBuffer], { type: "image/jpeg" }))
    const camRaw     = await RawImage.fromBlob(new Blob([camBuffer], { type: "image/jpeg" }))

    // استخرج features من الصورتين
    const refInputs  = await clipModel.processor(refRaw)
    const camInputs  = await clipModel.processor(camRaw)
    const refOutputs = await clipModel.model(refInputs)
    const camOutputs = await clipModel.model(camInputs)

    // احسب cosine similarity بين الـ features
    const refEmbed = refOutputs.image_embeds.data
    const camEmbed = camOutputs.image_embeds.data

    let dot = 0, refNorm = 0, camNorm = 0
    for (let i = 0; i < refEmbed.length; i++) {
      dot     += refEmbed[i] * camEmbed[i]
      refNorm += refEmbed[i] * refEmbed[i]
      camNorm += camEmbed[i] * camEmbed[i]
    }
    const similarity = dot / (Math.sqrt(refNorm) * Math.sqrt(camNorm))
    const score      = Math.round(similarity * 100)
    const matched    = similarity > 0.80

    res.json({ matched, score, similarity: similarity.toFixed(4) })

  } catch (e) {
    console.error("Match-visual error:", e.message)
    res.status(500).json({ error: "Match failed", details: e.message })
  }
})

// ─── GET /api/vision/status ───────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({
    owlvit:    { ready: owlvitReady,    error: owlvitError    || null, model: "owlvit-base-patch32" },
    ocr:       { ready: ocrReady,       error: ocrError       || null, model: "trocr-small-printed" },
    captioner: { ready: captionerReady, error: captionerError || null, model: "vit-gpt2-image-captioning" },
    clip:      { ready: clipReady,      error: clipError      || null, model: "clip-vit-base-patch32" }
  })
})

export default router
