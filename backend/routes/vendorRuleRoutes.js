const express = require('express');
const router = express.Router();
const { saveVendorRule, getVendorRules } = require('../controllers/vendorRuleController');
const { protect } = require('../middleware/authMiddleware');

router.route('/').get(protect, getVendorRules).post(protect, saveVendorRule);

module.exports = router;
