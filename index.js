import express from "express";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "OK",
    service: "DigiNetz API",
    message: "API is running"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    time: Date.now()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
