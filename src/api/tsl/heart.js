// diginetz-api/src/api/tsl/heart.js

import express from "express";
import { createTSLGuard } from "../../guard/tsl.guard.js";

const router = express.Router();

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
/*
  Frontend sends:
  {
    heartStream: number[]
  }
*/

router.post("/heart", (req, res) => {
  try {
    const { heartStream } = req.body;

    if (!Array.isArray(heartStream) || heartStream.length < 2) {
      return res.status(400).json({
        error: "INVALID_HEART_STREAM"
      });
    }

    /* ---------- INIT (S0 once) ---------- */
    if (!runtimeState.__initialized) {
      const S0 = tslGuard.init(heartStream);
      runtimeState.__initialized = true;

      return res.json({
        engine: "TSL",
        phase: "INIT",
        S0
      });
    }

    /* ---------- EXECUTE (S1) ---------- */
    const S1 = tslGuard.execute(heartStream);

    return res.json({
      engine: "TSL",
      phase: "EXECUTE",
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
