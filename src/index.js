import express from "express";
import cors from "cors";

import flowRouter from "./api/flow.js";
import automotiveRouter from "./api/automotive.js";

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= MIDDLEWARE ================= */

app.use(cors({
  origin: [
    "https://diginetz-template.com",
    "https://www.diginetz-template.com"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400
}));

app.use(express.json());

/* ================= ROUTES ================= */

app.use("/api/flow", flowRouter);
app.use("/api/automotive", automotiveRouter);

/* ================= SYSTEM ================= */

// Health / Identity (deterministic – no time)
app.get("/", (req, res) => {
  res.json({
    service: "DigiNetz TSL Core",
    engine: "TSL",
    status: "RUNNING",
    mode: "DETERMINISTIC"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

/* ================= ERROR ================= */

app.use((err, req, res, next) => {
  console.error("TSL CORE ERROR:", err);
  res.status(500).json({
    error: "INTERNAL_ERROR",
    engine: "TSL"
  });
});

/* ================= BOOT ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TSL CORE API RUNNING ON PORT ${PORT}`);
});
