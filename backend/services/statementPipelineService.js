const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const Statement = require('../models/Statement');
const User = require('../models/User');
const { decryptPdf } = require('./pdfService');

console.log('[Pipeline] Initializing Supabase client...');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('[Pipeline] CRITICAL: SUPABASE_URL or SUPABASE_SERVICE_KEY is missing from environment variables!');
}
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'creditUI';
const EXTRACTION_PROMPT = `
Extract the FULL statement into strict JSON.

Rules:
1) Include ALL transaction rows (do not skip any row).
2) Detect statementType as either "BANK" or "CREDIT_CARD".
3) For each transaction, return:
   - date, description, merchantName, amount (numeric, positive)
   - deposit/withdrawal/balance (numeric or null)
   - type ("Credit" or "Debit")
   - category (e.g., Food, Shopping, Transfer)
   - box: [top, left, bottom, right] normalized in 0..1000, page: 1-indexed
4) Return meaningful numeric fields needed for validation:
   - BANK: openingBalance, closingBalance, totalDeposits, totalWithdrawals
   - CREDIT_CARD: previousBalance, outstandingTotal, minPaymentDue, creditLimit, availableLimit
5) Also return:
   - bankName, accountNumber, accountHolder, currency, statementDate
   - statementPeriod: { from, to }
   - paymentDueDate (for credit cards)
   - reconciliationSummary: { openingBalance, closingBalance, totalDebits, totalCredits, transactionCount }

Output JSON object schema (use object format { val, box, page } for all vital fields):
{
  "statementType": "BANK" | "CREDIT_CARD",
  "bankName": { "val": string, "box": [], "page": 0 },
  "accountNumber": { "val": string, "box": [], "page": 0 },
  "accountHolder": { "val": string, "box": [], "page": 0 },
  "currency": string,
  "statementDate": { "val": string, "box": [], "page": 0 },
  "statementPeriod": { "from": string, "to": string, "box": [], "page": 0 },
  "paymentDueDate": { "val": string, "box": [], "page": 0 },
  "openingBalance": { "val": number, "box": [], "page": 0 },
  "closingBalance": { "val": number, "box": [], "page": 0 },
  "outstandingTotal": { "val": number, "box": [], "page": 0 },
  "minPaymentDue": { "val": number, "box": [], "page": 0 },
  "creditLimit": { "val": number, "box": [], "page": 0 },
  "availableLimit": { "val": number, "box": [], "page": 0 },
  "totalCredits": number | null,
  "totalDebits": number | null,
  "transactions": [
    {
      "date": string,
      "description": string,
      "merchantName": string,
      "amount": number,
      "deposit": number | null,
      "withdrawal": number | null,
      "balance": number | null,
      "type": "Credit" | "Debit",
      "category": string,
      "box": [number, number, number, number],
      "page": number
    }
  ],
  "reconciliationSummary": {
    "openingBalance": number | null,
    "closingBalance": number | null,
    "totalDebits": number | null,
    "totalCredits": number | null,
    "transactionCount": number
  },
  "summary": string
}
`;

function toValObject(value, fallback = null) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'val')) {
    return {
      val: value.val ?? fallback,
      box: Array.isArray(value.box) ? value.box : [],
      page: value.page || 0,
    };
  }
  return { val: value ?? fallback, box: [], page: 0 };
}

function toStringValObject(value, fallback = '') {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'val')) {
    return {
      val: String(value.val ?? fallback),
      box: Array.isArray(value.box) ? value.box : [],
      page: value.page || 0,
    };
  }
  return { val: String(value ?? fallback), box: [], page: 0 };
}

function toStatementPeriod(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      from: value.from || '',
      to: value.to || '',
      box: normalizeBox(value.box),
      page: value.page || 0,
    };
  }
  return { from: '', to: '', box: [], page: 0 };
}

function extractTextFromGeminiResponse(response) {
  if (!response) return '';
  if (typeof response.text === 'function') return response.text();
  if (typeof response.text === 'string') return response.text;
  const partText = response.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
  return partText || '';
}

function parseExtractionJson(text) {
  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  return JSON.parse(cleaned);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function valueOfMaybeField(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'val')) {
    return value.val;
  }
  return value;
}

