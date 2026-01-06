import express from "express";

import { TSL_NDR_D } from "../engines/TSL_NDR_D.js";
import { TSL_AE } from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();

/* ======================================================
   Engines
   ====================================================== */

const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();
const sts  = new TSL_STS();      
const sal  = new TSL_SAL();

/* ======================================================
   In-Memory Reference (Admin Only)
   ====================================================== */

let reference = null;
let refLock = false;

/* ======================================================
   Route
   ====================================================== */

router.post("/guard", async (req, res) => {
  try {
    const { secret, initToken } = req.body;

    if (typeof secret !== "string" || !secret.length) {
      return res.status(400).json({
        ok: false,
        error: "SECRET_REQUIRED"
      });
    }

    const result = ae.guard(() => {

      /* ==================================================
         INIT PHASE (Protected)
         ================================================== */
      if (!reference) {
        if (initToken !== process.env.INIT_TOKEN) {
          return {
            phase: "INIT",
            decision: "DENY"
          };
        }

        reference = ndrd.extract(secret);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      /* ==================================================
         ACCESS PHASE
         ================================================== */

      // 1) Extract current structure
      const probe = ndrd.extract(secret);

      // 2) Structural delta
      const delta = ndrd.derive(
        ndrd.activate(reference),
        ndrd.activate(probe)
      );

      // 3) NDR-D decision (ACCEPT | ADAPT | REJECT)
      const structuralDecision = ndrd.evaluate(delta);

      // 4) Temporal trace (rhythm, not bits)
      const trace = sts.observe(probe.rhythm);

      // 5) SAL decision (temporal / execution safety)
      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      /* ==================================================
         DECISION MATRIX
         ================================================== */

      // Hard reject
      if (
        structuralDecision === "REJECT" ||
        salDecision !== "ALLOW"
      ) {
        return {
          phase: "ACCESS",
          decision: "DENY"
        };
      }

      // Safe adapt (learning)
      if (
        structuralDecision === "ADAPT" &&
        !refLock
      ) {
        refLock = true;
        try {
          // Replace reference with new stabilized structure
          reference = probe;
        } finally {
          refLock = false;
        }
      }

      // ACCEPT or ADAPT → allow access
      return {
        phase: "ACCESS",
        decision: "ALLOW"
      };
    });

    /* ==================================================
       Enforcement
       ================================================== */

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
    console.error("ADMIN_GUARD_ERROR", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR"
    });
  }
});

export default router;
