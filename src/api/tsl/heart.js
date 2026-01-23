// diginetz-api/src/api/tsl/heart.js

import express from "express";
import { TSL_HeartAdapter } from "../../engines/TSL_HeartAdapter.js";
import { createTSLGuard } from "../../guard/tsl.guard.js";

const router = express.Router();

/* ================= HEART ADAPTER ================= */

const heartAdapter = new TSL_HeartAdapter({
  sampleRate: 30,
  windowSize: 300
});

/* ================= TSL GUARD ================= */

const runtimeState = {};

const tslGuard = createTSLGuard({
  decision: (S0, S1) => {
    if (!S0 || !S1) {
      return { state: "INVALID", reason: "EMPTY_STRUCTURE" };
    }

    if (S0.fingerprint === S1.fingerprint) {
      return { state: "MATCH", reason: "STRUCTURAL_IDENTITY" };
    }

    return { state: "EVENT", reason: "STRUCTURAL_CHANGE" };
  },
  rv: runtimeState
});

/* ================= HEART ENDPOINT ================= */

router.post("/heart", (req, res) => {
  try {
    const { frames } = req.body;

    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: "INVALID_FRAMES" });
    }

    /* ---------- Adapt camera frames ---------- */
    const adapted = heartAdapter.adapt(frames);

    /* ---------- Guarded TSL execution ---------- */
    const S0 = tslGuard.init(adapted.signal);
    const S1 = tslGuard.execute(adapted.signal);

    res.json({
      engine: "TSL",
      source: adapted.source,
      sampleRate: adapted.sampleRate,
      windowSize: adapted.windowSize,
      S0,
      S1,
      decision: S1?.decision ?? null
    });

  } catch (err) {
    console.error("TSL HEART ERROR:", err);
    res.status(500).json({
      error: "TSL_HEART_FAILURE",
      message: err.message
    });
  }
});

export default router;
