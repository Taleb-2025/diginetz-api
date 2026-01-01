import express from "express";

import { TSL_NDR_D } from "../tsl/TSL_NDR_D.js";
import { TSL_STS }   from "../tsl/TSL_STS.js";
import { TSLAE }     from "../tsl/TSL_AE.js";
import { TSL_SAL }   from "../tsl/TSL_SAL.js";

const router = express.Router();

const ndrd = new TSL_NDR_D();
const sts  = new TSL_STS({
  expected: { density: 0, drift: 0 }
});
const ae   = new TSLAE();
const sal  = new TSL_SAL();

router.post("/access", (req, res) => {

  const { secret } = req.body;

  if (!secret) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const comparison = ndrd.compare(secret, secret);

  const bits = ndrd.encode(secret);
  const trace = sts.observe(bits);

  const aeResult = ae.guard(
    () => true,
    {
      name: "ADMIN_ACCESS",
      expectEffect: () => comparison !== null
    }
  );

  const decision = sal.decide({
    structure: comparison,
    trace,
    execution: aeResult.report
  });

  if (decision === "ALLOW") {
    return res.status(200).json({
      ok: true,
      access: "GRANTED"
    });
  }

  return res.status(403).json({
    ok: false,
    access: "DENIED"
  });
});

export default router;
