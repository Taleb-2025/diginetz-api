import express from "express";

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

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("DigiNetz API running on port " + PORT);
});