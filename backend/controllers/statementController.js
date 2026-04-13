const Statement = require('../models/Statement');
const { processStatementPdf, refreshSignedUrl } = require('../services/statementPipelineService');

// @desc    Manual upload: unlock -> store -> Vertex -> save
// @route   POST /api/statements
// @access  Private
exports.createStatement = async (req, res) => {
  try {
    const pdfFile = req.file;
    const pdfPassword = String(req.body.pdfPassword || '').trim();
    const statementType = req.body.statementType === 'BANK' ? 'BANK' : 'CREDIT_CARD';

    if (!pdfFile) return res.status(400).json({ message: 'No PDF file uploaded' });
    if (!pdfPassword) return res.status(400).json({ message: 'PDF password is required' });

    const statement = await processStatementPdf({
      userId: req.user._id,
      pdfBuffer: pdfFile.buffer,
      originalFileName: pdfFile.originalname || 'statement.pdf',
      pdfPassword,
      statementType,
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

