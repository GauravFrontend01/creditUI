const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { protect } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

// Proxy route to Python OCR server
router.post('/got-ocr-2', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const pythonResponse = await axios.post('http://localhost:5002/ocr', form, {
      headers: {
        ...form.getHeaders(),
      },
    });

    res.json(pythonResponse.data);
  } catch (error) {
    console.error('OCR Backend Proxy Error:', error.message);
    res.status(500).json({
      message: 'Local GOT-OCR 2.0 server connection failed. Ensure it is running on port 5002.',
      error: error.message
    });
  }
});

module.exports = router;
