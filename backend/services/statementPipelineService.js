const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const Statement = require('../models/Statement');
const { decryptPdf } = require('./pdfService');

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
   - date
   - description
   - merchantName
   - amount (numeric, positive)
   - deposit (numeric or null)
   - withdrawal (numeric or null)
   - balance (numeric or null)
   - type ("Credit" or "Debit")
   - category (one of: Transfer, EMI, Salary, Refund, ATM, Cash, Card Payment, Shopping, Travel, Utility, Food, Health, Education, Investment, Fee, Interest, Tax, Subscription, Rent, Insurance, Other)
4) Return meaningful numeric fields needed for validation:
   - openingBalance, closingBalance, totalCredits, totalDebits, totalDeposits, totalWithdrawals
5) Also return:
   - bankName, accountNumber, accountHolder, currency, statementDate
   - statementPeriod: { from, to }
   - reconciliationSummary: { openingBalance, closingBalance, totalDebits, totalCredits, transactionCount }
   - summary (short text)

Output JSON object schema:
{
  "statementType": "BANK" | "CREDIT_CARD",
  "bankName": string,
  "accountNumber": string,
  "accountHolder": string,
  "currency": string,
  "statementDate": string,
  "statementPeriod": { "from": string, "to": string },
  "openingBalance": number | null,
  "closingBalance": number | null,
  "totalCredits": number | null,
  "totalDebits": number | null,
  "totalDeposits": number | null,
  "totalWithdrawals": number | null,
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
      "category": string
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
      box: Array.isArray(value.box) ? value.box : [],
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
      };
    })
    .filter(Boolean);
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
      transactions,
      totalCredits,
      totalDebits,
      totalDeposits: totalCredits,
      totalWithdrawals: totalDebits,
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
    openingBalance: toNumber(raw.openingBalance),
    closingBalance: toNumber(raw.closingBalance),
    totalCredits: toNumber(raw.totalCredits),
    totalDebits: toNumber(raw.totalDebits),
    totalDeposits: toNumber(raw.totalDeposits),
    totalWithdrawals: toNumber(raw.totalWithdrawals),
    transactions,
    reconciliationSummary: raw.reconciliationSummary || {
      openingBalance: toNumber(raw.openingBalance),
      closingBalance: toNumber(raw.closingBalance),
      totalDebits: toNumber(raw.totalDebits),
      totalCredits: toNumber(raw.totalCredits),
      transactionCount: transactions.length,
    },
  };
}

async function storePdfAndGetPublicUrl(userId, originalFileName, buffer) {
  const ext = path.extname(originalFileName) || '.pdf';
  const safeBase = path.basename(originalFileName, ext).replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 120);
  const pdfFileName = `${userId}-${Date.now()}-${safeBase}${ext}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(pdfFileName, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadError) throw new Error(`Failed to upload PDF to storage: ${uploadError.message}`);

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pdfFileName, 60 * 60 * 24 * 365);

  if (signError || !signedData?.signedUrl) {
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
    throw new Error(
      'Vertex AI configuration is missing. Set GOOGLE_CLOUD_PROJECT (or GOOGLE_PROJECT_ID) and GOOGLE_CLOUD_LOCATION (or GOOGLE_LOCATION).'
    );
  }

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

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
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
  if (!rawText) throw new Error('Empty response from Vertex AI');
  console.log(`[Pipeline] Gemini response text length: ${rawText.length}`);

  const usage = response?.usageMetadata;
  if (usage) {
    console.log(
      `[Pipeline] Token usage prompt=${usage.promptTokenCount || 0}, candidates=${usage.candidatesTokenCount || 0}, total=${usage.totalTokenCount || 0}`
    );
  }

  const preview = rawText.replace(/\s+/g, ' ').slice(0, 300);
  console.log(`[Pipeline] Gemini response preview: ${preview}`);

  const parsed = parseExtractionJson(rawText);
  return normalizeExtraction(parsed);
}

function applyExtraction(statement, extraction) {
  const normalized = normalizeExtraction(extraction);
  statement.status = 'COMPLETED';
  statement.ocrEngine = 'gemini_vision_native';
  statement.type = String(normalized.statementType || statement.type || 'BANK').toUpperCase() === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK';
  statement.rawAIResponse = normalized;
  statement.bankName = toStringValObject(normalized.bankName, statement.bankName?.val || 'Unknown Bank');
  statement.currency = normalized.currency || 'INR';
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
  statement.extractionQuality = 'unverified';
}

async function processStatementPdf({
  userId,
  pdfBuffer,
  originalFileName,
  pdfPassword,
  statementType = 'CREDIT_CARD',
  gmailMessageId = null,
  isPreUnlocked = false,
}) {
  console.log(
    `[Pipeline] Start processing file="${originalFileName}" user=${userId} source=${gmailMessageId ? 'gmail' : 'manual'} type=${statementType}`
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
  await statement.save();
  console.log(`[Pipeline] Statement saved successfully with status=${statement.status}`);
  return statement;
}

async function refreshSignedUrl(pdfFileName, fallbackUrl = '') {
  if (!pdfFileName) return fallbackUrl;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pdfFileName, 60 * 60 * 2);
  if (error || !data?.signedUrl) return fallbackUrl;
  return data.signedUrl;
}

module.exports = {
  processStatementPdf,
  refreshSignedUrl,
};
