import express from "express";
import { TSL_AE } from "./TSL_AE.js";

const router = express.Router();
const tsl = new TSL_AE();

let ADMIN_BOUND = false;
let ADMIN_SECRET_HASH = null;

function fingerprint(secret) {
  return Buffer.from(secret).toString("base64");
}

router.post("/init", (req, res) => {
  try {
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

    const result = tsl.guard(
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

    if (result.report.securityFlag !== "OK") {
      return res.status(403).json({
        ok: false,
        error: "INIT_BLOCKED",
        report: result.report
      });
    }

    return res.json({
      ok: true,
      message: "ADMIN_BOUND_SUCCESSFULLY",
      report: result.report
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ADMIN_INIT_ERROR",
      details: String(err)
    });
  }
});

router.post("/access", (req, res) => {
  try {
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

    const result = tsl.guard(
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

    if (result.report.securityFlag !== "OK") {
      return res.status(403).json({
        ok: false,
        access: "DENIED",
        report: result.report
      });
    }

    return res.json({
      ok: true,
      access: "GRANTED",
      report: result.report
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ADMIN_ACCESS_ERROR",
      details: String(err)
    });
  }
});

export default router;
