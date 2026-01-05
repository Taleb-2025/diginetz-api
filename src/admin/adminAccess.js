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

/* 🟢 نافذة القبول الواقعية */
const THRESHOLDS = {
  STRONG: {
    density: 0.01,
    appearance: 0.01
  },
  WEAK: {
    density: 0.05,
    appearance: 0.05
  }
};

/* 🧠 معامل التعلم */
const ADAPT_RATE = 0.1;

/* ---------- Reference IO ---------- */

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

/* ---------- Utility ---------- */

function abs(v) {
  return Math.abs(v);
}

/* 🧠 دمج مرجعي تدريجي */
function adaptReference(oldRef, probeRef, rate) {
  if (typeof oldRef !== "object") return probeRef;

  const adapted = {};
  for (const key in probeRef) {
    adapted[key] =
      oldRef[key] * (1 - rate) + probeRef[key] * rate;
  }
  return adapted;
}

/* ---------- Decision Gate ---------- */

function decisionGate(salDecision, delta) {
  if (salDecision !== "ALLOW") return "DENY";

  const dD = abs(delta.densityDelta);
  const dA = abs(delta.appearanceDelta);

  if (
    dD < THRESHOLDS.STRONG.density &&
    dA < THRESHOLDS.STRONG.appearance
  ) {
    return "ALLOW";
  }

  if (
    dD < THRESHOLDS.WEAK.density &&
    dA < THRESHOLDS.WEAK.appearance
  ) {
    return "ALLOW_UPDATE";
  }

  return "DENY";
}

/* ---------- Route ---------- */

router.post("/guard", (req, res) => {
  const { secret } = req.body;

  if (typeof secret !== "string" || !secret.length) {
    return res.status(400).json({ ok: false, error: "SECRET_REQUIRED" });
  }

  const storedRef = loadRef();

  const result = ae.guard(
    () => {
      /* 🟡 INIT PHASE */
      if (!storedRef) {
        const S = ndrd.extract(secret);
        const A = ndrd.activate(S);
        saveRef(A);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      /* 🔵 ACCESS PHASE */
      const probeS = ndrd.extract(secret);
      const probeA = ndrd.activate(probeS);

      /* ❗ لا نعيد activate المرجع */
      const delta = ndrd.derive(
        storedRef,
        probeA
      );

      const trace = sts.observe(ndrd.encode(secret));

      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      const gateDecision = decisionGate(salDecision, delta);

      /* 🧠 تحديث المرجع عند القبول الجزئي */
      if (gateDecision === "ALLOW_UPDATE") {
        const newRef = adaptReference(
          storedRef,
          probeA,
          ADAPT_RATE
        );
        saveRef(newRef);
      }

      return {
        phase: "ACCESS",
        decision: gateDecision
      };
    },
    {
      name: "ADMIN_STRUCTURAL_ACCESS",
      expectEffect: () => true
    }
  );

  /* ---------- Final Enforcement ---------- */

  if (result.report.securityFlag !== "OK") {
    return res.status(403).json({ ok: false, access: "DENIED" });
  }

  if (
    result.result.decision !== "ALLOW" &&
    result.result.decision !== "ALLOW_UPDATE"
  ) {
    return res.status(403).json({ ok: false, access: "DENIED" });
  }

  return res.json({
    ok: true,
    access: "GRANTED",
    phase: result.result.phase,
    mode: result.result.decision
  });
});

export default router;
