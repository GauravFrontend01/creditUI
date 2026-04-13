const mongoose = require('mongoose');
const Statement = require('../models/Statement');
const {
  processStatementPdf,
  refreshSignedUrl,
  reIngestStatementById,
  applyExtraction,
} = require('../services/statementPipelineService');

// @desc    Manual upload: unlock -> store -> Vertex -> save
// @route   POST /api/statements
// @access  Private
exports.createStatement = async (req, res) => {
  try {
    const pdfFile = req.file;
    const pdfPassword = String(req.body.pdfPassword || '').trim();
    const statementType = req.body.statementType === 'BANK' ? 'BANK' : 'CREDIT_CARD';
    const isUnlocked = String(req.body.isUnlocked || '').toLowerCase() === 'true';

    if (!pdfFile) return res.status(400).json({ message: 'No PDF file uploaded' });
    if (!isUnlocked && !pdfPassword) return res.status(400).json({ message: 'PDF password is required' });

    const statement = await processStatementPdf({
      userId: req.user._id,
      pdfBuffer: pdfFile.buffer,
      originalFileName: pdfFile.originalname || 'statement.pdf',
      pdfPassword,
      statementType,
      isPreUnlocked: isUnlocked,
    });

    res.status(201).json(statement);
  } catch (error) {
    console.error('createStatement error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Get all statements for logged-in user
// @route   GET /api/statements
// @access  Private
exports.getMyStatements = async (req, res) => {
  try {
    const statements = await Statement.find({ user: req.user._id })
      .select('-pdfStorageUrl -pdfPassword -rawAIResponse') // don't leak URL/password/raw payload in list
      .sort({ createdAt: -1 });
    res.json(statements);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route   POST /api/statements/bulk-delete
exports.bulkDeleteStatements = async (req, res) => {
  try {
    const raw = req.body?.ids;
    const ids = Array.isArray(raw) ? raw.map((id) => String(id).trim()).filter(Boolean) : [];
    if (!ids.length) {
      return res.status(400).json({ message: 'No statement ids provided' });
    }
    const valid = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!valid.length) {
      return res.status(400).json({ message: 'No valid ids' });
    }
    const result = await Statement.deleteMany({
      user: req.user._id,
      _id: { $in: valid },
    });
    res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    console.error('bulkDeleteStatements', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get statement by ID (with refreshed signed URL)
// @route   GET /api/statements/:id
// @access  Private
exports.getStatementById = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);

    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    const freshSignedUrl = await refreshSignedUrl(statement.pdfFileName, statement.pdfStorageUrl);

    res.json({
      ...statement.toObject(),
      pdfStorageUrl: freshSignedUrl,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route   PUT /api/statements/:id/approve
exports.approveStatement = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);
    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }
    statement.isApproved = true;
    statement.isUserRejected = false;
    await statement.save();
    const pdfStorageUrl = await refreshSignedUrl(statement.pdfFileName, statement.pdfStorageUrl);
    res.json({ ...statement.toObject(), pdfStorageUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route   PUT /api/statements/:id/reject
exports.rejectStatement = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);
    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }
    statement.isApproved = false;
    statement.isUserRejected = true;
    await statement.save();
    const pdfStorageUrl = await refreshSignedUrl(statement.pdfFileName, statement.pdfStorageUrl);
    res.json({ ...statement.toObject(), pdfStorageUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route   POST /api/statements/:id/re-ingest
exports.reIngestStatement = async (req, res) => {
  try {
    const statement = await reIngestStatementById(req.user._id, req.params.id);
    const pdfStorageUrl = await refreshSignedUrl(statement.pdfFileName, statement.pdfStorageUrl);
    res.json({ ...statement.toObject(), pdfStorageUrl });
  } catch (error) {
    console.error('reIngestStatement', error);
    const msg = error.message || 'Re-ingest failed';
    if (msg === 'Statement not found') return res.status(404).json({ message: msg });
    res.status(500).json({ message: msg });
  }
};

/**
 * @route POST /api/statements/:id/reprocess
 * Re-run AI on stored PDF, or apply a manual JSON payload when provided.
 */
exports.reprocessStatement = async (req, res) => {
  try {
    const { manualExtraction } = req.body || {};
    if (manualExtraction && typeof manualExtraction === 'object') {
      const statement = await Statement.findById(req.params.id);
      if (!statement || statement.user.toString() !== req.user._id.toString()) {
        return res.status(404).json({ message: 'Statement not found' });
      }
      applyExtraction(statement, manualExtraction);
      await statement.save();
      const pdfStorageUrl = await refreshSignedUrl(statement.pdfFileName, statement.pdfStorageUrl);
      return res.json({ statement: { ...statement.toObject(), pdfStorageUrl } });
    }
    const statement = await reIngestStatementById(req.user._id, req.params.id);
    const pdfStorageUrl = await refreshSignedUrl(statement.pdfFileName, statement.pdfStorageUrl);
    res.json({ statement: { ...statement.toObject(), pdfStorageUrl } });
  } catch (error) {
    console.error('reprocessStatement', error);
    const msg = error.message || 'Reprocess failed';
    if (msg === 'Statement not found') return res.status(404).json({ message: msg });
    res.status(500).json({ message: msg });
  }
};

