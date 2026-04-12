const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createStatement, getMyStatements, getStatementById, deleteStatement, approveStatement, deleteManyStatements, reprocessStatement, reIngestStatement, downloadUnlockedPdf } = require('../controllers/statementController');
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

// POST: multipart/form-data  fields: pdf (file), data (JSON string), pdfPassword (string)
router.post('/', protect, upload.single('pdf'), createStatement);
router.put('/:id/approve', protect, approveStatement);
router.get('/', protect, getMyStatements);
router.get('/:id', protect, getStatementById);
router.delete('/:id', protect, deleteStatement);
router.post('/bulk-delete', protect, deleteManyStatements);
router.post('/:id/reprocess', protect, reprocessStatement);
router.post('/:id/re-ingest', protect, reIngestStatement);
router.get('/:id/download-unlocked', protect, downloadUnlockedPdf);

module.exports = router;
