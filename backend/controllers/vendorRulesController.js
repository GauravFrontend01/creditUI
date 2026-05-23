/**
 * Lightweight in-memory vendor/category rules per user (survives until server restart).
 * Replace with Mongo persistence if you need durability across deploys.
 */
const rulesByUser = new Map();

function listForUser(userId) {
  return rulesByUser.get(userId) || [];
}

exports.getVendorRules = (req, res) => {
  try {
    const uid = req.user._id.toString();
    res.json(listForUser(uid));
  } catch (e) {
    console.error('getVendorRules', e);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.upsertVendorRule = (req, res) => {
  try {
    const merchantName = String(req.body.merchantName || '').trim();
    const category = String(req.body.category || 'Other').trim();
    const vendorLabel = String(req.body.vendorLabel || '').trim();
    if (!merchantName) {
      return res.status(400).json({ message: 'merchantName is required' });
    }
    const uid = req.user._id.toString();
    const key = merchantName.toLowerCase();
    const list = listForUser(uid).filter((r) => r.merchantName.trim().toLowerCase() !== key);
    list.push({ merchantName, category, vendorLabel });
    rulesByUser.set(uid, list);
    res.status(201).json({ merchantName, category, vendorLabel });
  } catch (e) {
    console.error('upsertVendorRule', e);
    res.status(500).json({ message: 'Server error' });
  }
};