function normalizeBox(boxCandidate) {
  if (!Array.isArray(boxCandidate) || boxCandidate.length === 0) return [];
  // Flatten one level of nesting: Gemini sometimes returns [[top, left, bottom, right]]
  const flat = Array.isArray(boxCandidate[0]) ? boxCandidate[0] : boxCandidate;
  if (flat.length < 4) return [];
  return flat
    .slice(0, 4)
    .map((n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return 0;
      if (v < 0) return 0;
      if (v > 1000) return 1000;
      return Math.round(v);
    });
}

function normalizePage(pageCandidate) {
  const p = Number(pageCandidate);
  if (!Number.isFinite(p) || p < 1) return 0;
  return Math.floor(p);
}

function normalizeStatField(rawValue, fallback = null) {
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, 'val')) {
    return {
      val: rawValue.val ?? fallback,
      box: normalizeBox(rawValue.box),
      page: normalizePage(rawValue.page),
    };
  }
  if (rawValue === undefined || rawValue === null || rawValue === '') return { val: fallback, box: [], page: 0 };
  return { val: rawValue, box: [], page: 0 };
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return null;
}

function normalizeTransactions(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;

      const date = pick(row, ['date', 'Date', 'DATE', 'txnDate', 'transactionDate']) || '';
      const description = pick(row, ['description', 'Description', 'PARTICULARS', 'particulars', 'narration']) || '';
      const merchantName =
        pick(row, ['merchantName', 'merchant', 'payee', 'beneficiary']) ||
        (typeof description === 'string' ? description.slice(0, 120) : '');

      const deposit = toNumber(pick(row, ['deposit', 'Deposit', 'DEPOSITS', 'Deposit (Cr.)', 'credit']));
      const withdrawal = toNumber(pick(row, ['withdrawal', 'Withdrawal', 'WITHDRAWALS', 'Withdrawal (Dr.)', 'debit']));
      const amountFromRow = toNumber(pick(row, ['amount', 'Amount', 'AMOUNT']));
      const amount = amountFromRow ?? deposit ?? withdrawal ?? 0;
      const balance = toNumber(pick(row, ['balance', 'Balance', 'BALANCE', 'runningBalance']));

      const typeRaw = String(pick(row, ['type', 'Type', 'transactionType']) || '').toLowerCase();
      let type = 'Debit';
      if (typeRaw.includes('credit') || typeRaw === 'cr') type = 'Credit';
      else if (typeRaw.includes('debit') || typeRaw === 'dr') type = 'Debit';
      else if (deposit !== null && (withdrawal === null || deposit >= withdrawal)) type = 'Credit';

      const category = pick(row, ['category', 'Category']) || 'Other';
      const box = normalizeBox(pick(row, ['box', 'bbox', 'boundingBox', 'coordinates']));
      const page = normalizePage(pick(row, ['page', 'pageNumber', 'pg']));

      return {
        date: String(date),
        description: String(description),
        merchantName: String(merchantName),
        amount: Math.abs(Number(amount || 0)),
        deposit,
        withdrawal,
        balance,
        type,
        category: String(category),
        box,
        page,
      };
    })
    .filter(Boolean);
}

