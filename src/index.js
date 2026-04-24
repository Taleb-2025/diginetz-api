import express from "express"
import cors from "cors"
import flowRouter     from "./api/flow.js"
import visionageRoute from "./api/visionage.route.js"
import visionRoute    from "./api/vision.route.js"
import automotiveRoute from "./api/automotive.route.js"
import cameraRoute    from "./api/camera.route.js"
import securityRoute  from "./api/cam.security.route.js"

const app  = express()
const PORT = process.env.PORT || 8080

app.use(cors({
  origin: [
    "https://diginetz-template.com",
    "https://www.diginetz-template.com"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "x-reference-id",
    "x-agent-key"
  ]
}))

app.use(express.json({ limit: "10mb" }))
app.use(express.raw({
  type: "application/octet-stream",
  limit: "1mb"
}))
app.use(express.static("public"))

app.use("/api/flow",       flowRouter)
app.use("/api/visionage",  visionageRoute)
app.use("/api/vision",     visionRoute)
app.use("/api/automotive", automotiveRoute)
app.use("/api/camera",     cameraRoute)
app.use("/api/security",   securityRoute)

app.get("/", (_req, res) => {
  res.json({
    service: "DigiNetz TSL Core",
    engine:  "TSL",
    status:  "RUNNING"
  })
})

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true })
})

app.listen(PORT, "0.0.0.0", () => {
  console.log("TSL CORE API RUNNING ON PORT " + PORT)
})
