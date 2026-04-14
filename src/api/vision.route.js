// vision.route.js
// كشف الأشياء: DETR للأصناف الأساسية + OWL-ViT للأصناف المخصصة
// JavaScript خالص، بدون Python

import express from "express"

const router = express.Router()

// ─── CUSTOM CATEGORIES (خارج COCO) ───────────────────────────────────────────
const CUSTOM_LABELS = {
  home: [
    "door handle", "light switch", "fire extinguisher",
    "door bell", "window blind", "radiator", "power outlet",
    "door lock", "staircase railing", "smoke detector"
  ],
  garden: [
    "flower pot", "garden hose", "garden fence",
    "watering can", "garden lamp", "garden gate",
    "outdoor bench", "plant pot", "flower bed"
  ],
  street: [
    "street lamp", "manhole cover", "crosswalk",
    "trash bin", "bus stop", "telephone booth",
    "fire hydrant post", "bicycle rack", "bollard",
    "construction barrier", "road cone"
  ],
  traffic_signs: [
    "speed limit sign", "no entry sign", "yield sign",
    "pedestrian crossing sign", "construction sign",
    "one way sign", "parking sign", "no parking sign",
    "road works sign", "danger sign"
  ],
  clothing: [
    "shirt", "pants", "dress", "jacket",
    "sneakers", "scarf", "gloves", "coat",
    "hoodie", "skirt", "boots", "sandals"
  ],
  food_items: [
    "bread loaf", "milk carton", "egg carton",
    "cereal box", "fruit basket", "shopping bag",
    "food package", "vegetable display", "bakery items"
  ],
  shop_signs: [
    "shop sign", "pharmacy sign", "restaurant sign",
    "bakery sign", "supermarket sign", "cafe sign",
    "store entrance", "shop window display", "price tag board"
  ],
  general_signs: [
    "warning sign", "exit sign", "no smoking sign",
    "information board", "safety sign", "emergency exit sign",
    "toilet sign", "disabled access sign", "opening hours sign"
  ]
}

// قائمة مسطحة لكل الأصناف المخصصة
const ALL_CUSTOM_LABELS = Object.values(CUSTOM_LABELS).flat()
// ─────────────────────────────────────────────────────────────────────────────

// نموذج DETR للكشف الأساسي (COCO 91 صنف)
let detector      = null
let detectorReady = false
let detectorError = null

// نموذج OWL-ViT للأصناف المخصصة
let owlvit      = null
let owlvitReady = false
let owlvitError = null

// نموذج VIT-GPT2 لوصف الصور (للبحث بصورة)
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

// تحميل النماذج عند بدء السيرفر
loadDetector()
loadOwlVit()
loadCaptioner()

// تحديد الـ zone
function getZone(box, imageWidth) {
  const cx     = (box.xmin !== undefined ? box.xmin : box.x) + (box.xmax !== undefined ? (box.xmax - box.xmin) : box.w) / 2
  const zoneW  = imageWidth / 3
  const margin = zoneW * 0.2
  if (cx < zoneW - margin) return "Left"
  if (cx > zoneW * 2 + margin) return "Right"
  return "Center"
}

// تقدير المسافة
function getDistance(box, imageWidth, imageHeight) {
  const w         = box.xmax !== undefined ? (box.xmax - box.xmin) : box.w
  const h         = box.ymax !== undefined ? (box.ymax - box.ymin) : box.h
  const area      = w * h
  const frameArea = imageWidth * imageHeight
  const ratio     = area / Math.max(frameArea, 1)
  if (ratio > 0.20)  return "very_close"
  if (ratio > 0.08)  return "close"
  if (ratio > 0.025) return "medium"
  return "far"
}

// تحويل صورة base64 إلى RawImage
async function toRawImage(image) {
  const { RawImage } = await import("@huggingface/transformers")
  const base64Data   = image.replace(/^data:image\/\w+;base64,/, "")
  const buffer       = Buffer.from(base64Data, "base64")
  return await RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" }))
}

// استخراج الكلمة الرئيسية من وصف الصورة
function extractMainObject(caption) {
  if (!caption) return ""
  const stopWords = [
    "a", "an", "the", "is", "are", "on", "in", "at", "of",
    "with", "there", "some", "two", "three", "many", "several",
    "standing", "sitting", "walking", "holding", "wearing",
    "large", "small", "and", "or", "near", "next", "front"
  ]
  const words  = caption.toLowerCase().split(/\s+/)
  const nouns  = words.filter(w => !stopWords.includes(w) && w.length > 2)
  return nouns.slice(0, 3).join(" ") || caption.split(" ").slice(0, 3).join(" ")
}