function buildReconciliation(normalized, statementType) {
  const tx = Array.isArray(normalized.transactions) ? normalized.transactions : [];
  const isBank = statementType === 'BANK';

  const extractedDebits = tx.reduce((sum, t) => {
    const val = toNumber(t.withdrawal) ?? (t.type === 'Debit' ? toNumber(t.amount) : 0) ?? 0;
    return sum + (val || 0);
  }, 0);
  const extractedCredits = tx.reduce((sum, t) => {
    const val = toNumber(t.deposit) ?? (t.type === 'Credit' ? toNumber(t.amount) : 0) ?? 0;
    return sum + (val || 0);
  }, 0);

  const opening = toNumber(valueOfMaybeField(normalized.openingBalance))
    ?? toNumber(normalized.reconciliationSummary?.openingBalance)
    ?? 0;
  const expectedClosing = toNumber(valueOfMaybeField(normalized.closingBalance))
    ?? toNumber(normalized.reconciliationSummary?.closingBalance)
    ?? 0;

  const calculatedClosing = isBank
    ? opening + extractedCredits - extractedDebits
    : opening + extractedDebits - extractedCredits;

  const expectedDebits = toNumber(normalized.reconciliationSummary?.totalDebits);
  const expectedCredits = toNumber(normalized.reconciliationSummary?.totalCredits);

  const debitDelta = expectedDebits === null ? 0 : Math.abs(expectedDebits - extractedDebits);
  const creditDelta = expectedCredits === null ? 0 : Math.abs(expectedCredits - extractedCredits);
  const balanceDelta = Math.abs(expectedClosing - calculatedClosing);

  const reasons = [];
  if (balanceDelta > 0.5) reasons.push(`Closing mismatch: expected ${expectedClosing.toFixed(2)} vs calculated ${calculatedClosing.toFixed(2)}.`);
  if (expectedDebits !== null && debitDelta > 0.5) reasons.push(`Debit mismatch: expected ${expectedDebits.toFixed(2)} vs extracted ${extractedDebits.toFixed(2)}.`);
  if (expectedCredits !== null && creditDelta > 0.5) reasons.push(`Credit mismatch: expected ${expectedCredits.toFixed(2)} vs extracted ${extractedCredits.toFixed(2)}.`);
  const missingBbox = tx.filter((t) => !t.box?.length || !t.page).length;
  if (missingBbox > 0) reasons.push(`${missingBbox} transaction(s) missing bounding boxes.`);

  const matched = balanceDelta <= 1 && debitDelta <= 1 && creditDelta <= 1;

  return {
    matched,
    balanceDelta: Number(balanceDelta.toFixed(2)),
    debitDelta: Number(debitDelta.toFixed(2)),
    creditDelta: Number(creditDelta.toFixed(2)),
    calculatedClosing: Number(calculatedClosing.toFixed(2)),
    expectedClosing: Number(expectedClosing.toFixed(2)),
    extractedDebits: Number(extractedDebits.toFixed(2)),
    extractedCredits: Number(extractedCredits.toFixed(2)),
    extractedDeposits: Number(extractedCredits.toFixed(2)),
    extractedWithdrawals: Number(extractedDebits.toFixed(2)),
    transactionCount: tx.length,
    continuityErrors: 0,
    duplicateCount: 0,
    reasons,
    checkedAt: new Date(),
  };
}

function normalizeExtraction(extraction) {
  if (Array.isArray(extraction)) {
    const transactions = normalizeTransactions(extraction);
    const totalCredits = transactions
      .filter((t) => t.type === 'Credit')
      .reduce((sum, t) => sum + (t.deposit ?? t.amount ?? 0), 0);
    const totalDebits = transactions
      .filter((t) => t.type === 'Debit')
      .reduce((sum, t) => sum + (t.withdrawal ?? t.amount ?? 0), 0);

    return {
      statementType: 'BANK',
      bankName: normalizeStatField(null, 'Unknown Bank'),
      accountNumber: normalizeStatField(''),
      accountHolder: normalizeStatField(''),
      statementDate: normalizeStatField(''),
      statementPeriod: { from: '', to: '', box: [], page: 0 },
      openingBalance: normalizeStatField(transactions[0]?.balance ?? null),
      closingBalance: normalizeStatField(transactions[transactions.length - 1]?.balance ?? null),
      transactions,
      totalCredits,
      totalDebits,
      totalDeposits: normalizeStatField(totalCredits),
      totalWithdrawals: normalizeStatField(totalDebits),
      reconciliationSummary: {
        openingBalance: transactions[0]?.balance ?? null,
        closingBalance: transactions[transactions.length - 1]?.balance ?? null,
        totalDebits,
        totalCredits,
        transactionCount: transactions.length,
      },
      summary: 'Extracted from raw transaction rows.',
    };
  }

  const raw = extraction && typeof extraction === 'object' ? extraction : {};
  const transactions = normalizeTransactions(raw.transactions || raw.txns || []);
  return {
    ...raw,
    statementType: raw.statementType || raw.accountType || raw.type || 'BANK',
    bankName: normalizeStatField(raw.bankName, 'Unknown Bank'),
    accountNumber: normalizeStatField(raw.accountNumber, ''),
    accountHolder: normalizeStatField(raw.accountHolder, ''),
    statementDate: normalizeStatField(raw.statementDate, ''),
    statementPeriod: raw.statementPeriod || { from: '', to: '', box: [], page: 0 },
    openingBalance: normalizeStatField(raw.openingBalance, null),
    closingBalance: normalizeStatField(raw.closingBalance, null),
    totalCredits: normalizeStatField(raw.totalCredits, null),
    totalDebits: normalizeStatField(raw.totalDebits, null),
    totalDeposits: normalizeStatField(raw.totalDeposits, null),
    totalWithdrawals: normalizeStatField(raw.totalWithdrawals, null),
    previousBalance: normalizeStatField(raw.previousBalance, null),
    outstandingTotal: normalizeStatField(raw.outstandingTotal, null),
    minPaymentDue: normalizeStatField(raw.minPaymentDue, null),
    creditLimit: normalizeStatField(raw.creditLimit, null),
    availableLimit: normalizeStatField(raw.availableLimit, null),
    paymentDueDate: normalizeStatField(raw.paymentDueDate, ''),
    totalInterestCharged: normalizeStatField(raw.totalInterestCharged, null),
    totalLateFee: normalizeStatField(raw.totalLateFee, null),
    totalForexFee: normalizeStatField(raw.totalForexFee, null),
    totalFees: normalizeStatField(raw.totalFees, null),
    currency: String(valueOfMaybeField(raw.currency) || 'INR'),
    transactions,
    reconciliationSummary: raw.reconciliationSummary || {
      openingBalance: toNumber(valueOfMaybeField(raw.openingBalance)),
      closingBalance: toNumber(valueOfMaybeField(raw.closingBalance)),
      totalDebits: toNumber(valueOfMaybeField(raw.totalDebits)),
      totalCredits: toNumber(valueOfMaybeField(raw.totalCredits)),
      transactionCount: transactions.length,
    },
  };
}

