
import express from "express"
import { VisionageBlackHoleEngine } from "../engines/visionage-black-hole.engine.js"

const router  = express.Router()
const game    = new VisionageBlackHoleEngine()

game.reset()

router.post("/start", (_req, res) => {
const state = game.reset()
res.json({ ok: true, …game.getState() })
})

router.post("/update", (req, res) => {
const { angle } = req.body

if (!Number.isFinite(Number(angle))) {
return res.status(400).json({ error: "angle required" })
}

const result = game.update(Number(angle))
res.json(result)
})

router.post("/consume", (req, res) => {
const { planetId } = req.body

if (!Number.isFinite(Number(planetId))) {
return res.status(400).json({ error: "planetId required" })
}

const result = game.consume(Number(planetId))
res.json(result)
})

router.get("/state", (_req, res) => {
res.json(game.getState())
})

router.post("/reset", (_req, res) => {
game.reset()
res.json({ ok: true, ...game.getState() })
})

export default router
