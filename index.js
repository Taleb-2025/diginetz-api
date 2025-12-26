const express = require("express");
const app = express();

// Middleware لتحويل JSON
app.use(express.json());

// المنفذ (Railway يفرض PORT تلقائياً)
const PORT = process.env.PORT || 3000;

// الصفحة الرئيسية (لتفادي Not Found)
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    service: "DigiNetz API",
    message: "API is running successfully 🚀"
  });
});

// مثال Endpoint API (اختياري – للاختبار)
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime()
  });
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 DigiNetz API running on port ${PORT}`);
});
