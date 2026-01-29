import express from "express";
import { createTSL } from "../runtime/tsl.observe.js";

const router = express.Router();

/* ========= RAW BYTES ONLY ========= */
router.use(
  express.raw({
    type: "application/octet-stream",
    limit: "1mb"
  })
);

/* ========= TSL RUNTIME (واحد فقط) ========= */
const tsl = createTSL();

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

    return res.json(result);

  } catch (err) {
    return res.status(400).json({
      error: err.message
    });
  }
});

/* ========= RESET ========= */
router.post("/reset", (_req, res) => {
  tsl.reset();
  res.json({ ok: true });
});

export default router;
