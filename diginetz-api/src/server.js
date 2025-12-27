import express from "express";
import { engines } from "./engines/index.js";

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
    engines: Object.keys(engines),
    time: Date.now()
  });
});

app.post("/api/engines/:engine", (req, res) => {
  const { engine } = req.params;

  if (!engines[engine]) {
    return res.status(404).json({ error: "Engine not found" });
  }

  const result = engines[engine](req.body);
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("DigiNetz API running on port " + PORT);
});
