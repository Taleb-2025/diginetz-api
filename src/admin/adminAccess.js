import express from "express";
import fs from "fs";
import path from "path";

import { TSL_NDR_D } from "../engines/TSL_NDR_D.js";
import { TSL_AE } from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();

const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();
const sts  = new TSL_STS({ expected: { density: 0, drift: 0 } });
const sal  = new TSL_SAL();

/* =========================
   Persistent fingerprint
========================= */

const DATA_DIR = "/data";
const FP_FILE  = path.join(DATA_DIR, "admin.fingerprint.json");

function loadFingerprint() {
  if (!fs.existsSync(FP_FILE)) return null;
  try {
    const raw = fs.readFileSync(FP_FILE, "utf8");
    return JSON.parse(raw).fingerprint || null;
  } catch {
    return null;
  }
}

function saveFingerprint(fp) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(
    FP_FILE,
    JSON.stringify({ fingerprint: fp }, null, 2),
    "utf8"
  );
}

/* =========================
   Absent Execution Layer
========================= */

function absentDecision({ decision, delta, trace }) {
  if (decision !== "ALLOW") return "DENY";

  const stable =
    delta.densityDelta === 0 &&
    delta.appearanceDelta === 0;

  const cleanTrace =
    trace?.short?.drift === 0 &&
    trace?.mid?.drift === 0;

  return stable && cleanTrace ? "ALLOW" : "DENY";
}

/* =========================
   ROUTE
========================= */

router.post("/access", (req, res) => {
  const { secret } = req.body;

  if (typeof secret !== "string" || !secret.length) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const storedFingerprint = loadFingerprint();

  const result = ae.guard(
    () => {
      /* --------
         INIT
      -------- */
      if (!storedFingerprint) {
        const S = ndrd.extract(secret);
        const A = ndrd.activate(S);

        saveFingerprint(A.fingerprint);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      /* --------
         ACCESS
      -------- */
      const probeStructure = ndrd.extract(secret);

      const A = ndrd.activate({
        fingerprint: storedFingerprint
      });

      const B = ndrd.activate(probeStructure);

      const delta = ndrd.derive(A, B);
      const trace = sts.observe(ndrd.encode(secret));

      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      const finalDecision = absentDecision({
        decision: salDecision,
        delta,
        trace
      });

      return {
        phase: "ACCESS",
        decision: finalDecision
      };
    },
    {
      name: "ADMIN_STRUCTURAL_ACCESS",
      expectEffect: () => true
    }
  );

  if (result.report.securityFlag !== "OK") {
    return res.status(403).json({
      ok: false,
      access: "DENIED"
    });
  }

  if (result.result.decision !== "ALLOW") {
    return res.status(403).json({
      ok: false,
      access: "DENIED"
    });
  }

  return res.json({
    ok: true,
    access: "GRANTED",
    phase: result.result.phase
  });
});

export default router;
