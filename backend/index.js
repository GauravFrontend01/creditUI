const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const userRoutes = require('./routes/userRoutes');
const statementRoutes = require('./routes/statementRoutes');
const gmailRoutes = require('./routes/gmailRoutes');

const app = express();

// CORS must run before routes. Requests with `Authorization` trigger a preflight OPTIONS;
// reflect the request origin so localhost:5173 ↔ localhost:5001 works in dev.
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/users', userRoutes);
app.use('/api/statements', statementRoutes);
app.use('/api/gmail', gmailRoutes);

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
