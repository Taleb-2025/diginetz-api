// diginetz-api/src/api/flow.js
// ----------------------------------------------------
// FLOW LAYER (PURE BRIDGE)
// Browser → flow.js → TSL Input Adapter
// No logic, no interpretation, no decisions
// ----------------------------------------------------

import express from "express";

/* ---------- TSL Input Adapter ---------- */
import { DefaultTSLAdapter } from "../adapter/TSL_InputAdapter.js";

/* ---------- Reference Store ---------- */
import { TSL_ReferenceStore } from "../store/TSL_ReferenceStore.js";

const router = express.Router();

/* =========================================================
   Instantiate Pure Bridge Components
   ========================================================= */

const adapter = new DefaultTSLAdapter();
const referenceStore = new TSL_ReferenceStore();

/* =========================================================
   INIT — Receive raw input and pass to Adapter
   ========================================================= */

router.post("/init", (req, res) => {
  const { input } = req.body;

  try {
    // flow.js DOES NOT CARE what input is
    // It just forwards it to the adapter
    const adapted = adapter.adapt(input);

    const ref = referenceStore.save(adapted);

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
   EXECUTE — Forward raw input to Adapter
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
    const reference = referenceStore.load(referenceId);

    // Again: NO LOGIC HERE
    const adapted = adapter.adapt(input);

    return res.json({
      ok: true,
      referenceId,
      adaptedInput: adapted,
      reference
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

export default router;
