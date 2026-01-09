import express from "express";

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D }   from "../engines/TSL_D.js";

import { TSL_RV }  from "../state/TSL_RV.js";
import { TSL_STS } from "../state/TSL_STS.js";
import { TSL_AE }  from "../state/TSL_AE.js";

import { TSL_Decision } from "../interpret/Decision.js";
import { TSL_EG } from "../execution/TSL_EG.js";

const router = express.Router();

/* ---------- instantiate core ---------- */
const eg = new TSL_EG({
  ndr: new TSL_NDR(),
  d:   new TSL_D(),
  rv:  new TSL_RV(),
  sts: new TSL_STS(),
  ae:  new TSL_AE(),
  decision: TSL_Decision
});

/* ---------- INIT (one time reference) ---------- */
router.post("/init", (req, res) => {
  const { input } = req.body;

  if (typeof input !== "string" || !input.length) {
    return res.status(400).json({ ok: false });
  }

  const result = eg.init(input, {
    source: "api/flow/init"
  });

  return res.json(result);
});

/* ---------- EXECUTE (flow comparison) ---------- */
router.post("/execute", (req, res) => {
  const { input } = req.body;

  if (typeof input !== "string" || !input.length) {
    return res.status(400).json({ ok: false });
  }

  const result = eg.execute(input, {
    source: "api/flow/execute"
  });

  if (!result.ok) {
    return res.status(403).json(result);
  }

  return res.json(result);
});

export default router;
