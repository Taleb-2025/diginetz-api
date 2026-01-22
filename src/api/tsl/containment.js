import express from "express";
import { createTSLGuardSDK } from "../../guard/tsl.guard.js";

const router = express.Router();

/* ================= ORIGINAL LOGIC (UNCHANGED) ================= */

function buildStructure(samples) {
  const transitions = [];
  const runs = [];

  for (let i = 1; i < samples.length; i++) {
    const d = samples[i] - samples[i - 1];
    if (d > 0) transitions.push("+");
    else if (d < 0) transitions.push("-");
    else transitions.push("=");
  }

  let current = transitions[0];
  let count = 1;

  for (let i = 1; i < transitions.length; i++) {
    if (transitions[i] === current) {
      count++;
    } else {
      runs.push(`${current}${count}`);
      current = transitions[i];
      count = 1;
    }
  }

  if (current) runs.push(`${current}${count}`);

  return {
    length: samples.length,
    transitionSignature: transitions.join(""),
    runSignature: runs.join("|"),
    complexity: runs.length
  };
}

function containmentDecision(S0, S1) {
  if (S0.length !== S1.length) {
    return { state: "BROKEN", reason: "LENGTH_MISMATCH" };
  }

  if (!S0.transitionSignature.includes(S1.transitionSignature)) {
    return { state: "BROKEN", reason: "TRANSITION_BROKEN" };
  }

  if (S1.complexity > S0.complexity) {
    return { state: "BROKEN", reason: "COMPLEXITY_EXCEEDED" };
  }

  if (
    S0.transitionSignature === S1.transitionSignature &&
    S0.runSignature === S1.runSignature
  ) {
    return { state: "MATCH", reason: "EXACT_STRUCTURAL_MATCH" };
  }

  return { state: "CONTAINED", reason: "STRUCTURAL_CONTAINMENT" };
}

/* ================= TSL GUARD INJECTION ================= */

/* runtime state placeholder (stateful but isolated per API instance) */
const runtimeState = {};

/* guarded engine (wraps existing logic – does NOT replace it) */
const tslGuard = createTSLGuardSDK({
  decision: containmentDecision,
  rv: runtimeState
});

/* ================= API ROUTE (SAME ENDPOINT) ================= */

router.post("/containment", (req, res) => {
  const { reference, test } = req.body;

  if (!Array.isArray(reference) || !Array.isArray(test)) {
    return res.status(400).json({ error: "INVALID_INPUT" });
  }

  if (reference.length < 2 || test.length < 2) {
    return res.status(400).json({ error: "SIGNAL_TOO_SHORT" });
  }

  /* ---------- Guarded Execution ---------- */

  const S0 = tslGuard.init(reference);
  const S1 = tslGuard.execute(test);

  /* ---------- Fallback to Original Structure Output ---------- */
  /* (kept to preserve existing API contract) */

  const S0_struct = buildStructure(reference);
  const S1_struct = buildStructure(test);
  const decision = containmentDecision(S0_struct, S1_struct);

  res.json({
    engine: "TSL",
    S0: S0_struct,
    S1: S1_struct,
    decision
  });
});

export default router;
