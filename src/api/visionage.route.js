import express from “express”
import { VisionageEngine } from “../engines/visionage.engine.js”

const router = express.Router()
const vision = new VisionageEngine()

router.post(”/visionage”, (req, res) => {

const { angle } = req.body

if (typeof angle !== “number”) {
return res.status(400).json({ error: “angle required” })
}

const result = vision.update(angle)


const absVelocity = Math.abs(result.velocity ?? 0)
const absStep     = Math.abs(result.step ?? 0)

let level, message, danger

if (absVelocity > 0.4 || absStep > 90) {
level   = “critical”
message = 
danger  = true
} else if (absVelocity > 0.2 || absStep > 45) {
level   = “warning”
message = 
danger  = false
} else if (absStep > 10) {
level   = “notice”
message = 
danger  = false
} else {
level   = “clear”
message = 
danger  = false
}

res.json({
…result,
level,
message,
danger,
angle: result.state
})

})

export default router
