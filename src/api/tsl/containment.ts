import { Request, Response } from "express";

function requireToken(req: Request, res: Response): boolean {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid token" });
    return false;
  }
  const token = auth.replace("Bearer ", "").trim();
  if (token !== process.env.TSL_API_TOKEN) {
    res.status(403).json({ error: "Invalid token" });
    return false;
  }
  return true;
}

function parseSamples(input: any): number[] | null {
  if (!input || !Array.isArray(input.samples)) return null;
  const nums = input.samples
    .map((v: any) => Number(v))
    .filter((v: number) => !isNaN(v));
  return nums.length >= 2 ? nums : null;
}

function buildStructure(samples: number[]) {
  const transitions: string[] = [];
  const runs: string[] = [];

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

function containmentDecision(S0: any, S1: any) {
  if (S1.length !== S0.length) {
    return { state: "BROKEN", reason: "Length mismatch" };
  }
  if (!S0.transitionSignature.includes(S1.transitionSignature)) {
    return { state: "BROKEN", reason: "Transition pattern broken" };
  }
  if (S1.complexity > S0.complexity) {
    return { state: "BROKEN", reason: "Structural complexity exceeded" };
  }
  if (
    S1.transitionSignature === S0.transitionSignature &&
    S1.runSignature === S0.runSignature
  ) {
    return { state: "MATCH", reason: "Exact structural identity" };
  }
  return { state: "CONTAINED", reason: "Structural containment preserved" };
}

export async function tslContainment(req: Request, res: Response) {
  if (!requireToken(req, res)) return;

  const refSamples = parseSamples(req.body?.reference);
  const testSamples = parseSamples(req.body?.test);

  if (!refSamples || !testSamples) {
    res.status(400).json({ error: "Invalid input samples" });
    return;
  }

  const S0 = buildStructure(refSamples);
  const S1 = buildStructure(testSamples);
  const decision = containmentDecision(S0, S1);

  res.json({
    state: decision.state,
    reason: decision.reason,
    structure: { S0, S1 }
  });
}
