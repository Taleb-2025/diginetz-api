const express = require('express');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'DigiNetz API is running 🚀'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});