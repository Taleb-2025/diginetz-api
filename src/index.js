import express from "express";
import cors from "cors";

import flowRouter from "./api/flow.js";
import visionageRoute from "./api/visionage.route.js"; // 👈 أضفنا هذا فقط

const app = express();
const PORT = process.env.PORT || 8080;

/* ---------- CORS ---------- */
app.use(cors({
  origin: [
    "https://diginetz-template.com",
    "https://www.diginetz-template.com"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "x-reference-id"
  ]
}));

/* ---------- RAW BYTES SUPPORT (مهم جدا) ---------- */
app.use(express.raw({
  type: "application/octet-stream",
  limit: "1mb"
}));

/* ---------- STATIC FILES ---------- */
app.use(express.static("public"));

/* ---------- API ROUTES ---------- */
app.use("/api/flow", flowRouter);
app.use("/api/visionage", visionageRoute); // 👈 هذا هو المهم

/* ---------- ROOT ---------- */
app.get("/", (_req, res) => {
  res.json({
    service: "DigiNetz TSL Core",
    engine: "TSL",
    status: "RUNNING"
  });
});

/* ---------- HEALTH ---------- */
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

/* ---------- START ---------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TSL CORE API RUNNING ON PORT ${PORT}`);
});
