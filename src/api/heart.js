// src/api/heart.js

import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const TSL_CORE_URL =
  process.env.TSL_CORE_URL || "http://localhost:8080/api/flow";

/* ---------- normalize heart signal ---------- */
function normalizeHeartStream(raw) {
  if (!raw) return "";

  if (Array.isArray(raw)) {
    return raw
      .map(v => Number(v))
      .filter(v => Number.isFinite(v))
      .join(",");
  }

  if (typeof raw === "string") {
    return raw.replace(/\s+/g, "").slice(0, 4096);
  }

  return "";
}

/* ---------- INIT baseline (rest state) ---------- */
router.post("/init", async (req, res) => {
  const { heartStream } = req.body;

  const input = normalizeHeartStream(heartStream);

  if (!input) {
    return res.status(400).json({
      ok: false,
      reason: "INVALID_HEART_STREAM"
    });
  }

  try {
    const r = await fetch(`${TSL_CORE_URL}/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "TSL_CORE_UNREACHABLE",
      error: String(err)
    });
  }
});

/* ---------- EXECUTE comparison (activity / stress) ---------- */
router.post("/execute", async (req, res) => {
  const { heartStream } = req.body;

  const input = normalizeHeartStream(heartStream);

  if (!input) {
    return res.status(400).json({
      ok: false,
      reason: "INVALID_HEART_STREAM"
    });
  }

  try {
    const r = await fetch(`${TSL_CORE_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "TSL_CORE_UNREACHABLE",
      error: String(err)
    });
  }
});

export default router;
