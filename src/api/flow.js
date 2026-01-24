// diginetz-api/src/api/flow.js

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
const policy      = new TSL_DCLS();

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

  const result = eg.init(input, {
    source: "api/flow/init"
  });

  return res.json(result);
});

/* =========================================================
   EXECUTE — Full Structural Flow
   ========================================================= */

router.post("/execute", (req, res) => {
  const { input } = req.body;

  if (typeof input !== "string" || !input.length) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT"
    });
  }

  /* ---------- Execution Gate ---------- */
  const executionReport = eg.execute(input, {
    source: "api/flow/execute"
  });

  if (!executionReport.ok) {
    return res.status(403).json(executionReport);
  }

  /* ---------- Interpretation ---------- */
  const tslResult = interpreter.interpret(executionReport);

  /* ---------- Structural Allowance ---------- */
  const salResult = sal.decide({
    tsl_result: tslResult
  });

  /* ---------- Decision Policy ---------- */
  const finalDecision = policy.decide({
    tsl: tslResult,
    sal: salResult
  });

  return res.json({
    ok: finalDecision.decision === "ALLOW",
    execution: executionReport,
    tsl: tslResult,
    sal: salResult,
    decision: finalDecision
  });
});

export default router;
