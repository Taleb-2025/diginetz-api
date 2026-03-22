import express from "express"
import { VisionageEngine } from "../engines/visionage.engine.js"

const router = express.Router()
const vision = new VisionageEngine()

router.post("/", (req, res) => {

  if (!req.body || typeof req.body.angle !== "number") {
    return res.status(400).json({ error: "angle required" })
  }

  const { angle } = req.body

  const result = vision.update(angle)

  const absVelocity = Math.abs(result.velocity ?? 0)
  const absStep     = Math.abs(result.step ?? 0)

  let level, message, danger

  if (absVelocity > 0.4 || absStep > 90) {
    level   = "critical"
    message = "عائق أمامك — توقف"
    danger  = true
  } else if (absVelocity > 0.2 || absStep > 45) {
    level   = "warning"
    message = "جسم أمامك — انتبه"
    danger  = false
  } else if (absStep > 10) {
    level   = "notice"
    message = "جسم بعيد"
    danger  = false
  } else {
    level   = "clear"
    message = "مراقبة نشطة"
    danger  = false
  }

  res.json({
    ...result,
    level,
    message,
    danger,
    angle: result.state
  })

})

export default router
