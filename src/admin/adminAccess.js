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
   Persistent STRUCTURE (S)
========================= */

const DATA_DIR = "/data";
const STRUCT_FILE = path.join(DATA_DIR, "admin.structure.json");

function loadStructure() {
  if (!fs.existsSync(STRUCT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STRUCT_FILE, "utf8")).structure || null;
  } catch {
    return null;
  }
}

function saveStructure(S) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(
    STRUCT_FILE,
    JSON.stringify({ structure: S }, null, 2),
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

router.post("/guard", (req, res) => {
  const { secret } = req.body;

  if (typeof secret !== "string" || !secret.length) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const storedStructure = loadStructure();

  const result = ae.guard(
    () => {

      /* --------
         INIT (first ever time)
      -------- */
      if (!storedStructure) {
        const S = ndrd.extract(secret);
        saveStructure(S);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      /* --------
         ACCESS
      -------- */
      const probeStructure = ndrd.extract(secret);

      const A = ndrd.activate(storedStructure);
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
