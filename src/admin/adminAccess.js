import express from "express";
import fs from "fs";
import path from "path";

import { TSL_NDR_D } from "../engines/TSL_NDR_D.js";
import { TSL_AE } from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();

/* -------- Engines -------- */

const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();
const sts  = new TSL_STS({ expected: { density: 0, drift: 0 } });
const sal  = new TSL_SAL();

/* -------- Storage -------- */

const DATA_DIR = "/data";
const REF_FILE = path.join(DATA_DIR, "admin.reference.json");

/* -------- Thresholds -------- */

const STRUCTURE_THRESHOLD = {
  density: 0.05,
  appearance: 0.05
};

/* -------- Reference IO -------- */

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

/* -------- Decision Gate -------- */

function structureMatch(delta) {
  return (
    Math.abs(delta.densityDelta) < STRUCTURE_THRESHOLD.density &&
    Math.abs(delta.appearanceDelta) < STRUCTURE_THRESHOLD.appearance
  );
}

/* -------- Route -------- */

router.post("/guard", (req, res) => {
  const { secret } = req.body;

  if (typeof secret !== "string" || !secret.length) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const storedStructure = loadRef();

  const result = ae.guard(
    () => {

      /* ---------- INIT ---------- */
      if (!storedStructure) {
        const structure = ndrd.extract(secret);

        saveRef(structure);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      /* ---------- ACCESS ---------- */

      // 1️⃣ Extract deterministic structure
      const probeStructure = ndrd.extract(secret);

      // 2️⃣ Structural delta (stable space)
      const delta = ndrd.derive(
        storedStructure,
        probeStructure
      );

      // 3️⃣ Behavioral trace (dynamic)
      const trace = sts.observe(
        ndrd.encode(secret)
      );

      // 4️⃣ High-level decision
      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      // 5️⃣ Final gate
      if (salDecision !== "ALLOW") {
        return {
          phase: "ACCESS",
          decision: "DENY"
        };
      }

      if (!structureMatch(delta)) {
        return {
          phase: "ACCESS",
          decision: "DENY"
        };
      }

      return {
        phase: "ACCESS",
        decision: "ALLOW"
      };
    },
    {
      name: "ADMIN_STRUCTURAL_ACCESS",
      expectEffect: () => true
    }
  );

  /* -------- Enforcement -------- */

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
