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

  const S = ndrd.extract(secret);

  ADMIN_STRUCTURE = S;
  ADMIN_BOUND = true;

  return res.json({
    ok: true,
    message: "ADMIN_BOUND_SUCCESSFULLY"
  });
});
