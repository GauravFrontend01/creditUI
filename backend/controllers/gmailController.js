const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Statement = require('../models/Statement');
const {
  createOAuth2Client,
  buildGmailAuthUrl,
  exchangeCodeForTokens,
  extractPdfAttachments,
  defaultGmailQuery,
  isPdfEncrypted,
  google,
} = require('../services/gmailService');
const { createStatementFromPdfBuffer } = require('./statementController');
const { decryptPdf } = require('../services/pdfService');

function identifyBank(subject, from) {
  const s = (subject + ' ' + from).toLowerCase();
  
  // Specific patterns for Kotak bank statements
  if (s.includes('kotak') || s.includes('kmb ')) {
      if (s.includes('credit card')) return 'Kotak CC';
      return 'Kotak BK';
  }
  
  if (s.includes('hdfc')) return 'HDFC';
  if (s.includes('icici')) return 'ICICI';
  if (s.includes('sbi ') || s.includes('state bank')) return 'SBI';
  if (s.includes('axis')) return 'Axis';
  if (s.includes('citibank') || s.includes(' citi ')) return 'Citi';
  if (s.includes('amex') || s.includes('american express')) return 'Amex';
  if (s.includes('hsbc')) return 'HSBC';
  if (s.includes('standard chartered')) return 'SCB';
  return 'Other';
}

const FRONTEND = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

function redirectWithMessage(res, params) {
  const u = new URL(`${FRONTEND()}/upload`);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return res.redirect(302, u.toString());
}

// @route   GET /api/gmail/auth-url
// @access  Private
exports.getGmailAuthUrl = async (req, res) => {
  try {
    const oauth2Client = createOAuth2Client();
    const state = jwt.sign(
      { id: req.user._id.toString(), gmailOAuth: true },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    const url = buildGmailAuthUrl(oauth2Client, state);
    res.json({ url });
  } catch (error) {
    console.error('getGmailAuthUrl', error);
    res.status(500).json({
      message: 'Gmail OAuth is not configured',
      detail: error.message,
    });
  }
};

// @route   GET /api/gmail/oauth/callback  (registered in Google Cloud as redirect URI)
// @access  Public (validated via signed state)
exports.gmailOAuthCallback = async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return redirectWithMessage(res, { gmail: 'denied', reason: String(oauthError) });
  }

  if (!code || !state) {
    return redirectWithMessage(res, { gmail: 'error', reason: 'missing_code_or_state' });
  }

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (e) {
    return redirectWithMessage(res, { gmail: 'error', reason: 'invalid_state' });
  }

  if (!decoded.gmailOAuth || !decoded.id) {
    return redirectWithMessage(res, { gmail: 'error', reason: 'bad_state' });
  }

  try {
    const oauth2Client = createOAuth2Client();
    const tokens = await exchangeCodeForTokens(oauth2Client, code);

    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress || '';

    const user = await User.findById(decoded.id).select('+gmailRefreshToken');
    if (!user) {
      return redirectWithMessage(res, { gmail: 'error', reason: 'user_not_found' });
    }

    if (!tokens.refresh_token && !user.gmailRefreshToken) {
      return redirectWithMessage(res, {
        gmail: 'error',
        reason: 'no_refresh_token',
        hint: 'revoke_app_access_in_google_account_and_retry',
      });
    }

    user.gmailAccessToken = tokens.access_token || '';
    if (tokens.refresh_token) user.gmailRefreshToken = tokens.refresh_token;
    user.gmailTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;
    user.gmailAddress = emailAddress;
    user.gmailConnectedAt = new Date();
    user.gmailLastSyncError = '';
    await user.save();

    return redirectWithMessage(res, { gmail: 'connected' });
  } catch (error) {
    console.error('gmailOAuthCallback', error);
    return redirectWithMessage(res, {
      gmail: 'error',
      reason: 'token_exchange_failed',
    });
  }
};

