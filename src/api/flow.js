import express from "express";
import { createTSL } from "../runtime/tsl.observe.js";
import { TSL_StructuralAnalyzer } from "../analysis/TSL_StructuralAnalyzer.js";

const router = express.Router();

router.use(
  express.raw({
    type: "application/octet-stream",
    limit: "1mb"
  })
);

const tsl = createTSL({
  structure: [
    {
      building: [
        "FLOW_INIT",
        "FLOW_ACTIVE",
        "FLOW_STABLE",
        "FLOW_RISING",
        "FLOW_FALLING",
        "FLOW_SPIKE",
        "FLOW_PATTERN",
        "FLOW_ANOMALY",
        "FLOW_IDLE"
      ],
      boundary: "FLOW_PEAK",
      stair: [],
      transitions: {
        "FLOW_INIT":    { next: "FLOW_ACTIVE",  type: ["start"]    },
        "FLOW_ACTIVE":  { next: "FLOW_STABLE",  type: ["normal"]   },
        "FLOW_STABLE":  { next: "FLOW_STABLE",  type: ["normal"]   },
        "FLOW_RISING":  { next: "FLOW_SPIKE",   type: ["increase"] },
        "FLOW_FALLING": { next: "FLOW_STABLE",  type: ["decrease"] },
        "FLOW_SPIKE":   { next: "FLOW_PEAK",    type: ["critical"] },
        "FLOW_PATTERN": { next: "FLOW_ACTIVE",  type: ["pattern"]  },
        "FLOW_ANOMALY": { next: "FLOW_PEAK",    type: ["anomaly"]  },
        "FLOW_IDLE":    { next: "FLOW_INIT",    type: ["reset"]    },
        "FLOW_PEAK":    { next: "FLOW_INIT",    type: ["boundary"] }
      }
    }
  ]
});

const analyzer = new TSL_StructuralAnalyzer();
const flowHistory = [];

router.post("/observe", (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "RAW_BYTES_REQUIRED" });
    }

    const bytes = Uint8Array.from(req.body);
    const result = tsl.observe(bytes);

    flowHistory.push(result);
    if (flowHistory.length > 1000) flowHistory.shift();

    return res.json(result);

  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/history", (_req, res) => {
  res.json({ ok: true, history: flowHistory });
});

router.get("/analysis", (_req, res) => {
  const analysis = flowHistory.map(r => analyzer.analyze(r));
  res.json({ ok: true, history: flowHistory, analysis });
});

router.post("/reset", (_req, res) => {
  tsl.reset();
  flowHistory.length = 0;
  res.json({ ok: true });
});

export default router;
