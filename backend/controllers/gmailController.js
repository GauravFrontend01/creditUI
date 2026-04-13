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
const { processStatementPdf } = require('../services/statementPipelineService');

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

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

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

  const dmyNum = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmyNum) {
    const day = Number(dmyNum[1]);
    const month = Number(dmyNum[2]) - 1;
    const year = Number(dmyNum[3].length === 2 ? `20${dmyNum[3]}` : dmyNum[3]);
    const dt = new Date(year, month, day);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const dmyText = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/,]*(\d{4})$/);
  if (dmyText) {
    const day = Number(dmyText[1]);
    const month = MONTHS[dmyText[2].toLowerCase()];
    const year = Number(dmyText[3]);
    if (month !== undefined) {
      const dt = new Date(year, month, day);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }
  return null;
}

function extractDateRangeFromEmail(subject, body, filename) {
  const subjectText = String(subject || '');
  const bodyText = String(body || '');
  const filenameText = String(filename || '');
  const joined = `${subjectText}\n${bodyText}\n${filenameText}`;

  // "01 Mar 2026 to 31 Mar 2026"
  const periodRegex = /(\d{1,2}[\/\-\s][A-Za-z]{3,9}[\/\-\s,]*\d{4})\s*(?:to|-)\s*(\d{1,2}[\/\-\s][A-Za-z]{3,9}[\/\-\s,]*\d{4})/i;
  const periodMatch = joined.match(periodRegex);
  if (periodMatch) {
    const from = parseLooseDate(periodMatch[1]);
    const to = parseLooseDate(periodMatch[2]);
    if (from && to) {
      return { from: toIsoDate(from), to: toIsoDate(to), source: 'explicit_period' };
    }
  }

  // "for March 2026", "Mar-2026", "Mar2026"
  const monthYearRegex = /\b(?:for\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s\-_]*(\d{4})\b/i;
  const monthMatch = joined.match(monthYearRegex);
  if (monthMatch) {
    const month = MONTHS[monthMatch[1].toLowerCase()];
    const year = Number(monthMatch[2]);
    if (month !== undefined && !Number.isNaN(year)) {
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 0);
      return { from: toIsoDate(from), to: toIsoDate(to), source: 'month_year' };
    }
  }

  return null;
}

