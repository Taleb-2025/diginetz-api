import express from "express";

const app = express();

/* middlewares */
app.use(express.json());

/* home */
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Diginetz API</title>
      <link
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
        rel="stylesheet"
      />
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

/* api status */
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    time: Date.now()
  });
});

/* admin access (placeholder) */
app.post("/api/admin/access", (req, res) => {
  res.json({
    ok: true,
    message: "ADMIN ACCESS ENDPOINT REACHED",
    time: Date.now()
  });
});

/* start server */
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER STARTED ON PORT", PORT);
});
