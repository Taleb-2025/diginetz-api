import express from "express";

const app = express();

const PORT = process.env.PORT;

app.get("/", (req, res) => {
  res.send("API IS RUNNING");
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    time: Date.now()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER STARTED ON PORT", PORT);
});