async function storePdfAndGetPublicUrl(userId, originalFileName, buffer) {
  const ext = path.extname(originalFileName) || '.pdf';
  const safeBase = path.basename(originalFileName, ext).replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 120);
  const pdfFileName = `${userId}-${Date.now()}-${safeBase}${ext}`;

  console.log(`[Pipeline] Uploading PDF to Supabase bucket="${BUCKET}" path="${pdfFileName}"...`);
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(pdfFileName, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadError) {
    console.error(`[Pipeline] Supabase Upload Error:`, uploadError);
    throw new Error(`Failed to upload PDF to storage: ${uploadError.message}`);
  }
  console.log('[Pipeline] Supabase Upload Success');

  console.log('[Pipeline] Creating signed URL...');
  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pdfFileName, 60 * 60 * 24 * 365);

  if (signError || !signedData?.signedUrl) {
    console.error(`[Pipeline] Supabase Signed URL Error:`, signError);
    throw new Error(`Failed to create public URL for uploaded PDF: ${signError?.message || 'unknown error'}`);
  }

  return { pdfFileName, pdfStorageUrl: signedData.signedUrl };
}

async function extractTransactionsWithVertex(pdfStorageUrl) {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    '';
  const location =
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_LOCATION ||
    'us-central1';

  if (!project) {
    console.error('[Pipeline] CRITICAL: Google Project ID is missing. Check GOOGLE_CLOUD_PROJECT or GOOGLE_PROJECT_ID');
    throw new Error(
      'Vertex AI configuration is missing. Set GOOGLE_CLOUD_PROJECT (or GOOGLE_PROJECT_ID) and GOOGLE_CLOUD_LOCATION (or GOOGLE_LOCATION).'
    );
  }
  console.log(`[Pipeline] Initializing Gemini client (Vertex=${!!process.env.GOOGLE_PROJECT_ID}, Project=${project}, Location=${location})`);

  const client = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
  console.log(`[Pipeline] Gemini client ready (vertex project=${project}, location=${location})`);

  const pdfFile = {
    fileData: {
      fileUri: pdfStorageUrl,
      mimeType: 'application/pdf',
    },
  };

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: [pdfFile, EXTRACTION_PROMPT],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 32768,
      },
    });
    console.log('[Pipeline] Gemini generateContent response received');
    const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
    console.log(`[Pipeline] Gemini finish reason: ${finishReason}`);

    const rawText = extractTextFromGeminiResponse(response);
    if (!rawText) {
      console.error('[Pipeline] Gemini returned an empty response candidate.');
      throw new Error('Empty response from Vertex AI');
    }
    console.log(`[Pipeline] Gemini response text length: ${rawText.length}`);

    const usage = response?.usageMetadata;
    if (usage) {
      console.log(
        `[Pipeline] Token usage prompt=${usage.promptTokenCount || 0}, candidates=${usage.candidatesTokenCount || 0}, total=${usage.totalTokenCount || 0}`
      );
    }

    const parsed = parseExtractionJson(rawText);
    return normalizeExtraction(parsed);
  } catch (geminiErr) {
    console.error('[Pipeline] Gemini API call failed:', geminiErr);
    throw geminiErr;
  }
}

