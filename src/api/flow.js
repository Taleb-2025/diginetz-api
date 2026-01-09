// src/api/flow.js
import express from "express";
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";

const router = express.Router();

const ndr = new TSL_NDR();
const d   = new TSL_D();

/**
 * POST /api/flow/derive
 * body: { reference, current }
 */
router.post("/derive", (req, res) => {
  try {
    const { reference, current } = req.body;

    if (!reference || !current) {
      return res.status(400).json({ ok: false });
    }

    const S0 = ndr.extract(reference);
    const S1 = ndr.extract(current);

    const delta = d.derive(S0, S1);

    return res.json({
      ok: true,
      reference: S0.fingerprint,
      current: S1.fingerprint,
      delta
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

export default router;
