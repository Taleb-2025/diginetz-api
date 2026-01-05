import express from "express";
import fs from "fs";
import path from "path";

import { TSL_NDR_D } from "../engines/TSL_NDR_D.js";
import { TSL_AE } from "./TSL_AE.js";
import { TSL_STS } from "./TSL_STS.js";
import { TSL_SAL } from "./TSL_SAL.js";

const router = express.Router();

/* ---------- Engines ---------- */

const ndrd = new TSL_NDR_D();
const ae   = new TSL_AE();
const sts  = new TSL_STS({ expected: { density: 0, drift: 0 } });
const sal  = new TSL_SAL();

/* ---------- Storage ---------- */

const DATA_DIR = "/data";
const REF_FILE = path.join(DATA_DIR, "admin.reference.json");

/* ---------- Parameters ---------- */

// 🔼 رفع العتبة قليلًا للسماح بالضجيج الطبيعي
const ACCEPTANCE_THRESHOLD = 0.30;

// معدل التعلّم (Exponential Moving Average)
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

/* ---------- Math Utilities ---------- */

// حساب مسافة مُطبَّعة بين البنية الحالية والمرجع
function normalizedDistance(delta) {
  const d = Math.abs(delta.densityDelta);
  const a = Math.abs(delta.appearanceDelta);

  // تطبيع إلى المجال [0 .. 1]
  return Math.min(1, (d + a) / 2);
}

// تحديث المرجع (تعلم تدريجي)
function updateReference(oldRef, newRef, rate) {
  const updated = {};
  for (const key in newRef) {
    updated[key] =
      oldRef[key] * (1 - rate) + newRef[key] * rate;
  }
  return updated;
}

/* ---------- Route ---------- */

router.post("/guard", (req, res) => {
  const { secret } = req.body;

  if (typeof secret !== "string" || !secret.length) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const storedRef = loadRef();

  const result = ae.guard(
    () => {

      /* ---------- INIT PHASE ---------- */
      if (!storedRef) {
        const structure = ndrd.extract(secret);
        saveRef(structure);

        return {
          phase: "INIT",
          decision: "ALLOW"
        };
      }

      /* ---------- ACCESS PHASE ---------- */

      // 1) استخراج بنية حالية (noisy)
      const probeStructure = ndrd.extract(secret);

      // 2) اشتقاق الفرق البنيوي
      const delta = ndrd.derive(
        storedRef,
        probeStructure
      );

      // 3) تحويل الفرق إلى مسافة مُطبَّعة
      const distance = normalizedDistance(delta);

      // 4) مراقبة السلوك الزمني
      const trace = sts.observe(
        ndrd.encode(secret)
      );

      // 5) قرار SAL
      const salDecision = sal.decide({
        structure: delta,
        trace,
        execution: false
      });

      if (salDecision !== "ALLOW") {
        return {
          phase: "ACCESS",
          decision: "DENY"
        };
      }

      // 6) قرار نهائي بالمسافة
      if (distance > ACCEPTANCE_THRESHOLD) {
        return {
          phase: "ACCESS",
          decision: "DENY"
        };
      }

      // 7) تحديث المرجع (تعلم بطيء وآمن)
      const updatedRef = updateReference(
        storedRef,
        probeStructure,
        ADAPT_RATE
      );
      saveRef(updatedRef);

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

  /* ---------- Enforcement ---------- */

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
