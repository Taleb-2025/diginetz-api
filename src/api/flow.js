// diginetz-api/src/api/flow.js

import express from "express";

import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";
import { TSL_ReferenceStore } from "../store/TSL_ReferenceStore.js";

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_EG } from "../execution/TSL_EG.js";

import { TSL_Decision } from "../interpret/Decision.js";

const router = express.Router();

const adapter = new DefaultTSLAdapter();
const referenceStore = new TSL_ReferenceStore();

const ndr = new TSL_NDR();
const d   = new TSL_D();
const eg  = new TSL_EG({ ndr, d });

/* ================= INIT ================= */

router.post("/init", (req, res) => {
  try {
    const adapted = adapter.adapt(req.body.input);
    const structure = ndr.extract(adapted);
    const ref = referenceStore.save(structure);

    res.json({
      ok: true,
      phase: "INIT",
      referenceId: ref.referenceId
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/* ================= EXECUTE ================= */

router.post("/execute", (req, res) => {
  try {
    const { input, referenceId } = req.body;
    const reference = referenceStore.load(referenceId);
    const adapted = adapter.adapt(input);

    const exec = eg.executeWithReference(reference, adapted);

    const decision = TSL_Decision(exec.delta ?? {});

    res.json({
      ok: true,
      execution: exec,
      decision
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