function applyExtraction(statement, extraction) {
  const normalized = normalizeExtraction(extraction);
  statement.status = 'COMPLETED';
  statement.processingError = undefined;
  statement.ocrEngine = 'gemini_vision_native';
  statement.type = String(normalized.statementType || statement.type || 'BANK').toUpperCase() === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK';
  statement.rawAIResponse = normalized;
  statement.bankName = toStringValObject(normalized.bankName, statement.bankName?.val || 'Unknown Bank');
  statement.currency = String(valueOfMaybeField(normalized.currency) || 'INR');
  statement.creditLimit = toValObject(normalized.creditLimit, null);
  statement.availableLimit = toValObject(normalized.availableLimit, null);
  statement.outstandingTotal = toValObject(normalized.outstandingTotal, null);
  statement.minPaymentDue = toValObject(normalized.minPaymentDue, null);
  statement.paymentDueDate = toStringValObject(normalized.paymentDueDate, '');
  statement.statementDate = toStringValObject(normalized.statementDate, '');
  statement.statementPeriod = toStatementPeriod(normalized.statementPeriod);
  statement.accountNumber = toStringValObject(normalized.accountNumber, '');
  statement.accountHolder = toStringValObject(normalized.accountHolder, '');
  statement.openingBalance = toValObject(normalized.openingBalance, null);
  statement.closingBalance = toValObject(normalized.closingBalance, null);
  statement.totalDeposits = toValObject(normalized.totalDeposits, null);
  statement.totalWithdrawals = toValObject(normalized.totalWithdrawals, null);
  statement.previousBalance = toValObject(normalized.previousBalance, null);
  statement.lastPaymentAmount = toValObject(normalized.lastPaymentAmount, null);
  statement.lastPaymentDate = toStringValObject(normalized.lastPaymentDate, '');
  statement.totalDebits = toValObject(normalized.totalDebits, null);
  statement.totalCredits = toValObject(normalized.totalCredits, null);
  statement.totalInterestCharged = toValObject(normalized.totalInterestCharged, null);
  statement.totalLateFee = toValObject(normalized.totalLateFee, null);
  statement.totalForexFee = toValObject(normalized.totalForexFee, null);
  statement.totalFees = toValObject(normalized.totalFees, null);
  statement.cashAdvance = normalized.cashAdvance || undefined;
  statement.isRevolvingBalance = typeof normalized.isRevolvingBalance === 'object'
    ? normalized.isRevolvingBalance
    : { val: Boolean(normalized.isRevolvingBalance) };
  statement.rewardPointsEarned = toValObject(normalized.rewardPointsEarned, null);
  statement.rewardPointsRedeemed = toValObject(normalized.rewardPointsRedeemed, null);
  statement.rewardPointsBalance = toValObject(normalized.rewardPointsBalance, null);
  statement.rewardPointsExpiry = toStringValObject(normalized.rewardPointsExpiry, '');
  statement.transactions = Array.isArray(normalized.transactions) ? normalized.transactions : [];
  statement.emiList = Array.isArray(normalized.emiList) ? normalized.emiList : [];
  statement.reconciliationSummary = normalized.reconciliationSummary || undefined;
  statement.summary = normalized.summary || '';

  const rec = buildReconciliation(normalized, statement.type);
  statement.reconciliation = rec;
  if (rec.matched) statement.extractionQuality = 'verified';
  else if (rec.balanceDelta <= 10) statement.extractionQuality = 'minor_mismatch';
  else statement.extractionQuality = 'extraction_error';

  statement.rawAIResponse = {
    ...(statement.rawAIResponse || {}),
    calculationChecker: {
      status: statement.extractionQuality,
      why: rec.reasons?.length ? rec.reasons : ['All balance and aggregate checks passed.'],
      metrics: {
        expectedClosing: rec.expectedClosing,
        calculatedClosing: rec.calculatedClosing,
        balanceDelta: rec.balanceDelta,
        extractedDebits: rec.extractedDebits,
        extractedCredits: rec.extractedCredits,
      },
    },
  };
}

