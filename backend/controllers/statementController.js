const Statement = require('../models/Statement');
const VendorRule = require('../models/VendorRule');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { processStatementInBackground: processStatement, mapAIResponseToStatement } = require('../services/backgroundProcessor');
const { decryptPdf } = require('../services/pdfService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'creditUI';

// @desc    Initiate a new statement processing (background task)
// @route   POST /api/statements (multipart/form-data)
// @access  Private
exports.createStatement = async (req, res) => {
  try {
    const pdfFile = req.file;
    const pdfPassword = req.body.pdfPassword || '';
    const statementType = req.body.statementType || 'CREDIT_CARD';
    const ocrEngine = req.body.ocrEngine || 'gemini';
    
    if (!pdfFile) {
        return res.status(400).json({ message: 'No PDF file uploaded' });
    }

    // ── Upload raw PDF to Supabase Storage ─────────────────────────────────
    let pdfStorageUrl = null;
    let pdfFileName = null;

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

    const { data: signedData, error: signError } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(pdfFileName, 60 * 60 * 24 * 365); // 1 year

    if (!signError && signedData?.signedUrl) {
      pdfStorageUrl = signedData.signedUrl;
    }

    // ── Save Initial PENDING Statement ────────────────────────────────────
    const statement = await Statement.create({
      user: req.user._id,
      bankName: pdfFile.originalname.replace('.pdf', ''),
      type: statementType,
      status: 'PENDING',
      ocrEngine,
      pdfStorageUrl,
      pdfFileName,
      pdfPassword,
    });

    // ── Kick off background extraction (don't await!) ─────────────────────
    processStatement(statement._id, pdfFile.buffer).catch(err => {
        console.error('Background process spawn failed', err);
    });

    res.status(201).json(statement);
  } catch (error) {
    console.error('createStatement error:', error);
    res.status(500).json({ message: 'Server error', detail: error.message });
  }
};

// @desc    Approve a processed statement
// @route   PUT /api/statements/:id/approve
// @access  Private
exports.approveStatement = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);

    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    statement.isApproved = true;
    await statement.save();

    res.json({ message: 'Statement approved successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Re-map existing AI response (Resync)
// @route   POST /api/statements/:id/reprocess
// @access  Private
exports.reprocessStatement = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);

    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    if (!statement.rawAIResponse) {
      return res.status(400).json({ message: 'No AI response stored for this statement' });
    }

    // Pipeline Snapshot for Version History
    if (statement.transactions && statement.transactions.length > 0) {
        statement.versions.push({
          snapshotAt: new Date(),
          transactions: statement.transactions,
          emiList: statement.emiList,
          summary: statement.summary,
          reconciliation: statement.reconciliation,
          extractionQuality: statement.extractionQuality,
          ocrEngine: statement.ocrEngine,
          rawAIResponse: statement.rawAIResponse
        });
    }

    if (req.body.targetType) {
      statement.type = req.body.targetType;
    }

    if (req.body.manualExtraction) {
      console.log(`[Injection] Manual extraction payload detected for ${req.params.id}`);
      await mapAIResponseToStatement(statement, req.body.manualExtraction);
    } else {
      await mapAIResponseToStatement(statement, statement.rawAIResponse);
    }
    
    await statement.save();

    res.json({ message: 'Statement re-processed successfully', statement });
  } catch (error) {
    console.error('reprocessStatement error:', error);
    res.status(500).json({ message: 'Server error', detail: error.message });
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

// @desc    Delete multiple statements by IDs
// @route   POST /api/statements/bulk-delete
// @access  Private
exports.deleteManyStatements = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No IDs provided' });
    }

    const statements = await Statement.find({
      _id: { $in: ids },
      user: req.user._id
    });

    if (statements.length === 0) {
      return res.status(404).json({ message: 'No statements found' });
    }

    // Delete PDFs from Supabase Storage
    const fileNames = statements
      .map(s => s.pdfFileName)
      .filter(Boolean);

    if (fileNames.length > 0) {
      const { error: removeError } = await supabase
        .storage
        .from(BUCKET)
        .remove(fileNames);

      if (removeError) console.error('Supabase bulk remove error:', removeError);
    }

    await Statement.deleteMany({ _id: { $in: statements.map(s => s._id) } });
    res.json({ message: `${statements.length} statements deleted` });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Re-ingest (Re-run AI processing)
