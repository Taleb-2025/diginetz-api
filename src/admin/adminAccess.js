import express from "express";
import { TSL_NDR_D } from "../tsl/TSL_NDR_D.js";
import { TSL_AE } from "../tsl/TSL_AE.js";
import { TSL_STS } from "../tsl/TSL_STS.js";
import { TSL_SAL } from "../tsl/TSL_SAL.js";

const router = express.Router();

const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();
const sts  = new TSL_STS({ expected: { density: 0, drift: 0 } });
const sal  = new TSL_SAL();

let ADMIN_BOUND = false;
let ADMIN_STRUCTURE = null;

/* ========= INIT ========= */
router.post("/init", (req, res) => {
  if (ADMIN_BOUND) {
    return res.status(403).json({ ok: false, error: "ADMIN_ALREADY_BOUND" });
  }

  const { secret } = req.body;
  if (typeof secret !== "string") {
    return res.status(400).json({ ok: false, error: "SECRET_REQUIRED" });
  }

  const { report, result } = ae.guard(
    () => {
      const S = ndrd.extract(secret);
      ADMIN_STRUCTURE = S;
      ADMIN_BOUND = true;
      return S;
    },
    {
      name: "ADMIN_INIT",
      expectEffect: () => ADMIN_STRUCTURE !== null
    },
    { layer: "NDR", phase: "init" }
  );

  if (report.securityFlag !== "OK") {
    return res.status(403).json({ ok: false, error: "INIT_BLOCKED", report });
  }

  return res.json({ ok: true, message: "ADMIN_BOUND_SUCCESSFULLY" });
});

/* ========= ACCESS ========= */
router.post("/access", (req, res) => {
  if (!ADMIN_BOUND || !ADMIN_STRUCTURE) {
    return res.status(403).json({ ok: false, error: "ADMIN_NOT_INITIALIZED" });
  }

  const { secret } = req.body;
  if (typeof secret !== "string") {
    return res.status(400).json({ ok: false, error: "SECRET_REQUIRED" });
  }

  const { report, result } = ae.guard(
    () => {
      /* Layer 1 — NDR */
      const probe = ndrd.extract(secret);

      /* Layer 2 — D */
      const A = ndrd.activate(ADMIN_STRUCTURE);
      const B = ndrd.activate(probe);
      const delta = ndrd.derive(A, B);

      /* Layer 3 — STS (trace only) */
      const trace = sts.observe(ndrd.encode(secret));

      /* Layer 4 — SAL (decision) */
      return sal.decide({
        structure: delta,
        trace,
        execution: report?.executionState ?? "UNKNOWN"
      });
    },
    {
      name: "ADMIN_ACCESS",
      expectEffect: () => true
    },
    { layer: "D/SAL", phase: "access" }
  );

  if (report.securityFlag !== "OK") {
    return res.status(403).json({ ok: false, access: "DENIED", report });
  }

  if (result !== "ALLOW") {
    return res.status(403).json({ ok: false, access: "DENIED" });
  }

  return res.json({ ok: true, access: "GRANTED" });
});

export default router;
