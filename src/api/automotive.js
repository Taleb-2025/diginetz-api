
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

/*
  Automotive Adapter
  ------------------
  - Receives raw vehicle data from browser
  - Normalizes it into a structural string
  - Forwards it to TSL Core (flow.js)
*/

const TSL_CORE_URL = process.env.TSL_CORE_URL || "http://localhost:8080/api/flow";

/* ---------- normalize raw stream ---------- */
function normalizeRawStream(raw) {
  if (!raw || typeof raw !== "string") return "";

  // Minimal, deterministic normalization
  // No parsing, no decoding, no storage
  return raw
    .replace(/\s+/g, "")
    .slice(0, 4096); // hard safety limit
}

/* ---------- INIT reference ---------- */
router.post("/init", async (req, res) => {
  const { rawStream } = req.body;

  const input = normalizeRawStream(rawStream);

  if (!input) {
    return res.status(400).json({
      ok: false,
      reason: "INVALID_RAW_STREAM"
    });
  }

  try {
    const r = await fetch(`${TSL_CORE_URL}/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });

    const data = await r.json();
    return res.status(r.status).json(data);

  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "TSL_CORE_UNREACHABLE",
      error: String(err)
    });
  }
});

/* ---------- EXECUTE comparison ---------- */
router.post("/execute", async (req, res) => {
  const { rawStream } = req.body;

  const input = normalizeRawStream(rawStream);

  if (!input) {
    return res.status(400).json({
      ok: false,
      reason: "INVALID_RAW_STREAM"
    });
  }

  try {
    const r = await fetch(`${TSL_CORE_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });

    const data = await r.json();
    return res.status(r.status).json(data);

  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "TSL_CORE_UNREACHABLE",
      error: String(err)
    });
  }
});

export default router;
