import express from "express";
import cors from "cors";
import flowRouter from "./api/flow.js";

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

app.use("/api/flow", flowRouter);

app.get("/", (req, res) => {
  res.json({
    service: "DigiNetz TSL Core",
    status: "RUNNING",
    time: Date.now()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("TSL CORE API RUNNING ON PORT", PORT);
});
