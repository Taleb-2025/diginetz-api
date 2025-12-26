import express from "express";
import { runTSLAutomotive } from "./engines/tslAutomotive.js";
import { runTSLPlugins } from "./engines/tslPlugins.js";

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    service: "DigiNetz API",
    time: Date.now()
  });
});

app.post("/api/engines/tsl-automotive", (req, res) => {
  const result = runTSLAutomotive(req.body);
  res.json(result);
});

app.post("/api/engines/tsl-plugins", (req, res) => {
  const result = runTSLPlugins(req.body);
  res.json(result);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("DigiNetz API running on port " + PORT);
});
