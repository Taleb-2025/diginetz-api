import express from "express";
import cors from "cors";
import tslRouter from "./api/tsl/containment.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: [
    "https://diginetz-template.com",
    "https://www.diginetz-template.com"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

app.use("/api/tsl", tslRouter);

app.get("/", (req, res) => {
  res.json({
    service: "DigiNetz TSL Core",
    engine: "TSL",
    status: "RUNNING"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TSL CORE API RUNNING ON PORT ${PORT}`);
});
