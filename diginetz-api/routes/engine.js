import { stepEngine } from "../core/diginetz-engine.js";

export function engineRoute(req, res) {
  const result = stepEngine(req.body);
  res.json(result);
}