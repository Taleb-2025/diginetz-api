import express from "express"
import { VisionageEngine } from "../engines/visionage.engine.js"

const router = express.Router()
const vision = new VisionageEngine()

const objectHistory = new Map()

function updateTemporalHistory(objects) {
  const now = Date.now()

  for (const obj of objects) {
    if (!objectHistory.has(obj.id)) {
      objectHistory.set(obj.id, [])
    }

    const arr = objectHistory.get(obj.id)
    arr.push({
      cx: obj.cx,
      cy: obj.cy,
      distance: obj.distance,
      t: now
    })

    if (arr.length > 6) arr.shift()
  }
}

function isApproaching(id) {
  const arr = objectHistory.get(id)
  if (!arr || arr.length < 2) return false

  const rank = { far: 1, medium: 2, close: 3, very_close: 4 }
  const last = arr[arr.length - 1]
  const prev = arr[arr.length - 2]

  return (rank[last.distance] ?? 0) > (rank[prev.distance] ?? 0)
}

router.post("/", (req, res) => {
  if (!req.body || typeof req.body.angle !== "number") {
    return res.status(400).json({ error: "angle required" })
  }

  const { angle } = req.body
  const objects = Array.isArray(req.body.objects) ? req.body.objects : []

  updateTemporalHistory(objects)

  const result = vision.update(angle)

  const absVelocity = Math.abs(result.velocity ?? 0)
  const absStep = Math.abs(result.step ?? 0)

  let level = "clear"
  let message = "مراقبة نشطة"
  let danger = false

  const centerObjects = objects.filter(o => o.zone === "Center")
  const closeCenterObjects = centerObjects.filter(
    o => o.distance === "close" || o.distance === "very_close"
  )

  const personAhead = closeCenterObjects.find(o => o.class === "person")
  const approachingObject = closeCenterObjects.find(o => isApproaching(o.id))
  const anyMediumAhead = centerObjects.find(
    o => o.distance === "medium" || o.distance === "close" || o.distance === "very_close"
  )

  if (personAhead && isApproaching(personAhead.id)) {
    level = "critical"
    message = "شخص يقترب أمامك — توقف"
    danger = true
  } else if (personAhead) {
    level = "critical"
    message = "شخص أمامك — توقف"
    danger = true
  } else if (approachingObject) {
    level = "critical"
    message = "جسم يقترب أمامك — توقف"
    danger = true
  } else if (closeCenterObjects.length > 0) {
    level = "warning"
    message = "جسم قريب أمامك — انتبه"
    danger = false
  } else if (anyMediumAhead) {
    level = "notice"
    message = "جسم أمامك"
    danger = false
  } else if (objects.length > 0) {
    level = "notice"
    message = "جسم في المحيط"
    danger = false
  }

  if (!danger) {
    if (absVelocity > 0.4 || absStep > 90) {
      level = "critical"
      message = "حركة حادة — توقف"
      danger = true
    } else if (absVelocity > 0.2 || absStep > 45) {
      level = level === "clear" ? "warning" : level
      message = level === "warning" ? "حركة سريعة — انتبه" : message
    }
  }

  res.json({
    ...result,
    level,
    message,
    danger,
    angle: result.state,
    objectsCount: objects.length
  })
})

export default router