function extractAccountHint(subject, body, filename) {
  const text = `${subject || ''} ${body || ''} ${filename || ''}`;
  const masked = text.match(/\b\d{2,}[X*x*]{2,}[X*x*\d]{0,}\d{2,}\b/);
  if (masked) return masked[0].replace(/\*/g, 'X');

  const acct = text.match(/\b(?:a\/?c|account)\s*(?:no|number|#)?\s*[:\-]?\s*([A-Za-z0-9X*]{6,})/i);
  if (acct?.[1]) return acct[1].replace(/\*/g, 'X');

  return '';
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

function accountLikelyMatches(hint, accountVal) {
  const h = digitsOnly(hint);
  const a = digitsOnly(accountVal);
  if (!h) return false;
  if (!a) return false;
  if (h.length <= 4) return a.endsWith(h);
  return a.endsWith(h.slice(-4));
}

function isDuplicateByMetadata(existing, accountHint, fromIso, toIso) {
  if (!accountHint || !fromIso || !toIso) return false;
  for (const st of existing) {
    const acc = st?.accountNumber?.val || '';
    if (!accountLikelyMatches(accountHint, acc)) continue;
    const f = toIsoDate(parseLooseDate(st?.statementPeriod?.from || ''));
    const t = toIsoDate(parseLooseDate(st?.statementPeriod?.to || ''));
    if (f === fromIso && t === toIso) return true;
  }
  return false;
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
    const existingStatements = await Statement.find({
      user: user._id,
      isUserRejected: { $ne: true },
    })
      .select('accountNumber statementPeriod')
      .lean();
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
        const snippet = String(full.data.snippet || '');

        const pdfs = await extractPdfAttachments(gmail, messageId);
        if (pdfs.length === 0) continue;

        for (const pdf of pdfs) {
          const bank = identifyBank(subject, from);
          const encrypted = await isPdfEncrypted(pdf.buffer);
          const dateRange = extractDateRangeFromEmail(subject, snippet, pdf.filename);
          const accountHint = extractAccountHint(subject, snippet, pdf.filename);
          const alreadyProcessed = !!(
            dateRange &&
            accountHint &&
            isDuplicateByMetadata(existingStatements, accountHint, dateRange.from, dateRange.to)
          );
          
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
            snippet,
            filename: pdf.filename,
            bank,
            isImported,
            encrypted,
            savedPassword,
            accountHint,
            parsedPeriod: dateRange || null,
            alreadyProcessed,
            alreadyProcessedReason: alreadyProcessed
              ? `Statement already exists for account hint ${accountHint} and period ${dateRange.from} to ${dateRange.to}`
              : '',
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
    const { selections } = req.body; // Array<{ messageId, filename, password, statementType }>
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
        const { messageId, filename, password, statementType = 'CREDIT_CARD' } = sel;
        if (!password || !String(password).trim()) {
          errors.push({ filename, error: 'Password is required for Gmail imports' });
          continue;
        }

        const pdfs = await extractPdfAttachments(gmail, messageId);
        const match = pdfs.find(p => p.filename === filename) || pdfs[0];

        if (!match) {
          errors.push({ filename, error: 'Attachment not found' });
          continue;
        }

        const bankLabel = identifyBank(match.subject, match.from);
        const guessedPeriod = extractDateRangeFromEmail(match.subject, '', filename);
        const guessedAccount = extractAccountHint(match.subject, '', filename);
        if (
          guessedPeriod &&
          guessedAccount &&
          isDuplicateByMetadata(
            await Statement.find({
              user: user._id,
              isUserRejected: { $ne: true },
            }).select('accountNumber statementPeriod').lean(),
            guessedAccount,
            guessedPeriod.from,
            guessedPeriod.to
          )
        ) {
          errors.push({ filename, error: 'already_processed' });
          continue;
        }

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

        const statement = await processStatementPdf({
          userId: user._id,
          pdfBuffer: match.buffer,
          originalFileName: filename,
          pdfPassword: String(password).trim(),
          statementType,
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

// @route   GET /api/gmail/attachment?messageId=&filename=
// @access  Private — raw PDF bytes for browser-side unlock (same flow as manual upload)
exports.downloadGmailAttachment = async (req, res) => {
  try {
    const messageId = String(req.query.messageId || '').trim();
    const filename = String(req.query.filename || '').trim();
    if (!messageId || !filename) {
      return res.status(400).json({ message: 'messageId and filename are required' });
    }

    const user = await User.findById(req.user._id).select('+gmailRefreshToken');
    if (!user?.gmailRefreshToken) {
      return res.status(400).json({ message: 'Connect Gmail first' });
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: user.gmailRefreshToken,
      access_token: user.gmailAccessToken || undefined,
      expiry_date: user.gmailTokenExpiry ? user.gmailTokenExpiry.getTime() : undefined,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const pdfs = await extractPdfAttachments(gmail, messageId);
    const match = pdfs.find((p) => p.filename === filename) || pdfs[0];
    if (!match || !match.buffer?.length) {
      return res.status(404).json({ message: 'PDF attachment not found' });
    }

    user.gmailAccessToken = oauth2Client.credentials.access_token || user.gmailAccessToken;
    if (oauth2Client.credentials.expiry_date) {
      user.gmailTokenExpiry = new Date(oauth2Client.credentials.expiry_date);
    }
    await user.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(match.filename)}`);
    return res.send(match.buffer);
  } catch (error) {
    console.error('downloadGmailAttachment', error);
    res.status(500).json({ message: error.message || 'Failed to download attachment' });
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
