const VendorRule = require('../models/VendorRule');

const saveVendorRule = async (req, res) => {
  try {
    const { merchantName, category } = req.body;
    if (!merchantName || !category) {
      return res.status(400).json({ message: 'merchantName and category are required' });
    }

    const rule = await VendorRule.findOneAndUpdate(
      { user: req.user._id, merchantName },
      { category },
      { new: true, upsert: true }
    );

    res.status(200).json(rule);
  } catch (error) {
    console.error('Save vendor rule error:', error);
    res.status(500).json({ message: 'Server error saving rule' });
  }
};

const getVendorRules = async (req, res) => {
  try {
    const rules = await VendorRule.find({ user: req.user._id });
    res.status(200).json(rules);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching rules' });
  }
};

module.exports = { saveVendorRule, getVendorRules };
