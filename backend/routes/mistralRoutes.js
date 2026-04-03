const express = require('express');
const router = express.Router();
const multer = require('multer');
const mistralController = require('../controllers/mistralController');
const { protect } = require('../middleware/authMiddleware');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/ocr', protect, upload.single('pdf'), mistralController.processMistralOCR);

module.exports = router;