// @route   GET /api/gmail/status
// @access  Private
exports.getGmailStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+gmailRefreshToken');
    const connected = !!(user?.gmailRefreshToken);
    res.json({
      connected,
      email: user?.gmailAddress || '',
      connectedAt: user?.gmailConnectedAt || null,
      lastSyncAt: user?.gmailLastSyncAt || null,
      lastError: user?.gmailLastSyncError || '',
    });
  } catch (error) {
    console.error('getGmailStatus', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route   POST /api/gmail/disconnect
// @access  Private
exports.disconnectGmail = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $unset: {
        gmailRefreshToken: 1,
        gmailAccessToken: 1,
        gmailTokenExpiry: 1,
        gmailAddress: 1,
        gmailConnectedAt: 1,
        gmailImportedMessageIds: 1,
        gmailLastSyncAt: 1,
      },
      $set: { gmailLastSyncError: '' },
    });
    res.json({ message: 'Gmail disconnected' });
  } catch (error) {
    console.error('disconnectGmail', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route   POST /api/gmail/sync
// @access  Private
exports.syncGmail = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+gmailRefreshToken');
    if (!user?.gmailRefreshToken) {
      return res.status(400).json({ message: 'Connect Gmail first' });
    }

    const pdfPassword = typeof req.body?.pdfPassword === 'string' ? req.body.pdfPassword : '';
    const statementType = req.body?.statementType === 'BANK' ? 'BANK' : 'CREDIT_CARD';
    const ocrEngine = req.body?.ocrEngine || 'gemini';
    const maxResults = Math.min(Math.max(parseInt(req.body?.maxResults, 10) || 8, 1), 25);

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: user.gmailRefreshToken,
      access_token: user.gmailAccessToken || undefined,
      expiry_date: user.gmailTokenExpiry ? user.gmailTokenExpiry.getTime() : undefined,
    });

    oauth2Client.on('tokens', async (tok) => {
      try {
        const update = {};
        if (tok.access_token) update.gmailAccessToken = tok.access_token;
        if (tok.expiry_date) update.gmailTokenExpiry = new Date(tok.expiry_date);
        if (tok.refresh_token) update.gmailRefreshToken = tok.refresh_token;
        if (Object.keys(update).length) await User.findByIdAndUpdate(user._id, update);
      } catch (e) {
        console.error('persist gmail tokens', e);
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const q = defaultGmailQuery();
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults,
    });

    const messageRefs = listRes.data.messages || [];
    const imported = new Set(user.gmailImportedMessageIds || []);

    const created = [];
    const skipped = [];
    const errors = [];

    for (const ref of messageRefs) {
      const messageId = ref.id;
      if (!messageId) continue;

      const isRecorded = imported.has(messageId);
      if (isRecorded) {
        // Double check: if it's in the list but missing from the Statement collection, they likely deleted it.
        const exists = await Statement.exists({ user: user._id, gmailMessageId: messageId });
        if (exists) {
          skipped.push({ messageId, reason: 'already_imported' });
          continue;
        }
        console.log(`[GmailSync] ${messageId} exists in sync log but not in DB. Re-syncing.`);
      }

      try {
        const pdfs = await extractPdfAttachments(gmail, messageId);
        if (pdfs.length === 0) {
          skipped.push({ messageId, reason: 'no_pdf_attachment' });
          continue;
        }

        for (let i = 0; i < pdfs.length; i += 1) {
          const { buffer, filename, subject, from } = pdfs[i];
          const bankLabel = identifyBank(subject, from);
          
          let effectivePassword = pdfPassword;
          
          // If no password provided, try to find a saved one for this bank
          if (!effectivePassword && user.bankPasswords?.length) {
            const saved = user.bankPasswords.find(p => p.label === bankLabel);
            if (saved) {
              console.log(`[GmailSync] Using saved password for ${bankLabel}`);
              effectivePassword = saved.password;
            }
          }

          // If a password was provided (either from request or saved), ensure it's saved/updated for future
          if (pdfPassword && bankLabel !== 'Other') {
            const existingIdx = user.bankPasswords.findIndex(p => p.label === bankLabel);
            if (existingIdx >= 0) {
              user.bankPasswords[existingIdx].password = pdfPassword;
              user.bankPasswords[existingIdx].updatedAt = new Date();
            } else {
              user.bankPasswords.push({ label: bankLabel, password: pdfPassword });
            }
          }

          const statement = await createStatementFromPdfBuffer({
            userId: user._id,
            pdfBuffer: buffer,
            originalFileName: pdfs.length > 1 ? `${filename.replace(/\.pdf$/i, '')}_${i + 1}.pdf` : filename,
            pdfPassword: effectivePassword,
            statementType,
            ocrEngine,
            gmailMessageId: messageId,
          });
          created.push({ statementId: statement._id, messageId, filename, bank: bankLabel });
        }

        imported.add(messageId);
      } catch (err) {
        console.error('syncGmail message', messageId, err);
        errors.push({ messageId, error: err.message || String(err) });
      }
    }

    user.gmailImportedMessageIds = [...imported].slice(-800);
    user.gmailLastSyncAt = new Date();
    user.gmailLastSyncError = errors.length ? errors.map((e) => e.error).join('; ').slice(0, 500) : '';
    user.gmailAccessToken = oauth2Client.credentials.access_token || user.gmailAccessToken;
    if (oauth2Client.credentials.expiry_date) {
      user.gmailTokenExpiry = new Date(oauth2Client.credentials.expiry_date);
    }

    await user.save(); 

    res.json({
      query: q,
      scanned: messageRefs.length,
      created,
      skipped,
      errors,
    });
  } catch (error) {
    console.error('syncGmail', error);
    await User.findByIdAndUpdate(req.user._id, {
      gmailLastSyncError: (error.message || 'sync failed').slice(0, 500),
    });
    res.status(500).json({ message: 'Gmail sync failed', detail: error.message });
  }
};

