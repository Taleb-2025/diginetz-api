function extract(secret) {
  if (typeof secret !== "string") {
    throw new Error("INVALID_SECRET");
  }

  return {
    length: secret.length,
    hash: Buffer.from(secret).toString("base64"),
    entropy: new Set(secret).size
  };
}

function activate(structure) {
  return {
    weight: structure.length * structure.entropy,
    fingerprint: structure.hash.slice(0, 16)
  };
}

function derive(A, B) {
  return {
    deltaWeight: Math.abs(A.weight - B.weight),
    sameFingerprint: A.fingerprint === B.fingerprint
  };
}

function validate(delta) {
  if (!delta.sameFingerprint) return false;
  if (delta.deltaWeight > 5) return false;
  return true;
}

export default {
  extract,
  activate,
  derive,
  validate
};
