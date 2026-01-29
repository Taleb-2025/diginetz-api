import express from "express";
import cors from "cors";

import flowRouter from "./api/flow.js";

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

/* ---------- STATIC FILES ---------- */
app.use(express.static("public"));

/* ---------- API ROUTES ---------- */
app.use("/api/flow", flowRouter);

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