// @route   GET /api/gmail/candidates
// @access  Private
exports.listGmailCandidates = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+gmailRefreshToken');
    if (!user?.gmailRefreshToken) {
      return res.status(400).json({ message: 'Connect Gmail first' });
    }

    const maxResults = 12;
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: user.gmailRefreshToken,
      access_token: user.gmailAccessToken || undefined,
      expiry_date: user.gmailTokenExpiry ? user.gmailTokenExpiry.getTime() : undefined,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const q = defaultGmailQuery();
    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults });

    const messageRefs = listRes.data.messages || [];
    const imported = new Set(user.gmailImportedMessageIds || []);
    const candidates = [];

    for (const ref of messageRefs) {
      const messageId = ref.id;
      const isImported = imported.has(messageId);
      
      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata' });
        const headers = full.data.payload?.headers || [];
        const subject = (headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '').trim();
        const from = (headers.find(h => h.name?.toLowerCase() === 'from')?.value || '').trim();
        const date = (headers.find(h => h.name?.toLowerCase() === 'date')?.value || '');

        const pdfs = await extractPdfAttachments(gmail, messageId);
        if (pdfs.length === 0) continue;

        for (const pdf of pdfs) {
          const bank = identifyBank(subject, from);
          const encrypted = await isPdfEncrypted(pdf.buffer);
          
          let savedPassword = '';
          if (encrypted && user.bankPasswords?.length) {
            const match = user.bankPasswords.find(p => p.label === bank);
            if (match) savedPassword = match.password;
          }

          candidates.push({
            messageId,
            id: `${messageId}-${pdf.filename}`,
            subject,
            from,
            date,
            filename: pdf.filename,
            bank,
            isImported,
            encrypted,
            savedPassword,
            existsInDb: isImported ? await Statement.exists({ user: user._id, gmailMessageId: messageId }) : false,
          });
        }
      } catch (e) {
        console.error('Candidate fetch fail', messageId, e);
      }
    }

    res.json({ candidates });
  } catch (error) {
    console.error('listGmailCandidates', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

// @route   POST /api/gmail/sync-selected
// @access  Private
exports.syncGmailSelected = async (req, res) => {
  try {
    const { selections } = req.body; // Array<{ messageId, filename, password, statementType, ocrEngine }>
    if (!selections || !Array.isArray(selections)) {
      return res.status(400).json({ message: 'No selections provided' });
    }

    const user = await User.findById(req.user._id).select('+gmailRefreshToken');
    if (!user?.gmailRefreshToken) return res.status(400).json({ message: 'Connect Gmail first' });

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: user.gmailRefreshToken,
      access_token: user.gmailAccessToken || undefined,
      expiry_date: user.gmailTokenExpiry ? user.gmailTokenExpiry.getTime() : undefined,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const imported = new Set(user.gmailImportedMessageIds || []);
    const created = [];
    const errors = [];

    for (const sel of selections) {
      try {
        const { messageId, filename, password, statementType = 'CREDIT_CARD', ocrEngine = 'gemini' } = sel;
        const pdfs = await extractPdfAttachments(gmail, messageId);
        const match = pdfs.find(p => p.filename === filename) || pdfs[0];

        if (!match) {
          errors.push({ filename, error: 'Attachment not found' });
          continue;
        }

        const bankLabel = identifyBank(match.subject, match.from);

        // Save password if provided
        if (password && bankLabel !== 'Other') {
          const existingIdx = user.bankPasswords.findIndex(p => p.label === bankLabel);
          if (existingIdx >= 0) {
            user.bankPasswords[existingIdx].password = password;
            user.bankPasswords[existingIdx].updatedAt = new Date();
          } else {
            user.bankPasswords.push({ label: bankLabel, password: password });
          }
        }

        const statement = await createStatementFromPdfBuffer({
          userId: user._id,
          pdfBuffer: match.buffer,
          originalFileName: filename,
          pdfPassword: password,
          statementType,
          ocrEngine,
          gmailMessageId: messageId,
        });

        created.push({ statementId: statement._id, filename, bank: bankLabel });
        imported.add(messageId);
      } catch (err) {
        errors.push({ filename: sel.filename, error: err.message });
      }
    }

    user.gmailImportedMessageIds = [...imported].slice(-800);
    user.gmailLastSyncAt = new Date();
    user.gmailAccessToken = oauth2Client.credentials.access_token || user.gmailAccessToken;
    if (oauth2Client.credentials.expiry_date) user.gmailTokenExpiry = new Date(oauth2Client.credentials.expiry_date);

    await user.save();
    res.json({ created, errors });
  } catch (error) {
    console.error('syncGmailSelected', error);
    res.status(500).json({ message: 'Batch sync failed' });
  }
};

// @route   POST /api/gmail/reset
// @access  Private
exports.resetGmailSync = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: { gmailImportedMessageIds: [] }
    });
    res.json({ message: 'Sync history cleared. You can now re-import all statements.' });
  } catch (error) {
    console.error('resetGmailSync', error);
    res.status(500).json({ message: 'Server error' });
  }
};
// @route   POST /api/gmail/preview-unlocked
// @access  Private
exports.previewGmailPdf = async (req, res) => {
  try {
    const { messageId, filename, password } = req.body;
    if (!messageId || !filename) return res.status(400).json({ message: 'Missing parameters' });

    const user = await User.findById(req.user._id).select('+gmailRefreshToken');
    if (!user?.gmailRefreshToken) return res.status(400).json({ message: 'Connect Gmail first' });

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: user.gmailRefreshToken,
      access_token: user.gmailAccessToken || undefined,
      expiry_date: user.gmailTokenExpiry ? user.gmailTokenExpiry.getTime() : undefined,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const pdfs = await extractPdfAttachments(gmail, messageId);
    const match = pdfs.find(p => p.filename === filename) || pdfs[0];

    if (!match) return res.status(404).json({ message: 'Attachment not found' });
    
    console.log(`[Preview] Retrived raw attachment: ${match.filename} (${match.buffer.length} bytes)`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="preview_${filename}"`);
    res.send(match.buffer);
  } catch (error) {
    console.error('previewGmailPdf error:', error);
    res.status(500).json({ message: 'Internal server error during preview' });
  }
};
