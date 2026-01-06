import express from "express";

import { TSL_NDR_D } from "../engines/TSL_NDR_D.js";
import { TSL_AE } from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();

/* ---------- Engines ---------- */

const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();
const sts  = new TSL_STS({ expected: { density: 0, drift: 0 } });
const sal  = new TSL_SAL();

/* ---------- Parameters ---------- */

const ACCEPTANCE_THRESHOLD = 0.30;
const ADAPT_RATE = 0.1;

/* ---------- In-Memory Reference ---------- */

let cachedRef = null;
let refLock = false;

/* ---------- Math ---------- */

function normalizedDistance(delta) {
  const d = Math.min(1, Math.abs(delta.densityDelta));
  const a = Math.min(1, Math.abs(delta.appearanceDelta));
  return 0.6 * d + 0.4 * a;
}

function safeUpdateReference(oldRef, newRef, rate) {
  const updated = {};
  for (const key in oldRef) {
    if (
      typeof oldRef[key] === "number" &&
      typeof newRef[key] === "number"
    ) {
      updated[key] =
        oldRef[key] * (1 - rate) + newRef[key] * rate;
    } else {
      updated[key] = oldRef[key];
    }
  }
  return updated;
}

/* ---------- Route ---------- */

router.post("/guard", async (req, res) => {
  try {
    const { secret, initToken } = req.body;

    if (typeof secret !== "string" || !secret.length) {
      return res.status(400).json({ ok: false });
    }

    const result = ae.guard(() => {

      /* ---------- INIT ---------- */
      if (!cachedRef) {
        if (initToken !== process.env.INIT_TOKEN) {
          return { phase: "INIT", decision: "DENY" };
        }

        cachedRef = ndrd.extract(secret);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      /* ---------- ACCESS ---------- */
      const probe = ndrd.extract(secret);
      const delta = ndrd.derive(cachedRef, probe);
      const distance = normalizedDistance(delta);

      const trace = sts.observe(
        ndrd.encode(secret)
      );

      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      if (salDecision !== "ALLOW") {
        return { phase: "ACCESS", decision: "DENY" };
      }

      if (distance > ACCEPTANCE_THRESHOLD) {
        return { phase: "ACCESS", decision: "DENY" };
      }

      /* ---------- SAFE LEARNING ---------- */
      if (
        distance < ACCEPTANCE_THRESHOLD * 0.5 &&
        !refLock
      ) {
        refLock = true;
        try {
          cachedRef = safeUpdateReference(
            cachedRef,
            probe,
            ADAPT_RATE
          );
        } finally {
          refLock = false;
        }
      }

      return {
        phase: "ACCESS",
        decision: "ALLOW"
      };
    });

    if (
      result.report.securityFlag !== "OK" ||
      result.result.decision !== "ALLOW"
    ) {
      return res.status(403).json({
        ok: false,
        access: "DENIED"
      });
    }

    return res.json({
      ok: true,
      access: "GRANTED",
      phase: result.result.phase
    });

  } catch (err) {
    console.error("GUARD_ERROR", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR"
    });
  }
});

export default router;
