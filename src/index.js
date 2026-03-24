import express from "express";
import cors from "cors";

import flowRouter            from "./api/flow.js";
import visionageRoute        from "./api/visionage.route.js";
import visionageTrackRoute   from "./api/visionage-track.route.js";
import blackHoleRoute        from "./api/visionage-black-hole.route.js";

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
origin: [
"https://diginetz-template.com",
"https://www.diginetz-template.com"
],
methods: ["GET", "POST", "OPTIONS"],
allowedHeaders: [
"Content-Type",
"x-reference-id"
]
}));

app.use(express.json({ limit: "10mb" }));

app.use(express.raw({
type: "application/octet-stream",
limit: "1mb"
}));

app.use(express.static("public"));

app.use("/api/flow",            flowRouter);
app.use("/api/visionage",       visionageRoute);
app.use("/api/visionage-track", visionageTrackRoute);
app.use("/api/black-hole",      blackHoleRoute);

app.get("/", (_req, res) => {
res.json({
service: "DigiNetz TSL Core",
engine:  "TSL",
status:  "RUNNING"
});
});

app.get("/health", (_req, res) => {
res.status(200).json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
console.log("TSL CORE API RUNNING ON PORT " + PORT);
});
