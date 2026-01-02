import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 8080;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* middlewares */
app.use(express.json());


app.use(express.static(path.join(__dirname, "public")));

/* API status */
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    time: Date.now()
  });
});

/* admin test endpoint */
app.post("/api/admin/access", (req, res) => {
  res.json({
    ok: true,
    message: "ADMIN ACCESS ENDPOINT REACHED",
    body: req.body || {},
    time: Date.now()
  });
});

/* start server */
app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER STARTED ON PORT", PORT);
});
