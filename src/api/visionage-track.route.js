import express from "express"
import { VisionageTrackEngine } from "../engines/visionage-track.engine.js"

const router = express.Router()
const tracker = new VisionageTrackEngine()

router.post("/update", (req, res) => {
const { centerX, frameWidth, label, score, distance } = req.body

if (!Number.isFinite(Number(centerX)) || !Number.isFinite(Number(frameWidth))) {
return res.status(400).json({ error: "centerX and frameWidth required" })
}

const result = tracker.update(Number(centerX), Number(frameWidth))

let level = "clear"
if (distance === "VERY CLOSE") level = "critical"
else if (distance === "CLOSE")  level = "warning"
else if (distance === "MEDIUM") level = "notice"

res.json({
...result,
label:    label    ?? null,
score:    score    ?? null,
distance: distance ?? null,
level
})
})

router.post("/reset", (_req, res) => {
res.json(tracker.reset())
})

router.get("/state", (_req, res) => {
res.json({
angle: tracker.engine.getState(),
cycle: tracker.engine.getCycle()
})
})

export default router
