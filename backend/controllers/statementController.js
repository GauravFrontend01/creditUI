const Statement = require('../models/Statement');
const VendorRule = require('../models/VendorRule');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'creditUI';

// @desc    Create a new statement (with PDF upload to Supabase Storage)
// @route   POST /api/statements  (multipart/form-data)
// @access  Private
exports.createStatement = async (req, res) => {
  try {
    // req.file  → PDF buffer (from multer memoryStorage)
    // req.body.data → JSON string of the extraction result
    // req.body.pdfPassword → optional password string

    const pdfFile = req.file;
    const pdfPassword = req.body.pdfPassword || '';
    let extraction = {};

    try {
      extraction = JSON.parse(req.body.data || '{}');
    } catch {
      return res.status(400).json({ message: 'Invalid extraction data JSON' });
    }

    // ── Detect bank name: use AI-extracted field first, then keyword scan ──
    let detectedBank = extraction.bankName || null;
    if (!detectedBank) {
      const allText = JSON.stringify(extraction).toUpperCase();
      const banks = ['HSBC', 'HDFC', 'ICICI', 'AXIS', 'KOTAK', 'SBI', 'AMEX', 'CHASE', 'CITI', 'BARCLAYS'];
      for (const bank of banks) {
        if (allText.includes(bank)) { detectedBank = `${bank} Credit Card`; break; }
      }
    }
    if (!detectedBank) detectedBank = 'Credit Statement';

    // ── Upload raw PDF to Supabase Storage ─────────────────────────────────
    let pdfStorageUrl = null;
    let pdfFileName = null;

    if (pdfFile) {
      const ext = path.extname(pdfFile.originalname) || '.pdf';
      pdfFileName = `${req.user._id}-${Date.now()}${ext}`;

      const { error: uploadError } = await supabase
        .storage
        .from(BUCKET)
        .upload(pdfFileName, pdfFile.buffer, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload PDF to storage', detail: uploadError.message });
      }

      // Create a long-lived signed URL (7 days = 604800s; adjust as needed)
      const { data: signedData, error: signError } = await supabase
        .storage
        .from(BUCKET)
        .createSignedUrl(pdfFileName, 60 * 60 * 24 * 365); // 1 year

      if (signError) {
        console.error('Supabase signed URL error:', signError);
        // Non-fatal: fall back to null
      } else {
        pdfStorageUrl = signedData.signedUrl;
      }
    }

    // ── Apply Vendor Rules ──────────────────────────────────────────────────
    const userRules = await VendorRule.find({ user: req.user._id });
    const rulesMap = new Map();
    userRules.forEach(rule => rulesMap.set(rule.merchantName, rule.category));

    if (extraction.transactions && Array.isArray(extraction.transactions)) {
      extraction.transactions = extraction.transactions.map(tx => {
        if (tx.merchantName && rulesMap.has(tx.merchantName)) {
          return {
            ...tx,
            category: rulesMap.get(tx.merchantName),
            categoryConfidence: 100 // Set to max since user defined it
          };
        }
        return tx;
      });
    }

    // ── Save to MongoDB ────────────────────────────────────────────────────
    const statement = await Statement.create({
      user: req.user._id,
      bankName: detectedBank,
      currency: extraction.currency,

      creditLimit:      extraction.creditLimit,
      availableLimit:   extraction.availableLimit,
      outstandingTotal: extraction.outstandingTotal,
      minPaymentDue:    extraction.minPaymentDue,

      paymentDueDate:  extraction.paymentDueDate,
      statementDate:   extraction.statementDate,
      statementPeriod: extraction.statementPeriod,

      previousBalance:   extraction.previousBalance,
      lastPaymentAmount: extraction.lastPaymentAmount,
      lastPaymentDate:   extraction.lastPaymentDate,

      totalDebits:          extraction.totalDebits,
      totalCredits:         extraction.totalCredits,
      totalInterestCharged: extraction.totalInterestCharged,
      totalLateFee:         extraction.totalLateFee,
      totalForexFee:        extraction.totalForexFee,
      totalFees:            extraction.totalFees,
      cashAdvance:          extraction.cashAdvance,
      isRevolvingBalance:   extraction.isRevolvingBalance,

      rewardPointsEarned:   extraction.rewardPointsEarned,
      rewardPointsRedeemed: extraction.rewardPointsRedeemed,
      rewardPointsBalance:  extraction.rewardPointsBalance,
      rewardPointsExpiry:   extraction.rewardPointsExpiry,

      transactions: extraction.transactions,
      emiList:      extraction.emiList,

      summary:        extraction.summary,
      reconciliation: extraction.reconciliation,

      pdfStorageUrl,
      pdfFileName,
      pdfPassword,
    });

    res.status(201).json(statement);
  } catch (error) {
    console.error('createStatement error:', error);
    res.status(500).json({ message: 'Server error', detail: error.message });
  }
};

// @desc    Get all statements for logged-in user
// @route   GET /api/statements
// @access  Private
exports.getMyStatements = async (req, res) => {
  try {
    const statements = await Statement.find({ user: req.user._id })
      .select('-pdfStorageUrl -pdfPassword') // don't leak URL/password in list
      .sort({ createdAt: -1 });
    res.json(statements);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get statement by ID (includes a fresh signed URL for PDF)
// @route   GET /api/statements/:id
// @access  Private
exports.getStatementById = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);

    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    // ── Refresh the signed URL so it doesn't expire mid-session ───────────
    let freshSignedUrl = statement.pdfStorageUrl;

    if (statement.pdfFileName) {
      const { data: signedData, error: signError } = await supabase
        .storage
        .from(BUCKET)
        .createSignedUrl(statement.pdfFileName, 60 * 60 * 2); // 2h for viewing session

      if (!signError && signedData?.signedUrl) {
        freshSignedUrl = signedData.signedUrl;
      }
    }

    res.json({
      ...statement.toObject(),
      pdfStorageUrl: freshSignedUrl,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete statement by ID (removes PDF from Supabase too)
// @route   DELETE /api/statements/:id
// @access  Private
exports.deleteStatement = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);

    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    // Delete PDF from Supabase Storage first
    if (statement.pdfFileName) {
      const { error: removeError } = await supabase
        .storage
        .from(BUCKET)
        .remove([statement.pdfFileName]);

      if (removeError) console.error('Supabase remove error:', removeError);
    }

    await statement.deleteOne();
    res.json({ message: 'Statement deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
