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

  const probeStructure = ndrd.extract(secret);

  const A = ndrd.activate(ADMIN_STRUCTURE);
  const B = ndrd.activate(probeStructure);

  const delta = ndrd.derive(A, B);
  const allowed = ndrd.validate(delta);

  if (!allowed) {
    return res.status(403).json({
      ok: false,
      access: "DENIED",
      reason: "STRUCTURE_MISMATCH"
    });
  }

  return res.json({
    ok: true,
    access: "GRANTED"
  });
});
