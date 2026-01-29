import express from "express";
import { createTSL } from "../tsl.observe.js";

const router = express.Router();

router.use(
  express.raw({
    type: "application/octet-stream",
    limit: "1mb"
  })
);

const tsl = createTSL();

router.post("/observe", (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "RAW_BYTES_REQUIRED" });
    }

    const input = Uint8Array.from(req.body);
    const result = tsl.observe(input);

    return res.json(result);

  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/reset", (_req, res) => {
  tsl.reset();
  res.json({ ok: true });
});

export default router;
