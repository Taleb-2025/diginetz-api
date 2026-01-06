و هذا 

// --- simple in-memory lock ---
let refLock = false;
let cachedRef = loadRef();

/* ---------- Safer Distance ---------- */
function normalizedDistance(delta) {
  const d = Math.min(1, Math.abs(delta.densityDelta));
  const a = Math.min(1, Math.abs(delta.appearanceDelta));
  return 0.6 * d + 0.4 * a;
}

/* ---------- Safe Reference Update ---------- */
function safeUpdateReference(oldRef, newRef, rate) {
  const updated = {};
  for (const key in oldRef) {
    if (typeof oldRef[key] === "number" &&
        typeof newRef[key] === "number") {
      updated[key] =
        oldRef[key] * (1 - rate) + newRef[key] * rate;
    } else {
      updated[key] = oldRef[key];
    }
  }
  return updated;
}

router.post("/guard", async (req, res) => {
  const { secret, initToken } = req.body;

  if (typeof secret !== "string" || !secret.length) {
    return res.status(400).json({ ok: false });
  }

  const result = ae.guard(() => {

    /* ---------- INIT (protected) ---------- */
    if (!cachedRef) {
      if (initToken !== process.env.INIT_TOKEN) {
        return { phase: "INIT", decision: "DENY" };
      }

      const structure = ndrd.extract(secret);
      cachedRef = structure;
      saveRef(structure);

      return { phase: "INIT", decision: "ALLOW" };
    }

    /* ---------- ACCESS ---------- */
    const probe = ndrd.extract(secret);
    const delta = ndrd.derive(cachedRef, probe);
    const distance = normalizedDistance(delta);
    const trace = sts.observe(ndrd.encode(secret));

    const salDecision = sal.decide({
      structure: delta,
      trace,
      execution: false
    });

    if (salDecision !== "ALLOW") {
      return { phase: "ACCESS", decision: "DENY" };
    }

    if (distance > ACCEPTANCE_THRESHOLD) {
      return { phase: "ACCESS", decision: "DENY" };
    }

    // Learn only if very safe
    if (distance < ACCEPTANCE_THRESHOLD * 0.5 && !refLock) {
      refLock = true;
      cachedRef = safeUpdateReference(
        cachedRef,
        probe,
        ADAPT_RATE
      );
      saveRef(cachedRef);
      refLock = false;
    }

    return { phase: "ACCESS", decision: "ALLOW" };
  });

  if (
    result.report.securityFlag !== "OK" ||
    result.result.decision !== "ALLOW"
  ) {
    return res.status(403).json({ ok: false });
  }

  res.json({
    ok: true,
    access: "GRANTED",
    phase: result.result.phase
  });
});
