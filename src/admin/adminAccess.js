import express from "express";
import { TSL_AE } from "./TSL_AE.js";

const router = express.Router();
const tsl = new TSL_AE();

let ADMIN_BOUND = false;
let ADMIN_SECRET_HASH = null;

function fingerprint(secret) {
  return Buffer.from(secret, "utf8").toString("base64");
}

router.post("/init", (req, res) => {
  if (ADMIN_BOUND) {
    return res.status(403).json({
      ok: false,
      error: "ADMIN_ALREADY_BOUND"
    });
  }

  const { secret } = req.body;

  if (!secret || typeof secret !== "string") {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const { report } = tsl.guard(
    () => {
      ADMIN_SECRET_HASH = fingerprint(secret);
      ADMIN_BOUND = true;
      return true;
    },
    {
      name: "ADMIN_INIT",
      expectEffect: () => true
    },
    { phase: "init" }
  );

  if (report.securityFlag !== "OK") {
    return res.status(403).json({
      ok: false,
      error: "INIT_BLOCKED",
      report
    });
  }

  return res.json({
    ok: true,
    message: "ADMIN_BOUND_SUCCESSFULLY",
    report
  });
});

router.post("/access", (req, res) => {
  if (!ADMIN_BOUND || !ADMIN_SECRET_HASH) {
    return res.status(403).json({
      ok: false,
      error: "ADMIN_NOT_INITIALIZED"
    });
  }

  const { secret } = req.body;

  if (!secret || typeof secret !== "string") {
    return res.status(400).json({
      ok: false,
      error: "SECRET_REQUIRED"
    });
  }

  const { report } = tsl.guard(
    () => {
      const incoming = fingerprint(secret);

      if (incoming !== ADMIN_SECRET_HASH) {
        throw new Error("SECRET_MISMATCH");
      }

      return true;
    },
    {
      name: "ADMIN_ACCESS",
      expectEffect: () => true
    },
    { phase: "access" }
  );

  if (report.securityFlag !== "OK") {
    return res.status(403).json({
      ok: false,
      access: "DENIED",
      report
    });
  }

  return res.json({
    ok: true,
    access: "GRANTED",
    report
  });
});

export default router;
