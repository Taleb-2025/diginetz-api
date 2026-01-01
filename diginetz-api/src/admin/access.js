// ==========================================================
// diginetz-api :: Internal Admin Access Endpoint
// STEP 1 — Endpoint only (no security logic yet)
// ==========================================================

import express from "express";

const router = express.Router();

// ----------------------------------------------------------
// POST /admin/access
// ----------------------------------------------------------
router.post("/access", (req, res) => {

  const { secret } = req.body;

  // Step 1 purpose:
  // - Endpoint exists
  // - Accepts input
  // - Does NOT validate meaning
  // - Does NOT decide access yet

  if (!secret) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  return res.status(200).json({
    ok: true,
    message: "ADMIN_ACCESS_ENDPOINT_REACHED",
    received: true
  });
});

export default router;
