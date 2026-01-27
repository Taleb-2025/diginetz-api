// diginetz-api/src/api/flow.js

import express from "express";

import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";
import { TSL_ReferenceStore } from "../store/TSL_ReferenceStore.js";

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_EG } from "../execution/TSL_EG.js";

import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";
import { TSL_StructuralDecision as TSL_Decision } from "../policy/TSL_StructuralDecision.js";

const router = express.Router();

/* =====================================================
   RAW BYTES ONLY — NO JSON, NO STRING, NO OBJECT
   ===================================================== */

router.use(
  express.raw({
    type: "application/octet-stream",
    limit: "1mb"
  })
);

/* ================= CORE ================= */

const adapter = new DefaultTSLAdapter();
const referenceStore = new TSL_ReferenceStore();

const ndr = new TSL_NDR();
const d   = new TSL_D();
const eg  = new TSL_EG({ ndr, d });

const interpreter = new TSL_Interpreter();

/* ================= INIT (S0) ================= */

router.post("/init", (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        ok: false,
        error: "RAW_BYTES_REQUIRED"
      });
    }

    const bytes     = Uint8Array.from(req.body);
    const adapted   = adapter.adapt(bytes);
    const structure = ndr.extract(adapted);

    const ref = referenceStore.save(structure);

    return res.json({
      ok: true,
      phase: "INIT",
      referenceId: ref.referenceId,
      referenceStructure: structure   // ← أضيفت هنا
    });

  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

/* ================= EXECUTE (S1) ================= */

router.post("/execute", (req, res) => {
  try {
    const referenceId = req.headers["x-reference-id"];

    if (!referenceId || typeof referenceId !== "string") {
      return res.status(400).json({
        ok: false,
        error: "MISSING_REFERENCE_ID"
      });
    }

    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        ok: false,
        error: "RAW_BYTES_REQUIRED"
      });
    }

    const reference = referenceStore.load(referenceId);

    const bytes   = Uint8Array.from(req.body);
    const adapted = adapter.adapt(bytes);

    const exec = eg.executeWithReference(reference, adapted);

    if (!exec?.ok) {
      return res.status(403).json(exec);
    }

    const interpretation = interpreter.interpret({
      structure: exec.structure,
      delta: exec.delta
    });

    const decision = TSL_Decision({
      ...interpretation,
      aeReport: exec.ae
    });

    return res.json({
      ok: true,
      execution: exec,
      interpretation,
      decision
    });

  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

export default router;
