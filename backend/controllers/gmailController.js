const jwt = require('jsonwebtoken');
const { GoogleGenAI } = require('@google/genai');
const User = require('../models/User');
const Statement = require('../models/Statement');
const {
  createOAuth2Client,
  buildGmailAuthUrl,
  exchangeCodeForTokens,
  extractPdfAttachments,
  getMessageBodyText,
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

function normalizeGeminiJson(text) {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function readGeminiText(response) {
  if (!response) return '';
  if (typeof response.text === 'function') return response.text();
  if (typeof response.text === 'string') return response.text;
  return response?.candidates?.[0]?.content?.parts?.find((p) => typeof p?.text === 'string')?.text || '';
}

function buildUnifiedClassificationPrompt(candidatesWithBodies) {
  const payload = candidatesWithBodies.map((c) => ({
    id: c.id,
    subject: c.subject,
    from: c.from,
    filename: c.filename,
    encrypted: !!c.encrypted,
    alreadyProcessed: !!c.alreadyProcessed,
    emailBody: c.encrypted ? String(c.bodyText || '').trim().slice(0, 15000) : undefined
  }));

  return `
You are a financial document classifier for an Indian personal finance app.

Task: You will be given a JSON array of email attachment candidates. Each has an "id", "subject", "from", "filename", "encrypted" boolean, and optionally an "emailBody".

Part 1: Classification
Decide which attachments are bank account or credit card statements that contain transaction history.
INCLUDE: Bank savings, current, credit card, prepaid card statements.
EXCLUDE: Equity/securities, Demat, mutual funds, trading, contract notes, insurance, wallets.
- If alreadyProcessed=true, you MUST classify it as "skip".
- If unsure, "skip".

Part 2: Password Hint Extraction (Only for encrypted=true)
If an attachment is "encrypted": true, look at its "emailBody" to extract how to construct the PDF password.

Respond ONLY with a valid JSON object matching this exact format:
{
  "results": [
    {
      "id": "candidate-id-1",
      "action": "process",
      "reason": "Credit card statement",
      "passwordHint": {
        "hasPasswordHint": true,
        "passwordRule": "Date of birth in DDMMYYYY format",
        "example": "If DOB is 15/07/1998, password is 15071998",
        "userMessage": "Your password is your date of birth in DDMMYYYY format"
      }
    },
    {
       "id": "candidate-id-2",
       "action": "skip",
       "reason": "Mutual fund statement",
       "passwordHint": null
    }
  ]
}

Candidates:
${JSON.stringify(payload, null, 2)}
`.trim();
}

async function classifyAndExtractHintsUnifiedWithGemini(candidatesWithBodies) {
  if (!candidatesWithBodies || candidatesWithBodies.length === 0) {
    return { results: [] };
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID || '';
  const location = process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_LOCATION || 'us-central1';
  if (!project) throw new Error('Missing GOOGLE_PROJECT_ID for Gmail classification');

  const client = new GoogleGenAI({ vertexai: true, project, location });
  const prompt = buildUnifiedClassificationPrompt(candidatesWithBodies);
  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [prompt],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  const raw = normalizeGeminiJson(readGeminiText(response));
  const parsed = JSON.parse(raw || '{"results": []}');
  
  return parsed;
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
  const startedAt = Date.now();
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
    console.log(
      `[Gmail Candidates] start user=${req.user._id} query="${q}" maxResults=${maxResults}`
    );
    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults });

    const messageRefs = listRes.data.messages || [];
    console.log(
      `[Gmail API] messages.list returned count=${messageRefs.length} nextPageToken=${listRes.data.nextPageToken ? 'yes' : 'no'}`
    );
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
        const metaStart = Date.now();
        console.log(`[Gmail API] messages.get(format=metadata) start messageId=${messageId}`);
        const full = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata' });
        console.log(
          `[Gmail API] messages.get(format=metadata) success messageId=${messageId} elapsedMs=${Date.now() - metaStart}`
        );
        const headers = full.data.payload?.headers || [];
        const subject = (headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '').trim();
        const from = (headers.find(h => h.name?.toLowerCase() === 'from')?.value || '').trim();
        const date = (headers.find(h => h.name?.toLowerCase() === 'date')?.value || '');
        const snippet = String(full.data.snippet || '');
        console.log(
          `[Gmail Parse] metadata messageId=${messageId} subject="${subject.slice(0, 80)}" from="${from.slice(0, 60)}" snippetChars=${snippet.length}`
        );

        const pdfs = await extractPdfAttachments(gmail, messageId);
        if (pdfs.length === 0) {
          console.log(`[Gmail Parse] messageId=${messageId} skipped reason=no_pdf_attachment`);
          continue;
        }
        console.log(`[Gmail Parse] messageId=${messageId} pdfCount=${pdfs.length}`);

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
          console.log(
            `[Gmail Transform] messageId=${messageId} file="${pdf.filename}" bytes=${pdf.buffer.length} bank=${bank} encrypted=${encrypted} accountHint=${accountHint || '-'} period=${dateRange ? `${dateRange.from}..${dateRange.to}` : '-'} alreadyProcessed=${alreadyProcessed}`
          );

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
    console.log(`[Gmail Candidates] built candidates=${candidates.length}`);

    const encryptedMessageIds = [...new Set(candidates.filter((c) => c.encrypted).map((c) => c.messageId))];
    const bodyTextsMap = new Map();
    
    if (encryptedMessageIds.length > 0) {
       console.log(`[Gmail Candidates] fetching body text for ${encryptedMessageIds.length} encrypted emails`);
       await Promise.all(
         encryptedMessageIds.map(async (mid) => {
           try {
             const text = await getMessageBodyText(gmail, mid);
             bodyTextsMap.set(mid, text);
           } catch (e) {
             console.warn('Failed to fetch email body for password hint', mid, e?.message);
             bodyTextsMap.set(mid, '');
           }
         })
       );
    }

    const candidatesWithBodies = candidates.map(c => ({
      ...c,
      bodyText: c.encrypted ? bodyTextsMap.get(c.messageId) || '' : ''
    }));

    let processIds = new Set(
      candidates.filter((c) => !c.alreadyProcessed && (!c.isImported || !c.existsInDb)).map((c) => c.id)
    );
    const reasons = new Map();
    const hints = new Map();

    console.log(`[Gmail Transform] Sending ${candidatesWithBodies.length} candidates to Gemini for unified classification & hints`);
    
    const BATCH_SIZE = 20;
    for (let i = 0; i < candidatesWithBodies.length; i += BATCH_SIZE) {
       const batch = candidatesWithBodies.slice(i, i + BATCH_SIZE);
       try {
          const result = await classifyAndExtractHintsUnifiedWithGemini(batch);
          for (const row of result.results || []) {
             if (row.action === 'process') processIds.add(row.id);
             else processIds.delete(row.id);
             reasons.set(row.id, row.reason || (row.action === 'process' ? 'Relevant' : 'Skipped'));
             if (row.passwordHint) {
                hints.set(row.id, row.passwordHint);
             }
          }
       } catch(e) {
          console.warn('Unified Gemini call failed for batch', e?.message || e);
       }
    }

    const enriched = candidates.map((c) => {
      const shouldProcess = processIds.has(c.id) && !c.alreadyProcessed;
      return {
        ...c,
        passwordHint: c.encrypted ? (hints.get(c.id) || null) : null,
        shouldProcess,
        classificationReason: reasons.get(c.id) || (shouldProcess ? 'Relevant statement' : 'Skipped by classifier'),
      };
    });

    console.log(
      `[Gmail Candidates] response candidates=${enriched.length} elapsedMs=${Date.now() - startedAt}`
    );
    res.json({ candidates: enriched });
  } catch (error) {
    console.error('listGmailCandidates', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

// @route   POST /api/gmail/sync-selected
// @access  Private
exports.syncGmailSelected = async (req, res) => {
  const startedAt = Date.now();
  try {
    const { selections } = req.body; // Array<{ messageId, filename, password, statementType }>
    if (!selections || !Array.isArray(selections)) {
      return res.status(400).json({ message: 'No selections provided' });
    }
    console.log(
      `[Gmail SyncSelected] start user=${req.user._id} selections=${selections.length}`
    );

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

    for (let index = 0; index < selections.length; index += 1) {
      const sel = selections[index];
      const selStart = Date.now();
      try {
        const { messageId, filename, password, statementType = 'CREDIT_CARD' } = sel;
        console.log(
          `[Gmail SyncSelected] [${index + 1}/${selections.length}] begin file="${filename}" messageId=${messageId} type=${statementType}`
        );
        if (!password || !String(password).trim()) {
          errors.push({ filename, error: 'Password is required for Gmail imports' });
          console.warn(
            `[Gmail SyncSelected] [${index + 1}/${selections.length}] missing password file="${filename}"`
          );
          continue;
        }

        const pdfs = await extractPdfAttachments(gmail, messageId);
        const match = pdfs.find(p => p.filename === filename) || pdfs[0];

        if (!match) {
          errors.push({ filename, error: 'Attachment not found' });
          console.warn(
            `[Gmail SyncSelected] [${index + 1}/${selections.length}] attachment not found file="${filename}"`
          );
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
          console.log(
            `[Gmail SyncSelected] [${index + 1}/${selections.length}] duplicate skipped file="${filename}"`
          );
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
        console.log(
          `[Gmail SyncSelected] [${index + 1}/${selections.length}] done file="${filename}" statementId=${statement._id} elapsedMs=${Date.now() - selStart}`
        );
      } catch (err) {
        errors.push({ filename: sel.filename, error: err.message });
        console.error(
          `[Gmail SyncSelected] [${index + 1}/${selections.length}] failed file="${sel.filename}" elapsedMs=${Date.now() - selStart} error=${err?.message || err}`
        );
      }
    }

    user.gmailImportedMessageIds = [...imported].slice(-800);
    user.gmailLastSyncAt = new Date();
    user.gmailAccessToken = oauth2Client.credentials.access_token || user.gmailAccessToken;
    if (oauth2Client.credentials.expiry_date) user.gmailTokenExpiry = new Date(oauth2Client.credentials.expiry_date);

    await user.save();
    console.log(
      `[Gmail SyncSelected] completed created=${created.length} errors=${errors.length} elapsedMs=${Date.now() - startedAt}`
    );
    res.json({ created, errors });
  } catch (error) {
    console.error('syncGmailSelected', error);
    res.status(500).json({ message: 'Batch sync failed' });
  }
};

// @route   GET /api/gmail/attachment?messageId=&filename=
// @access  Private — raw PDF bytes for browser-side unlock (same flow as manual upload)
exports.downloadGmailAttachment = async (req, res) => {
  const startedAt = Date.now();
  try {
    const messageId = String(req.query.messageId || '').trim();
    const filename = String(req.query.filename || '').trim();
    if (!messageId || !filename) {
      return res.status(400).json({ message: 'messageId and filename are required' });
    }
    console.log(
      `[Gmail Attachment] start user=${req.user._id} messageId=${messageId} filename="${filename}"`
    );

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
      console.warn(
        `[Gmail Attachment] not found messageId=${messageId} filename="${filename}" elapsedMs=${Date.now() - startedAt}`
      );
      return res.status(404).json({ message: 'PDF attachment not found' });
    }

    user.gmailAccessToken = oauth2Client.credentials.access_token || user.gmailAccessToken;
    if (oauth2Client.credentials.expiry_date) {
      user.gmailTokenExpiry = new Date(oauth2Client.credentials.expiry_date);
    }
    await user.save();

    console.log(
      `[Gmail Attachment] success messageId=${messageId} filename="${match.filename}" size=${match.buffer.length} elapsedMs=${Date.now() - startedAt}`
    );
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