// ─── POST /api/vision ─────────────────────────────────────────────────────────
// كشف الأشياء: DETR + OWL-ViT معاً
router.post("/", async (req, res) => {
  if (!detectorReady && !owlvitReady) {
    return res.status(503).json({ error: "Models loading, please wait" })
  }

  const { image, width, height } = req.body
  if (!image) return res.status(400).json({ error: "image (base64) required" })

  const imageWidth  = width  || 640
  const imageHeight = height || 480
  const allObjects  = []

  try {
    const rawImage = await toRawImage(image)

    // 1. DETR - كشف الأصناف الأساسية
    if (detectorReady) {
      try {
        const detrResults = await detector(rawImage, { threshold: 0.4 })
        for (const item of detrResults) {
          const zone     = getZone(item.box, imageWidth)
          const distance = getDistance(item.box, imageWidth, imageHeight)
          allObjects.push({
            id:       allObjects.length + 1,
            label:    item.label,
            class:    item.label.toLowerCase(),
            score:    Math.round(item.score * 100),
            zone,
            distance,
            source:   "detr",
            box: {
              x: Math.round(item.box.xmin),
              y: Math.round(item.box.ymin),
              w: Math.round(item.box.xmax - item.box.xmin),
              h: Math.round(item.box.ymax - item.box.ymin)
            }
          })
        }
      } catch (e) {
        console.error("DETR error:", e.message)
      }
    }

    // 2. OWL-ViT - كشف الأصناف المخصصة
    if (owlvitReady) {
      try {
        const existingLabels = allObjects.map(o => o.class.toLowerCase())

        // نرسل فقط الأصناف غير الموجودة في DETR
        const labelsToSearch = ALL_CUSTOM_LABELS.filter(label =>
          !existingLabels.some(el => el.includes(label) || label.includes(el))
        )

        if (labelsToSearch.length > 0) {
          // OWL-ViT يبحث بدفعات لتجنب الثقل
          const BATCH = 20
          for (let i = 0; i < labelsToSearch.length; i += BATCH) {
            const batch   = labelsToSearch.slice(i, i + BATCH)
            const results = await owlvit(rawImage, batch, { threshold: 0.2 })

            for (const item of results) {
              const zone     = getZone(item.box, imageWidth)
              const distance = getDistance(item.box, imageWidth, imageHeight)
              allObjects.push({
                id:       allObjects.length + 1,
                label:    item.label,
                class:    item.label.toLowerCase(),
                score:    Math.round(item.score * 100),
                zone,
                distance,
                source:   "owlvit",
                box: {
                  x: Math.round(item.box.xmin),
                  y: Math.round(item.box.ymin),
                  w: Math.round(item.box.xmax - item.box.xmin),
                  h: Math.round(item.box.ymax - item.box.ymin)
                }
              })
            }
          }
        }
      } catch (e) {
        console.error("OWL-ViT error:", e.message)
      }
    }

    res.json({
      objects: allObjects,
      count:   allObjects.length,
      models:  {
        detr:   detectorReady,
        owlvit: owlvitReady
      }
    })

  } catch (e) {
    console.error("Vision error:", e.message)
    res.status(500).json({ error: "Detection failed", details: e.message })
  }
})

// ─── POST /api/vision/describe ────────────────────────────────────────────────
// وصف صورة مرفوعة للبحث عن أي شيء
router.post("/describe", async (req, res) => {
  if (!captionerReady) {
    if (captionerError) {
      return res.status(503).json({ error: "Captioner failed", details: captionerError })
    }
    return res.status(503).json({ error: "Captioner loading, please wait" })
  }

  const { image } = req.body
  if (!image) return res.status(400).json({ error: "image (base64) required" })

  try {
    const rawImage   = await toRawImage(image)
    const result     = await captioner(rawImage, { max_new_tokens: 50 })
    const caption    = result?.[0]?.generated_text || ""
    const mainObject = extractMainObject(caption)

    res.json({ caption, mainObject, model: "vit-gpt2-image-captioning" })

  } catch (e) {
    console.error("Captioner error:", e.message)
    res.status(500).json({ error: "Caption failed", details: e.message })
  }
})

// ─── GET /api/vision/status ───────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({
    detector:  { ready: detectorReady,  error: detectorError  || null, model: "detr-resnet-50" },
    owlvit:    { ready: owlvitReady,    error: owlvitError    || null, model: "owlvit-base-patch32" },
    captioner: { ready: captionerReady, error: captionerError || null, model: "vit-gpt2-image-captioning" },
    customCategories: Object.keys(CUSTOM_LABELS).length,
    customLabels:     ALL_CUSTOM_LABELS.length
  })
})

// ─── GET /api/vision/categories ──────────────────────────────────────────────
// قائمة كل الأصناف المخصصة
router.get("/categories", (_req, res) => {
  res.json(CUSTOM_LABELS)
})

export default router