// @route   POST /api/statements/:id/re-ingest
// @access  Private
exports.reIngestStatement = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);

    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    if (!statement.pdfFileName) {
      return res.status(400).json({ message: 'No source PDF found in storage for re-ingestion' });
    }

    // Pipeline Snapshot for Version History
    if (statement.transactions && statement.transactions.length > 0) {
        statement.versions.push({
          snapshotAt: new Date(),
          transactions: statement.transactions,
          emiList: statement.emiList,
          summary: statement.summary,
          reconciliation: statement.reconciliation,
          extractionQuality: statement.extractionQuality,
          ocrEngine: statement.ocrEngine,
          rawAIResponse: statement.rawAIResponse
        });
    }

    // 1. Fetch the PDF from Supabase Storage
    const { data: pdfData, error: downloadError } = await supabase
      .storage
      .from(BUCKET)
      .download(statement.pdfFileName);

    if (downloadError) {
      console.error('Supabase download error:', downloadError);
      return res.status(500).json({ message: 'Failed to retrieve PDF from storage for re-processing' });
    }

    // 2. Convert Blob to Buffer
    const arrayBuffer = await pdfData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Mark as PENDING and clear previous errors
    statement.status = 'PENDING';
    statement.processingError = undefined;
    statement.isApproved = false; // Reset approval status
    await statement.save();

    // 4. Kick off background extraction
    processStatement(statement._id, buffer).catch(err => {
        console.error('Background re-ingestion process failed', err);
    });

    res.json({ message: 'Re-ingestion triggered successfully', statement });
  } catch (error) {
    console.error('reIngestStatement error:', error);
    res.status(500).json({ message: 'Server error', detail: error.message });
  }
};

/**
 * Create a statement from a PDF buffer (used by multipart upload and Gmail sync).
 */
exports.createStatementFromPdfBuffer = async ({
  userId,
  pdfBuffer,
  originalFileName = 'statement.pdf',
  pdfPassword = '',
  statementType = 'CREDIT_CARD',
  ocrEngine = 'gemini',
  gmailMessageId = null,
}) => {
  let pdfStorageUrl = null;
  let pdfFileName = null;

  const ext = path.extname(originalFileName) || '.pdf';
  const safeBase = path.basename(originalFileName, ext).replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 120);
  pdfFileName = `${userId}-${Date.now()}-${safeBase}${ext}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(pdfFileName, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: false,
  });

  if (uploadError) {
    throw new Error(`Failed to upload PDF to storage: ${uploadError.message}`);
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pdfFileName, 60 * 60 * 24 * 365);

  if (!signError && signedData?.signedUrl) {
    pdfStorageUrl = signedData.signedUrl;
  }

  const displayName = safeBase || originalFileName.replace(/\.pdf$/i, '') || 'Gmail import';

  const statement = await Statement.create({
    user: userId,
    bankName: { val: displayName, box: [], page: 0 },
    type: statementType,
    status: 'PENDING',
    ocrEngine,
    pdfStorageUrl,
    pdfFileName,
    pdfPassword,
    gmailMessageId,
  });

  processStatement(statement._id, pdfBuffer).catch((err) => {
    console.error('Background process spawn failed', err);
  });

  return statement;
};

// @desc    Download unlocked PDF
// @route   GET /api/statements/:id/download-unlocked
// @access  Private
exports.downloadUnlockedPdf = async (req, res) => {
  try {
    const statement = await Statement.findById(req.params.id);

    if (!statement || statement.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    if (!statement.pdfFileName) {
      return res.status(400).json({ message: 'No file associated with this statement' });
    }

    // 1. Fetch from Supabase
    const { data: pdfData, error: downloadError } = await supabase
      .storage
      .from(BUCKET)
      .download(statement.pdfFileName);

    if (downloadError) {
      return res.status(500).json({ message: 'Failed to retrieve PDF from storage' });
    }

    const buffer = Buffer.from(await pdfData.arrayBuffer());
    
    // 2. Decrypt
    try {
      const unlockedBuffer = await decryptPdf(buffer, statement.pdfPassword);
      
      const safeName = (statement.bankName?.val || 'statement')
        .replace(/[^\w.-]+/g, '_') + '_unlocked.pdf';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.send(unlockedBuffer);
    } catch (e) {
      console.error('Decryption failed for download', e);
      res.status(400).json({ message: 'Could not unlock PDF with stored password' });
    }
  } catch (error) {
    console.error('downloadUnlockedPdf error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
