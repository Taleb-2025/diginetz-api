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

const DATA_DIR  = "/data";
const FP_FILE   = path.join(DATA_DIR, "admin.fingerprint.json");

function loadFingerprint() {
  if (!fs.existsSync(FP_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FP_FILE, "utf8")).fingerprint || null;
  } catch {
    return null;
  }
}

function saveFingerprint(fp) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    FP_FILE,
    JSON.stringify({ fingerprint: fp }, null, 2),
    "utf8"
  );
}

function extractFingerprint(structure) {
  const A = ndrd.activate(structure);
  return A.fingerprint;
}

function absentDecision({ decision, delta, trace }) {
  if (decision !== "ALLOW") return "DENY";

  const stable =
    Math.abs(delta.densityDelta) === 0 &&
    Math.abs(delta.appearanceDelta) === 0;

  const cleanTrace =
    trace?.short?.drift === 0 &&
    trace?.mid?.drift === 0;

  return stable && cleanTrace ? "ALLOW" : "DENY";
}

router.post("/guard", (req, res) => {
  const { secret } = req.body;

  if (typeof secret !== "string") {
    return res.status(400).json({ ok: false, error: "SECRET_REQUIRED" });
  }

  const storedFingerprint = loadFingerprint();

  const result = ae.guard(
    () => {
      const S = ndrd.extract(secret);
      const fp = extractFingerprint(S);

      // INIT — first ever time
      if (!storedFingerprint) {
        saveFingerprint(fp);
        return { phase: "INIT", decision: "ALLOW" };
      }

      // ACCESS — structural comparison
      const probe = ndrd.extract(secret);

      const A = ndrd.activate({ ...S, fingerprint: storedFingerprint });
      const B = ndrd.activate(probe);

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

      return { phase: "ACCESS", decision: finalDecision };
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