async function processStatementPdf({
  userId,
  pdfBuffer,
  originalFileName,
  pdfPassword,
  statementType = 'CREDIT_CARD',
  gmailMessageId = null,
  isPreUnlocked = false,
  batchIndex = 0,
  batchTotal = 0,
}) {
  const prog = batchTotal > 0 ? `[${batchIndex}/${batchTotal}] ` : '';
  console.log(
    `${prog}[Pipeline] Start processing file="${originalFileName}" user=${userId} source=${gmailMessageId ? 'gmail' : 'manual'} type=${statementType}`
  );

  let pdfForProcessing = pdfBuffer;
  if (isPreUnlocked) {
    console.log('[Pipeline] Skipping backend decryption (frontend unlocked PDF)');
  } else {
    const password = String(pdfPassword || '').trim();
    if (!password) throw new Error('PDF password is required');

    console.log('[Pipeline] Attempting PDF decryption');
    const unlockResult = await decryptPdf(pdfBuffer, password);
    if (!unlockResult.isUnlocked) {
      console.warn(
        `[Pipeline] PDF could not be rebuilt as unlocked. Proceeding with original buffer. ${unlockResult.warning || ''}`
      );
    } else {
      console.log('[Pipeline] PDF decrypted successfully');
    }

    pdfForProcessing = unlockResult.buffer;
  }
  const { pdfFileName, pdfStorageUrl } = await storePdfAndGetPublicUrl(userId, originalFileName, pdfForProcessing);
  console.log(`[Pipeline] Unlocked PDF uploaded to storage as "${pdfFileName}"`);
  console.log(`[Pipeline] Signed URL created: ${pdfStorageUrl.slice(0, 120)}...`);

  console.log('[Pipeline] Sending PDF URL to Gemini for extraction');
  const extraction = await extractTransactionsWithVertex(pdfStorageUrl);
  console.log('[Pipeline] Extraction JSON parsed successfully');

  const statement = await Statement.create({
    user: userId,
    type: statementType,
    status: 'PROCESSING',
    ocrEngine: 'gemini_vision_native',
    pdfStorageUrl,
    pdfFileName,
    pdfPassword: '',
    gmailMessageId,
  });
  console.log(`[Pipeline] Statement record created with id=${statement._id}`);

  applyExtraction(statement, extraction);
  const txCount = statement.transactions?.length || 0;
  const txWithBbox = (statement.transactions || []).filter((t) => t.box?.length && t.page).length;
  console.log(`[Pipeline] Transactions extracted: ${txCount}, with bbox: ${txWithBbox}`);
  if (statement.reconciliation) {
    console.log(
      `[Pipeline] Checker status=${statement.extractionQuality}, matched=${statement.reconciliation.matched}, balanceDelta=${statement.reconciliation.balanceDelta}`
    );
  }
  await statement.save();
  console.log(`[Pipeline] Statement saved successfully with status=${statement.status}`);

  if (gmailMessageId) {
    try {
      const user = await User.findById(userId).select('gmailImportedMessageIds');
      if (user) {
        const prev = user.gmailImportedMessageIds || [];
        const merged = [...new Set([...prev, String(gmailMessageId)])];
        user.gmailImportedMessageIds = merged.slice(-800);
        await user.save();
      }
    } catch (e) {
      console.warn('[Pipeline] Could not update gmailImportedMessageIds:', e?.message || e);
    }
  }

  return statement;
}

async function refreshSignedUrl(pdfFileName, fallbackUrl = '') {
  if (!pdfFileName) return fallbackUrl;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pdfFileName, 60 * 60 * 2);
  if (error || !data?.signedUrl) return fallbackUrl;
  return data.signedUrl;
}

/**
 * Re-run Vertex extraction on the already-stored unlocked PDF (same statement id).
 */
async function reIngestStatementById(userId, statementId) {
  const statement = await Statement.findById(statementId);
  if (!statement || statement.user.toString() !== userId.toString()) {
    throw new Error('Statement not found');
  }
  if (!statement.pdfFileName) {
    throw new Error('No PDF on file for this statement');
  }

  statement.status = 'PROCESSING';
  statement.processingError = undefined;
  statement.isApproved = false;
  statement.isUserRejected = false;
  await statement.save();

  try {
    const freshUrl = await refreshSignedUrl(statement.pdfFileName, statement.pdfStorageUrl || '');
    if (!freshUrl) throw new Error('Could not create signed URL for stored PDF');
    console.log(`[Pipeline] Re-ingest for statement=${statementId}`);
    const extraction = await extractTransactionsWithVertex(freshUrl);
    applyExtraction(statement, extraction);
    await statement.save();
    return statement;
  } catch (err) {
    console.error('[Pipeline] Re-ingest failed:', err);
    statement.status = 'FAILED';
    statement.processingError = err.message || String(err);
    await statement.save();
    throw err;
  }
}

module.exports = {
  processStatementPdf,
  refreshSignedUrl,
  reIngestStatementById,
  applyExtraction,
};
