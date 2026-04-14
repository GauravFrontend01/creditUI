const mongoose = require('mongoose');
const Statement = require('../models/Statement');
const {
  processStatementPdf,
  refreshSignedUrl,
  reIngestStatementById,
  applyExtraction,
} = require('../services/statementPipelineService');

function toIsoDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLooseDate(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime())) return direct;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const dt = new Date(year, month, day);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const text = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/,]*(\d{4})$/);
  if (text) {
    const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
    const day = Number(text[1]);
    const month = MONTHS[String(text[2]).toLowerCase()];
    const year = Number(text[3]);
    if (month !== undefined) {
      const dt = new Date(year, month, day);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }
  return null;
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

function accountLikelyMatches(hint, accountVal) {
  const h = digitsOnly(hint);
  const a = digitsOnly(accountVal);
  if (!h || !a) return false;
  if (h.length <= 4) return a.endsWith(h);
  return a.endsWith(h.slice(-4));
}

async function findDuplicateByGmailMetadata(userId, accountHint, fromDate, toDate) {
  if (!accountHint || !fromDate || !toDate) return null;
  const fromIso = toIsoDate(parseLooseDate(fromDate));
  const toIso = toIsoDate(parseLooseDate(toDate));
  if (!fromIso || !toIso) return null;

  const existing = await Statement.find({
    user: userId,
    isUserRejected: { $ne: true },
  })
    .select('_id accountNumber statementPeriod')
    .lean();

  for (const st of existing) {
    const acc = st?.accountNumber?.val || '';
    if (!accountLikelyMatches(accountHint, acc)) continue;
    const f = toIsoDate(parseLooseDate(st?.statementPeriod?.from || ''));
    const t = toIsoDate(parseLooseDate(st?.statementPeriod?.to || ''));
    if (f === fromIso && t === toIso) return st;
  }
  return null;
}

// @desc    Manual upload: unlock -> store -> Vertex -> save
// @route   POST /api/statements
// @access  Private
exports.createStatement = async (req, res) => {
  const startedAt = Date.now();
  try {
    const pdfFile = req.file;
    const pdfPassword = String(req.body.pdfPassword || '').trim();
    const statementType = req.body.statementType === 'BANK' ? 'BANK' : 'CREDIT_CARD';
    const isUnlocked = String(req.body.isUnlocked || '').toLowerCase() === 'true';
    const gmailMessageIdRaw = String(req.body.gmailMessageId || '').trim();
    const gmailMessageId = gmailMessageIdRaw || null;
    const emailPeriodFrom = String(req.body.emailPeriodFrom || '').trim();
    const emailPeriodTo = String(req.body.emailPeriodTo || '').trim();
    const emailAccountHint = String(req.body.emailAccountHint || '').trim();

    if (!pdfFile) return res.status(400).json({ message: 'No PDF file uploaded' });
    if (!isUnlocked && !pdfPassword) return res.status(400).json({ message: 'PDF password is required' });

    console.log(
      `[Sync/Create] start user=${req.user._id} file="${pdfFile.originalname}" size=${pdfFile.size || 0} unlocked=${isUnlocked} source=${gmailMessageId ? 'gmail' : 'manual'} messageId=${gmailMessageId || '-'}`
    );

    if (gmailMessageId && emailPeriodFrom && emailPeriodTo && emailAccountHint) {
      console.log(
        `[Sync/Create] duplicate-check messageId=${gmailMessageId} accountHint=${emailAccountHint} period=${emailPeriodFrom}..${emailPeriodTo}`
      );
      const dup = await findDuplicateByGmailMetadata(
        req.user._id,
        emailAccountHint,
        emailPeriodFrom,
        emailPeriodTo
      );
      if (dup) {
        console.log(
          `[Sync/Create] duplicate-found existingStatementId=${dup._id} elapsedMs=${Date.now() - startedAt}`
        );
        return res.status(200).json({
          alreadyProcessed: true,
          existingStatementId: dup._id,
          message: 'Statement already processed for this account and period',
        });
      }
    }

    console.log('[Sync/Create] invoking processStatementPdf');
    const statement = await processStatementPdf({
      userId: req.user._id,
      pdfBuffer: pdfFile.buffer,
      originalFileName: pdfFile.originalname || 'statement.pdf',
      pdfPassword: isUnlocked ? '' : pdfPassword,
      statementType,
      isPreUnlocked: isUnlocked,
      gmailMessageId,
    });

    const txCount = Array.isArray(statement.transactions) ? statement.transactions.length : 0;
    console.log(
      `[Sync/Create] success statementId=${statement._id} tx=${txCount} elapsedMs=${Date.now() - startedAt}`
    );
    res.status(201).json(statement);
  } catch (error) {
    console.error(
      `[Sync/Create] failed elapsedMs=${Date.now() - startedAt} error=${error?.message || error}`
    );
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

