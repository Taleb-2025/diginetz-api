import express from "express"
import cors from "cors"

import cycleguardRoute from "./api/cycleguard.route.js"
import cycleguardSessionRoute from "./api/cycleguard-session.route.js"
import identityRoute from "./api/identity.route.js"

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
    "x-agent-key",
    "x-cg-api-key",      // ✅ جديد
    "x-cg-pub-token"     // ✅ جديد
  ]
}))

app.use(express.json({ limit: "10mb" }))
app.use(express.raw({ type: "application/octet-stream", limit: "1mb" }))
app.use(express.static("public"))

app.use("/api/cycleguard", cycleguardRoute)
app.use("/api/cg-session", cycleguardSessionRoute)  // ✅ مسار مصحح
app.use("/api/identity", identityRoute)

app.get("/", (_req, res) => {
  res.json({ service: "DigiNetz TSL Core", engine: "TSL + CPSE v1.0", status: "RUNNING" })
})

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true })
})

app.listen(PORT, "0.0.0.0", () => {
  console.log("TSL CORE API RUNNING ON PORT " + PORT)
})
