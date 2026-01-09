// src/index.js
import express from "express";
import flowRouter from "./api/flow.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// واجهة تشغيل محركات TSL
app.use("/api/flow", flowRouter);

// Health check بسيط فقط
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
