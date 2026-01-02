import express from "express";


import { TSL_NDR_D } from "../engines/TSL_NDR_D.js";


import { TSL_AE } from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();


const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();

const sts  = new TSL_STS({
  expected: { density: 0, drift: 0 }
});

const sal  = new TSL_SAL();


let ADMIN_BOUND = false;
let ADMIN_STRUCTURE = null;

function TSL_ABSENT_LAYER({ decision, delta, trace }) {


  if (decision !== "ALLOW") return "DENY";

  const structuralStable =
    Math.abs(delta.densityDelta) === 0 &&
    Math.abs(delta.appearanceDelta) === 0;

  const traceClean =
    trace && trace.drift === 0;

  if (structuralStable && traceClean) {
    return "ALLOW";
  }

  return "DENY";
}


router.post("/init", (req, res) => {
  if (ADMIN_BOUND) {
    return res.status(403).json({
      ok: false,
      error: "ADMIN_ALREADY_BOUND"
    });
  }

  const { secret } = req.body;
  if (typeof secret !== "string") {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const result = ae.guard(
    () => {
      const S = ndrd.extract(secret);   // 🔹 NDR only
      ADMIN_STRUCTURE = S;
      ADMIN_BOUND = true;
      return true;
    },
    {
      name: "ADMIN_INIT",
      expectEffect: () => ADMIN_STRUCTURE !== null
    },
    { phase: "init" }
  );

  if (result.report.securityFlag !== "OK") {
    return res.status(403).json({
      ok: false,
      error: "INIT_FAILED",
      report: result.report
    });
  }

  return res.json({
    ok: true,
    message: "ADMIN_BOUND_SUCCESSFULLY"
  });
});


router.post("/access", (req, res) => {
  if (!ADMIN_BOUND || !ADMIN_STRUCTURE) {
    return res.status(403).json({
      ok: false,
      error: "ADMIN_NOT_INITIALIZED"
    });
  }

  const { secret } = req.body;
  if (typeof secret !== "string") {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const result = ae.guard(
    () => {
     
      const probe = ndrd.extract(secret);

      const A = ndrd.activate(ADMIN_STRUCTURE);
      const B = ndrd.activate(probe);

      const delta = ndrd.derive(A, B);

    
      const trace = sts.observe(ndrd.encode(secret));

      
      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false // ❗ Absent
      });

     
      return TSL_ABSENT_LAYER({
        decision: salDecision,
        delta,
        trace
      });
    },
    {
      name: "ADMIN_ACCESS_ABSENT",
      expectEffect: () => true
    },
    { phase: "access" }
  );

  if (result.report.securityFlag !== "OK") {
    return res.status(403).json({
      ok: false,
      access: "DENIED",
      report: result.report
    });
  }

  if (result.result !== "ALLOW") {
    return res.status(403).json({
      ok: false,
      access: "DENIED"
    });
  }

  return res.json({
    ok: true,
    access: "GRANTED"
  });
});

export default router;
