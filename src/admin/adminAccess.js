import express from "express";
import ndrd from "../TSL_AE.js";

const router = express.Router();

let ADMIN_BOUND = false;
let ADMIN_STRUCTURE = null;

router.post("/init", (req, res) => {
  if (ADMIN_BOUND) {
    return res.status(403).json({
      ok: false,
      error: "ADMIN_ALREADY_BOUND"
    });
  }

  const { secret } = req.body;
  if (!secret) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  ADMIN_STRUCTURE = ndrd.extract(secret);
  ADMIN_BOUND = true;

  res.json({
    ok: true,
    message: "ADMIN_BOUND_SUCCESSFULLY"
  });
});

router.post("/access", (req, res) => {
  if (!ADMIN_BOUND || !ADMIN_STRUCTURE) {
    return res.status(403).json({
      ok: false,
      error: "ADMIN_NOT_INITIALIZED"
    });
  }

  const { secret } = req.body;
  if (!secret) {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const probe = ndrd.extract(secret);
  const allowed = ndrd.verify(ADMIN_STRUCTURE, probe);

  if (!allowed) {
    return res.status(403).json({
      ok: false,
      access: "DENIED"
    });
  }

  res.json({
    ok: true,
    access: "GRANTED"
  });
});

export default router;
