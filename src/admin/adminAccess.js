import express from "express";

import { TSL_NDR_D } from "../engines/TSL_NDR_D.js";
import { TSL_AE } from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();

const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();
const sts  = new TSL_STS();
const sal  = new TSL_SAL();

let reference = null;
let refLock = false;

router.post("/guard", async (req, res) => {
  try {

    console.log("INIT STEP CHECK", {
      initToken: req.body.initToken,
      envToken: process.env.INIT_TOKEN
    });

    const { secret, initToken } = req.body;

    if (typeof secret !== "string" || !secret.length) {
      return res.status(400).json({
        ok: false,
        error: "SECRET_REQUIRED"
      });
    }

    const result = ae.guard(() => {

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

      const probe = ndrd.extract(secret);

      const delta = ndrd.derive(
        ndrd.activate(reference),
        ndrd.activate(probe)
      );

      const structuralDecision = ndrd.evaluate(delta);

      const trace = sts.observe(probe.rhythm);

      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      if (
        structuralDecision === "REJECT" ||
        salDecision !== "ALLOW"
      ) {
        return {
          phase: "ACCESS",
          decision: "DENY"
        };
      }

      if (
        structuralDecision === "ADAPT" &&
        !refLock
      ) {
        refLock = true;
        try {
          reference = probe;
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
    console.error("ADMIN_GUARD_ERROR", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR"
    });
  }
});

export default router;
