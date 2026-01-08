import express from "express";

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D }   from "../engines/TSL_D.js";

import { TSL_RV }  from "./TSL_RV.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_AE }  from "./TSL_AE.js";

import { TSL_Decision } from "./Decision.js";

const router = express.Router();

const ndr = new TSL_NDR();
const d   = new TSL_D();
const rv  = new TSL_RV();

const sts = new TSL_STS();
const ae  = new TSL_AE();

router.post("/guard", async (req, res) => {
  try {
    const { secret, initToken } = req.body;

    if (typeof secret !== "string" || !secret.length) {
      return res.status(400).json({ ok: false });
    }

    /* ================= INIT ================= */
    if (!rv.isInitialized()) {
      if (initToken !== process.env.INIT_TOKEN) {
        return res.status(403).json({ ok: false });
      }

      const S0 = ndr.extract(secret);
      rv.init(S0);

      return res.json({
        ok: true,
        phase: "INIT",
        access: "GRANTED"
      });
    }

    /* ================= ACCESS ================= */
    const S0 = rv.get();
    const S1 = ndr.extract(secret);

    // 👇 الاستخدام الصحيح لمحرك TSL_D
    const containment = d.contain(S0, S1);

    const stsReport = sts.observe(containment.delta);
    const aeReport  = ae.observe
      ? ae.observe(containment.delta)
      : null;

    const decisionResult = TSL_Decision({
      deltaContainment: containment.contained,
      deltaProfile: containment.delta,
      stsReport,
      aeReport
    });

    if (decisionResult.decision === "DENY") {
      return res.status(403).json({
        ok: false,
        access: "DENIED",
        reason: decisionResult
      });
    }

    return res.json({
      ok: true,
      phase: "ACCESS",
      access: "GRANTED",
      decision: decisionResult
    });

  } catch (err) {
    console.error("ADMIN_ACCESS_ERROR", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR"
    });
  }
});

export default router;
