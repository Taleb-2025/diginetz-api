import express from "express";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Diginetz API</title>
  <link
    href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
    rel="stylesheet"
  />
</head>
<body class="bg-light">
  <div class="container mt-5">
    <div class="card shadow-lg">
      <div class="card-body text-center">
        <h1 class="text-success">API IS RUNNING</h1>
        <p class="lead">Diginetz Backend</p>
        <div class="d-flex justify-content-center gap-2 mt-3">
          <a href="/api/status" class="btn btn-primary">API Status</a>
          <button class="btn btn-outline-secondary" onclick="adminTest()">Admin Test</button>
        </div>
        <pre id="output" class="mt-4 text-start bg-dark text-light p-3 rounded" style="display:none;"></pre>
      </div>
    </div>
  </div>

  <script>
    async function adminTest() {
      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true })
      });
      const data = await res.json();
      const output = document.getElementById("output");
      output.style.display = "block";
      output.textContent = JSON.stringify(data, null, 2);
    }
  </script>
</body>
</html>
  `);
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    time: Date.now()
  });
});

app.post("/api/admin/access", (req, res) => {
  res.json({
    ok: true,
    message: "ADMIN ACCESS ENDPOINT REACHED",
    body: req.body,
    time: Date.now()
  });
});

const PORT = process.env.PORT;
app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER STARTED ON PORT", PORT);
});
