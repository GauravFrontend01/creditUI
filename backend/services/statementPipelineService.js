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
  const client = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  });

  const pdfFile = {
    fileData: {
      fileUri: pdfStorageUrl,
      mimeType: 'application/pdf',
    },
  };

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [pdfFile, 'Extract all transactions as structured JSON'],
  });

  const rawText = extractTextFromGeminiResponse(response);
  if (!rawText) throw new Error('Empty response from Vertex AI');
  return parseExtractionJson(rawText);
}

function applyExtraction(statement, extraction) {
  statement.status = 'COMPLETED';
  statement.ocrEngine = 'gemini_vision_native';
  statement.rawAIResponse = extraction;
  statement.bankName = toStringValObject(extraction.bankName, statement.bankName?.val || 'Unknown Bank');
  statement.currency = extraction.currency || 'INR';
  statement.creditLimit = toValObject(extraction.creditLimit, null);
  statement.availableLimit = toValObject(extraction.availableLimit, null);
  statement.outstandingTotal = toValObject(extraction.outstandingTotal, null);
  statement.minPaymentDue = toValObject(extraction.minPaymentDue, null);
  statement.paymentDueDate = toStringValObject(extraction.paymentDueDate, '');
  statement.statementDate = toStringValObject(extraction.statementDate, '');
  statement.statementPeriod = toStatementPeriod(extraction.statementPeriod);
  statement.accountNumber = toStringValObject(extraction.accountNumber, '');
  statement.accountHolder = toStringValObject(extraction.accountHolder, '');
  statement.openingBalance = toValObject(extraction.openingBalance, null);
  statement.closingBalance = toValObject(extraction.closingBalance, null);
  statement.totalDeposits = toValObject(extraction.totalDeposits, null);
  statement.totalWithdrawals = toValObject(extraction.totalWithdrawals, null);
  statement.previousBalance = toValObject(extraction.previousBalance, null);
  statement.lastPaymentAmount = toValObject(extraction.lastPaymentAmount, null);
  statement.lastPaymentDate = toStringValObject(extraction.lastPaymentDate, '');
  statement.totalDebits = toValObject(extraction.totalDebits, null);
  statement.totalCredits = toValObject(extraction.totalCredits, null);
  statement.totalInterestCharged = toValObject(extraction.totalInterestCharged, null);
  statement.totalLateFee = toValObject(extraction.totalLateFee, null);
  statement.totalForexFee = toValObject(extraction.totalForexFee, null);
  statement.totalFees = toValObject(extraction.totalFees, null);
  statement.cashAdvance = extraction.cashAdvance || undefined;
  statement.isRevolvingBalance = typeof extraction.isRevolvingBalance === 'object'
    ? extraction.isRevolvingBalance
    : { val: Boolean(extraction.isRevolvingBalance) };
  statement.rewardPointsEarned = toValObject(extraction.rewardPointsEarned, null);
  statement.rewardPointsRedeemed = toValObject(extraction.rewardPointsRedeemed, null);
  statement.rewardPointsBalance = toValObject(extraction.rewardPointsBalance, null);
  statement.rewardPointsExpiry = toStringValObject(extraction.rewardPointsExpiry, '');
  statement.transactions = Array.isArray(extraction.transactions) ? extraction.transactions : [];
  statement.emiList = Array.isArray(extraction.emiList) ? extraction.emiList : [];
  statement.reconciliationSummary = extraction.reconciliationSummary || undefined;
  statement.summary = extraction.summary || '';
  statement.extractionQuality = 'unverified';
}

async function processStatementPdf({
  userId,
  pdfBuffer,
  originalFileName,
  pdfPassword,
  statementType = 'CREDIT_CARD',
  gmailMessageId = null,
}) {
  const password = String(pdfPassword || '').trim();
  if (!password) throw new Error('PDF password is required');

  const unlockResult = await decryptPdf(pdfBuffer, password);
  if (!unlockResult.isUnlocked) {
    throw new Error('Unable to produce unlocked PDF. Please use a PDF that can be decrypted with the provided password.');
  }

  const unlockedPdfBuffer = unlockResult.buffer;
  const { pdfFileName, pdfStorageUrl } = await storePdfAndGetPublicUrl(userId, originalFileName, unlockedPdfBuffer);
  const extraction = await extractTransactionsWithVertex(pdfStorageUrl);

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

  applyExtraction(statement, extraction);
  await statement.save();
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
