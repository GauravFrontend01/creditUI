const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createStatement, getMyStatements, getStatementById } = require('../controllers/statementController');
const { protect } = require('../middleware/authMiddleware');

// Store PDF in memory buffer (we stream it directly to Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// POST: multipart/form-data fields: pdf (file), pdfPassword (string), statementType
router.post('/', protect, upload.single('pdf'), createStatement);
router.get('/', protect, getMyStatements);
router.get('/:id', protect, getStatementById);

module.exports = router;
