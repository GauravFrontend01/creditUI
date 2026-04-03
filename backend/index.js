const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const userRoutes = require('./routes/userRoutes');
const statementRoutes = require('./routes/statementRoutes');
const vendorRuleRoutes = require('./routes/vendorRuleRoutes');
const ocrRoutes = require('./routes/ocrRoutes');
const mistralRoutes = require('./routes/mistralRoutes');

const app = express();

app.use(express.json());
app.use(cors());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/statements', statementRoutes);
app.use('/api/vendor-rules', vendorRuleRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/mistral', mistralRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Connect to DB and Start Server
const PORT = process.env.PORT || 5001;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
