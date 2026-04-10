const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getGmailAuthUrl,
  gmailOAuthCallback,
  getGmailStatus,
  disconnectGmail,
  syncGmail,
} = require('../controllers/gmailController');

router.get('/auth-url', protect, getGmailAuthUrl);
router.get('/oauth/callback', gmailOAuthCallback);
router.get('/status', protect, getGmailStatus);
router.post('/disconnect', protect, disconnectGmail);
router.post('/sync', protect, syncGmail);

module.exports = router;
