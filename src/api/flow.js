import express from "express";
import { createTSL } from "../runtime/tsl.observe.js";
import { TSL_StructuralAnalyzer } from "../analysis/TSL_StructuralAnalyzer.js";

const router = express.Router();

/* ========= RAW BYTES ONLY ========= */
router.use(
  express.raw({
    type: "application/octet-stream",
    limit: "1mb"
  })
);

/* ========= TSL RUNTIME ========= */
const tsl = createTSL();
const analyzer = new TSL_StructuralAnalyzer();

/* ========= HISTORY BUFFER ========= */
const flowHistory = [];

/* ========= OBSERVE ========= */
router.post("/observe", (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        error: "RAW_BYTES_REQUIRED"
      });
    }

    const bytes = Uint8Array.from(req.body);
    const result = tsl.observe(bytes);

    flowHistory.push(result);

    return res.json(result);

  } catch (err) {
    return res.status(400).json({
      error: err.message
    });
  }
});

/* ========= HISTORY ========= */
router.get("/history", (_req, res) => {
  res.json({
    ok: true,
    history: flowHistory
  });
});

/* ========= ANALYSIS ========= */
router.get("/analysis", (_req, res) => {
  const analysis = flowHistory.map(r => analyzer.analyze(r));

  res.json({
    ok: true,
    history: flowHistory,
    analysis
  });
});

/* ========= RESET ========= */
router.post("/reset", (_req, res) => {
  tsl.reset();
  flowHistory.length = 0;
  res.json({ ok: true });
});

export default router;
