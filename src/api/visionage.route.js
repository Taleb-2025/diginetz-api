import express from "express"
import { VisionageEngine } from "../engines/visionage.engine.js"

const router = express.Router()
const vision = new VisionageEngine()

router.post("/visionage", (req, res) => {

  const { angle } = req.body

  if (typeof angle !== "number") {
    return res.status(400).json({ error: "angle required" })
  }

  const result = vision.update(angle)

  res.json(result)
})

export default router
