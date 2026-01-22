import express from "express";

const router = express.Router();

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
    if (transitions[i] === current) count++;
    else {
      runs.push(`${current}${count}`);
      current = transitions[i];
      count = 1;
    }
  }

  runs.push(`${current}${count}`);

  return {
    length: samples.length,
    transitionSignature: transitions.join(""),
    runSignature: runs.join("|"),
    complexity: runs.length
  };
}

function containmentDecision(S0, S1) {
  if (S1.length !== S0.length) {
    return { state: "BROKEN", reason: "LENGTH_MISMATCH" };
  }

  if (!S0.transitionSignature.includes(S1.transitionSignature)) {
    return { state: "BROKEN", reason: "TRANSITION_BREAK" };
  }

  if (S1.complexity > S0.complexity) {
    return { state: "BROKEN", reason: "COMPLEXITY_EXCEEDED" };
  }

  if (
    S1.transitionSignature === S0.transitionSignature &&
    S1.runSignature === S0.runSignature
  ) {
    return { state: "MATCH", reason: "STRUCTURAL_IDENTITY" };
  }

  return { state: "CONTAINED", reason: "STRUCTURAL_CONTAINMENT" };
}

router.post("/containment", (req, res) => {
  const { reference, test } = req.body;

  if (!reference || !test) {
    return res.status(400).json({
      error: "INVALID_INPUT"
    });
  }

  const decision = containmentDecision(reference, test);

  res.json({
    engine: "TSL",
    decision
  });
});

export default router;
