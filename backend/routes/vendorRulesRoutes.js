const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getVendorRules, upsertVendorRule } = require('../controllers/vendorRulesController');

router.get('/', protect, getVendorRules);
router.post('/', protect, upsertVendorRule);

module.exports = router;
