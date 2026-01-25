// diginetz-api/src/api/flow.js

import express from "express";

import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";
import { TSL_ReferenceStore } from "../store/TSL_ReferenceStore.js";

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_EG } from "../execution/TSL_EG.js";

import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";
import { TSL_Decision } from "../interpret/Decision.js";

const router = express.Router();

/* ========== CORE ========== */

const adapter = new DefaultTSLAdapter();
const referenceStore = new TSL_ReferenceStore();

const ndr = new TSL_NDR();
const d   = new TSL_D();
const eg  = new TSL_EG({ ndr, d });

const interpreter = new TSL_Interpreter();

/* ================= INIT ================= */

router.post("/init", (req, res) => {
  try {
    const adapted   = adapter.adapt(req.body.input);   // raw → number[]
    const structure = ndr.extract(adapted);            // number[] → structure
    const ref       = referenceStore.save(structure);  // persist S0

    res.json({
      ok: true,
      phase: "INIT",
      referenceId: ref.referenceId
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

/* ================= EXECUTE ================= */

router.post("/execute", (req, res) => {
  try {
    const { input, referenceId } = req.body;

    const reference = referenceStore.load(referenceId); // S0
    const adapted   = adapter.adapt(input);             // raw → number[]

    /* ===== EXECUTION (STRUCTURAL CONTAINMENT, NOT COMPARISON) ===== */
    const exec = eg.executeWithReference(reference, adapted);

    if (!exec?.ok) {
      return res.status(403).json(exec);
    }

    /* ===== STRUCTURAL INTERPRETATION ===== */
    const interpretation = interpreter.interpret({
      structure: exec.structure,
      delta: exec.delta
    });

    /* ===== DECISION FROM INTERPRETATION ONLY ===== */
    const decision = TSL_Decision({
      ...interpretation,
      aeReport: exec.ae
    });

    res.json({
      ok: true,
      execution: exec,
      interpretation,
      decision
    });

  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

export default router;
