// diginetz-api/src/api/flow.js
// ----------------------------------------------------
// Hybrid Structural–Numeric Flow
// Numbers observe → Structure decides
// Reference handled OUTSIDE the engine
// ----------------------------------------------------

import express from "express";

/* ---------- Engines ---------- */
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D }   from "../engines/TSL_D.js";

/* ---------- State / Observers ---------- */
import { TSL_STS } from "../state/TSL_STS.js";
import { TSL_AE }  from "../state/TSL_AE.js";

/* ---------- Execution ---------- */
import { TSL_EG } from "../execution/TSL_EG.js";

/* ---------- Interpretation & Policy ---------- */
import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";
import { TSL_SAL } from "../layers/TSL_SAL.js";
import { TSL_DCLS } from "../policy/TSL_DCLS.js";
import { TSL_NumericObserver } from "../policy/TSL_NumericObserver.js";

/* ---------- Reference Store (NEW) ---------- */
import { TSL_ReferenceStore } from "../store/TSL_ReferenceStore.js";

const router = express.Router();

/* =========================================================
   Instantiate Core Components
   ========================================================= */

const ndr = new TSL_NDR();
const d   = new TSL_D();

const eg = new TSL_EG({
  ndr,
  d,
  sts: new TSL_STS(),
  ae:  new TSL_AE()
});

const interpreter = new TSL_Interpreter();
const sal         = new TSL_SAL();
const dcls        = new TSL_DCLS();
const numericObs  = new TSL_NumericObserver();

/* ---------- Reference Store ---------- */
const referenceStore = new TSL_ReferenceStore();

/* =========================================================
   INIT — Create Structural Reference (S0)
   ========================================================= */

router.post("/init", (req, res) => {
  const { input } = req.body;

  if (typeof input !== "string" || !input.length) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT"
    });
  }

  try {
    const structure = ndr.extract(input);
    const ref = referenceStore.save(structure);

    return res.json({
      ok: true,
      phase: "INIT",
      referenceId: ref.referenceId,
      reused: ref.reused
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   EXECUTE — Structural Comparison (S1 vs S0)
   ========================================================= */

router.post("/execute", (req, res) => {
  const { input, referenceId } = req.body;

  if (
    typeof input !== "string" ||
    !input.length ||
    typeof referenceId !== "string"
  ) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT"
    });
  }

  let reference;

  try {
    reference = referenceStore.load(referenceId);
  } catch (err) {
    return res.status(404).json({
      ok: false,
      error: err.message
    });
  }

  /* ---------- 1. STRUCTURAL EXECUTION ---------- */
  const exec = eg.executeWithReference(reference, input, {
    source: "api/flow/execute"
  });

  if (!exec.ok) {
    return res.status(403).json(exec);
  }

  /* ---------- 2. NUMERIC OBSERVATION ---------- */
  const numericReport = numericObs.observe({
    delta: exec.delta,
    trace: exec.trace,
    ae: exec.ae
  });

  /* ---------- 3. STRUCTURAL INTERPRETATION ---------- */
  const tslResult = interpreter.interpret({
    structure: exec.structure
  });

  /* ---------- 4. STRUCTURAL ALLOWANCE ---------- */
  const salResult = sal.decide({
    tsl_result: tslResult
  });

  /* ---------- 5. DYNAMIC CONSTRAINT ADAPTATION ---------- */
  const adaptedConstraints = dcls.adapt(
    numericReport,
    numericObs.constraints()
  );

  /* ---------- 6. FINAL RESPONSE ---------- */
  return res.json({
    ok: salResult.decision === "ALLOW",
    referenceId,
    execution: {
      structure: exec.structure,
      delta: exec.delta,
      trace: exec.trace,
      ae: exec.ae
    },
    numeric: numericReport,
    tsl: tslResult,
    sal: salResult,
    constraints: adaptedConstraints
  });
});

export default router;
