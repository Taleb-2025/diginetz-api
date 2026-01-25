// diginetz-api/src/api/flow.js
// ----------------------------------------------------
// FLOW LAYER (EXECUTION BRIDGE)
// Browser → Adapter → TSL_EG → NDR → D
// ----------------------------------------------------

import express from "express";

/* ---------- Adapter ---------- */
import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";

/* ---------- Core Engines ---------- */
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";

/* ---------- Execution Graph ---------- */
import { TSL_EG } from "../execution/TSL_EG.js";

/* ---------- Reference Store ---------- */
import { TSL_ReferenceStore } from "../store/TSL_ReferenceStore.js";

const router = express.Router();

/* =========================================================
   Instantiate Core
   ========================================================= */

const adapter = new DefaultTSLAdapter();
const referenceStore = new TSL_ReferenceStore();

const ndr = new TSL_NDR();
const d   = new TSL_D();

const eg = new TSL_EG({
  ndr,
  d
});

/* =========================================================
   INIT — Create Reference (S0)
   ========================================================= */

router.post("/init", (req, res) => {
  const { input } = req.body;

  try {
    // 1. Raw → numeric[]
    const numeric = adapter.adapt(input);

    // 2. numeric[] → structural reference
    const referenceStructure = ndr.extract(numeric);

    // 3. Store reference
    const ref = referenceStore.save(referenceStructure);

    return res.json({
      ok: true,
      phase: "INIT",
      referenceId: ref.referenceId
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   EXECUTE — Compare S1 vs S0
   ========================================================= */

router.post("/execute", (req, res) => {
  const { input, referenceId } = req.body;

  if (typeof referenceId !== "string") {
    return res.status(400).json({
      ok: false,
      error: "MISSING_REFERENCE_ID"
    });
  }

  try {
    // 1. Load S0
    const referenceStructure = referenceStore.load(referenceId);

    // 2. Raw → numeric[]
    const numeric = adapter.adapt(input);

    // 3. Execute TSL pipeline
    const exec = eg.executeWithReference(
      referenceStructure,
      numeric,
      { source: "api/flow/execute" }
    );

    if (!exec.ok) {
      return res.status(403).json(exec);
    }

    return res.json({
      ok: true,
      referenceId,
      execution: {
        structure: exec.structure,
        delta: exec.delta,
        trace: exec.trace,
        ae: exec.ae
      }
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

export default router;
