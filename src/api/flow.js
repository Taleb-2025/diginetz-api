// diginetz-api/src/api/flow.js
import express from "express";

import { DefaultTSLAdapter } from "../adapters/tsl-input-adapter.js";
import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_Interpreter } from "../interpret/TSL_Interpreter.js";

const router = express.Router();

/* =====================================================
   RAW BYTES ONLY
   ===================================================== */
router.use(
  express.raw({
    type: "application/octet-stream",
    limit: "1mb"
  })
);

/* ================= CORE ================= */

const adapter     = new DefaultTSLAdapter();
const ndr         = new TSL_NDR();
const d           = new TSL_D();
const interpreter = new TSL_Interpreter();

/* ================= RUNTIME MEMORY ================= */
// هذا هو “المرجع” الوحيد
let prevStructure = null;

/* ================= OBSERVE ================= */

router.post("/observe", (req, res) => {
  try {
    // ✅ التعديل هنا فقط
    if (!req.body || typeof req.body.length !== "number") {
      return res.status(400).json({
        ok: false,
        error: "RAW_BYTES_REQUIRED"
      });
    }

    const bytes     = Uint8Array.from(req.body);
    const adapted   = adapter.adapt(bytes);
    const structure = ndr.extract(adapted);

    // أول حدث: لا مقارنة
    if (!prevStructure) {
      prevStructure = structure;
      return res.json({
        ok: true,
        phase: "FIRST_EVENT",
        structure
      });
    }

    // دلتا بنيوية فقط
    const delta = d.derive(prevStructure, structure);

    // تفسير بدون قرار
    const interpretation = interpreter.interpret({ delta });

    // النسيان: استبدال المرجع
    prevStructure = structure;

    return res.json({
      ok: true,
      phase: "DELTA_EVENT",
      delta,
      interpretation
    });

  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

/* ================= RESET (OPTIONAL) ================= */

router.post("/reset", (_req, res) => {
  prevStructure = null;
  res.json({ ok: true, state: "CLEARED" });
});

export default router;
