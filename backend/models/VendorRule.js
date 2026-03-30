const mongoose = require('mongoose');

const vendorRuleSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  merchantName: {
    type: String,
    required: true,
    index: true,
  },
  category: {
    type: String,
    required: true,
  },
}, { timestamps: true });

// Ensure a user only has one rule per merchant
vendorRuleSchema.index({ user: 1, merchantName: 1 }, { unique: true });

module.exports = mongoose.model('VendorRule', vendorRuleSchema);
