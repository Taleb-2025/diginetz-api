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

const DATA_DIR = "/data";
const REF_FILE = path.join(DATA_DIR, "admin.reference.json");

const EPSILON = 0.0001;

function loadRef() {
  if (!fs.existsSync(REF_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(REF_FILE, "utf8")).ref || null;
  } catch {
    return null;
  }
}

function saveRef(ref) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(
    REF_FILE,
    JSON.stringify({ ref }, null, 2),
    "utf8"
  );
}

function within(v) {
  return Math.abs(v) <= EPSILON;
}

function absentGate(decision, delta, trace) {
  if (decision !== "ALLOW") return "DENY";

  if (!within(delta.densityDelta)) return "DENY";
  if (!within(delta.appearanceDelta)) return "DENY";

  if (!within(trace?.short?.drift ?? 0)) return "DENY";
  if (!within(trace?.mid?.drift ?? 0)) return "DENY";

  return "ALLOW";
}

router.post("/guard", (req, res) => {
  const { secret } = req.body;

  if (typeof secret !== "string" || !secret.length) {
    return res.status(400).json({ ok: false, error: "SECRET_REQUIRED" });
  }

  const storedRef = loadRef();

  const result = ae.guard(
    () => {
      if (!storedRef) {
        const S = ndrd.extract(secret);
        const A = ndrd.activate(S);
        saveRef(A);
        return { phase: "INIT", decision: "ALLOW" };
      }

      const probeS = ndrd.extract(secret);
      const probeA = ndrd.activate(probeS);

      // 🔧 السطر الوحيد الذي أصلح كل شيء
      const delta = ndrd.derive(ndrd.activate(storedRef), probeA);

      const trace = sts.observe(ndrd.encode(secret));

      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      return {
        phase: "ACCESS",
        decision: absentGate(salDecision, delta, trace)
      };
    },
    {
      name: "ADMIN_STRUCTURAL_ACCESS",
      expectEffect: () => true
    }
  );

  if (result.report.securityFlag !== "OK") {
    return res.status(403).json({ ok: false, access: "DENIED" });
  }

  if (result.result.decision !== "ALLOW") {
    return res.status(403).json({ ok: false, access: "DENIED" });
  }

  return res.json({
    ok: true,
    access: "GRANTED",
    phase: result.result.phase
  });
});

export default router;
