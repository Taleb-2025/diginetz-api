import express from "express";

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D }   from "../engines/TSL_D.js";
import { TSL_RV }  from "../engines/TSL_RV.js";

import { TSL_AE }  from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();

const ndr = new TSL_NDR();
const d   = new TSL_D();
const rv  = new TSL_RV();

const ae  = new TSL_AE();
const sts = new TSL_STS();
const sal = new TSL_SAL();

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

      if (!rv.isInitialized()) {
        if (initToken !== process.env.INIT_TOKEN) {
          return {
            phase: "INIT",
            decision: "DENY"
          };
        }

        const S0 = ndr.extract(secret);
        rv.init(S0);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      const S0 = rv.get();
      const S1 = ndr.extract(secret);

      const { delta, decision: structuralDecision } =
        d.compare(S0, S1);

      const trace = sts.observe(delta);

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
