// src/api/heart.js

import express from "express";
import fetch from "node-fetch";
import { TSL_EventDropper } from "../execution/TSL_EventDropper.js";

const router = express.Router();

const TSL_CORE_URL =
  process.env.TSL_CORE_URL || "http://localhost:8080/api/flow";

/* ---------- Event Dropper ---------- */
const eventDropper = new TSL_EventDropper({
  minDeltaWeight: 0.05,
  minStructuralDistance: 0.01,
  allowEmptyDelta: false
});

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

/* ---------- INIT ---------- */
router.post("/init", async (req, res) => {
  const { heartStream } = req.body;
  const input = normalizeHeartStream(heartStream);

  if (!input) {
    return res.status(400).json({ ok: false, reason: "INVALID_HEART_STREAM" });
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

/* ---------- EXECUTE ---------- */
router.post("/execute", async (req, res) => {
  const { heartStream } = req.body;
  const input = normalizeHeartStream(heartStream);

  if (!input) {
    return res.status(400).json({ ok: false, reason: "INVALID_HEART_STREAM" });
  }

  try {
    const r = await fetch(`${TSL_CORE_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });

    const data = await r.json();

    const drop = eventDropper.evaluate(data.report);

    if (drop.dropped) {
      return res.status(200).json({
        ok: true,
        phase: "ACCESS",
        dropped: true,
        reason: drop.reason
      });
    }

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
