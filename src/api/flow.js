// diginetz-api/src/api/flow.js
// Hybrid Structural–Numeric Flow
// Numbers observe → Structure decides

import express from "express";

/* ---------- Engines ---------- */
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D }   from "../engines/TSL_D.js";

/* ---------- State ---------- */
import { TSL_RV }  from "../state/TSL_RV.js";
import { TSL_STS } from "../state/TSL_STS.js";
import { TSL_AE }  from "../state/TSL_AE.js";

/* ---------- Execution ---------- */
import { TSL_EG } from "../execution/TSL_EG.js";

/* ---------- Interpretation & Policy ---------- */
import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";
import { TSL_SAL } from "../layers/TSL_SAL.js";
import { TSL_DCLS } from "../policy/TSL_DCLS.js";

/* ---------- Numeric Observer ---------- */
import { TSL_NumericObserver } from "../policy/TSL_NumericObserver.js";

const router = express.Router();

/* =========================================================
   Instantiate Core Pipeline
   ========================================================= */

const eg = new TSL_EG({
  ndr: new TSL_NDR(),
  d:   new TSL_D(),
  rv:  new TSL_RV(),
  sts: new TSL_STS(),
  ae:  new TSL_AE()
});

const interpreter = new TSL_Interpreter();
const sal         = new TSL_SAL();
const dcls        = new TSL_DCLS();
const numericObs  = new TSL_NumericObserver();

/* =========================================================
   INIT — Reference Initialization (S0)
   ========================================================= */

router.post("/init", (req, res) => {
  const { input } = req.body;

  if (typeof input !== "string" || !input.length) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT"
    });
  }

  const initResult = eg.init(input, {
    source: "api/flow/init"
  });

  return res.json(initResult);
});

/* =========================================================
   RESET — Clear Reference (S0)
   ========================================================= */

router.post("/reset", (req, res) => {
  if (typeof eg.reset !== "function") {
    return res.status(500).json({
      ok: false,
      error: "RESET_NOT_SUPPORTED"
    });
  }

  const result = eg.reset({
    source: "api/flow/reset"
  });

  return res.json(result);
});

/* =========================================================
   EXECUTE — Hybrid Structural Flow
   ========================================================= */

router.post("/execute", (req, res) => {
  const { input } = req.body;

  if (typeof input !== "string" || !input.length) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT"
    });
  }

  /* ---------- 1. EXECUTION GRAPH (NO DECISION) ---------- */
  const exec = eg.execute(input, {
    source: "api/flow/execute"
  });

  if (!exec.ok) {
    return res.status(403).json(exec);
  }

  /* ---------- 2. NUMERIC OBSERVATION (NO DECISION) ---------- */
  const numericReport = numericObs.observe({
    delta: exec.delta,
    trace: exec.trace,
    ae: exec.ae
  });

  /* ---------- 3. STRUCTURAL INTERPRETATION ---------- */
  const tslResult = interpreter.interpret({
    structure: exec.structure
  });

  /* ---------- 4. STRUCTURAL ALLOWANCE LAYER ---------- */
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
