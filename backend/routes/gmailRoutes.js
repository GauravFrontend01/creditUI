const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getGmailAuthUrl,
  gmailOAuthCallback,
  getGmailStatus,
  disconnectGmail,
  syncGmail,
  resetGmailSync,
  listGmailCandidates,
  syncGmailSelected,
  previewGmailPdf,
} = require('../controllers/gmailController');

router.get('/auth-url', protect, getGmailAuthUrl);
router.get('/oauth/callback', gmailOAuthCallback);
router.get('/status', protect, getGmailStatus);
router.post('/disconnect', protect, disconnectGmail);
router.get('/candidates', protect, listGmailCandidates);
router.post('/sync-selected', protect, syncGmailSelected);
router.post('/sync', protect, syncGmail);
router.post('/reset', protect, resetGmailSync);
router.post('/preview-unlocked', protect, previewGmailPdf);

module.exports = router;
