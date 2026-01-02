import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";

import adminAccessRouter from "./admin/adminAccess.js";

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || "DEV_SECRET_ONLY";

const allowedOrigins = [
  "https://diginetz-template.com",
  "https://www.diginetz-template.com",
  "http://localhost:3000"
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS_BLOCKED"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json());

app.use("/api/admin", adminAccessRouter);

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Diginetz API</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet"/>
    </head>
    <body class="bg-light">
      <div class="container mt-5">
        <div class="card shadow">
          <div class="card-body text-center">
            <h1 class="text-success">API IS RUNNING</h1>
            <p class="lead">Diginetz Backend</p>
            <a href="/api/status" class="btn btn-primary">API Status</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get("/api/status", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (email !== "admin@diginetz.com" || password !== "123456") {
    return res.status(401).json({ ok: false, message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { email, role: "admin" },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({ ok: true, token });
});

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ ok: false, message: "No token" });
  }

  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ ok: false, message: "Invalid token" });
  }
}

app.get("/api/me", auth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER STARTED ON PORT", PORT);
});
