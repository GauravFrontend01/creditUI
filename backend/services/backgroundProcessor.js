const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const FormData = require("form-data");
const { fromBuffer } = require("pdf2pic");
const fs = require("fs");
const path = require("path");
const Statement = require("../models/Statement");
const VendorRule = require("../models/VendorRule");

const API_KEY = process.env.GOOGLE_API_KEY || "";
const genAI = new GoogleGenerativeAI(API_KEY);

const { Mistral } = require('@mistralai/mistralai');
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const { PDFDocument } = require('pdf-lib');

const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY || "K89900476788957";

const processWithMistralOCR = async (pdfBuffer, originalFileName) => {
  try {
    console.log(`[Neural Flow] Initializing Mistral OCR pass for ${originalFileName}...`);

    // Mistral OCR prefers files under a certain size and page count
    // We'll send the whole buffer for now but use the Blob + Signed URL strategy
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    const uploadedFile = await mistral.files.upload({
      file: {
        fileName: originalFileName || 'statement.pdf',
        content: blob
      },
      purpose: 'ocr'
    });

    const signedUrl = await mistral.files.getSignedUrl({ fileId: uploadedFile.id });

    const ocrResponse = await mistral.ocr.process({
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        documentUrl: signedUrl.url
      },
      includeImageBase64: true,
      table_format: 'html'
    });

    return {
      type: 'MISTRAL_OCR_RAW',
      data: ocrResponse,
      fileId: uploadedFile.id
    };
  } catch (error) {
    console.error('[Neural Flow] Mistral OCR failed:', error);
    throw error;
  }
};

const processWithGroq = async (ocrText, activePrompt) => {
  try {
    console.log(`[LLM Flow] Dispatching to Groq (Llama-3-70b-versatile)...`);

    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a specialized financial auditor. Extract structured JSON as requested." },
        { role: "user", content: `${activePrompt}\n\nRAW DATA:\n${ocrText}` }
      ],
      model: "llama-3.3-70b-versatile", // Using 3.3 as it is the most stable 70b on groq currently
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('[LLM Flow] Groq execution failed:', error);
    throw error;
  }
};

const processWithOCRSpace = async (pdfBuffer, activePrompt, activeSchema, engineVariant = "1") => {
  try {
    console.log(`[OCR.space Chain Environment] Sending PDF buffer (${Math.round(pdfBuffer.length / 1024)}KB) to OCR.space with Engine ${engineVariant}...`);

    const formData = new FormData();
    formData.append("file", pdfBuffer, { filename: 'statement.pdf', contentType: 'application/pdf' });
    formData.append("apikey", OCR_SPACE_API_KEY);
    formData.append("language", "eng");
    formData.append("isOverlayRequired", "true");
    formData.append("isTable", "true");
    formData.append("OCREngine", engineVariant);

    const response = await axios.post("https://api.ocr.space/parse/image", formData, {
      headers: { ...formData.getHeaders() },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (response.data.IsErroredOnProcessing || response.data.OCRExitCode > 2) {
      const errMsg = response.data.ErrorMessage || response.data.ErrorDetails || "Unknown OCR.space error";
      throw new Error(`OCR.space API error: ${errMsg}`);
    }

    const parsedResults = response.data.ParsedResults;
    if (!parsedResults || parsedResults.length === 0) {
      throw new Error("OCR.space returned no parsed results.");
    }

    // Return data for all pages
    return {
      type: 'OCR_SPACE_RAW',
      parsedResults: parsedResults.map(p => ({
        overlay: p.TextOverlay,
        text: p.ParsedText,
        page: p.PageNumber || 1
      }))
    };
  } catch (err) {
    console.error("[OCR.space Chain] Processing error:", err.message);
    throw err;
  }
};

const promptText = `Analyze this credit card statement carefully. YOU MUST EXTRACT EVERY SINGLE TRANSACTION FROM EVERY SINGLE PAGE. DO NOT SKIP ANY DATA. 

CRITICAL INSTRUCTIONS:
1. You are a rigid JSON generation machine. 
2. Output ONLY the raw JSON object. Do NOT include any markdown formatting like \`\`\`json.
3. Do NOT include any conversational text, explanations, or analysis before or after the JSON.
4. Do NOT abbreviate, truncate, or skip any transactions. NEVER use "...". You must output the entire list.

For every extracted field, provide bounding box coords in a flat array of exactly 4 numbers: [ymin, xmin, ymax, xmax] in normalized scale [0-1000] and the page number. Do not use nested arrays like [[y,x], [y,x]].

Identify the primary currency used in the statement (e.g., INR, USD, GBP, EUR).
Return the currency as an ISO code.

Categorize each transaction into one of: 
Food, Travel, Shopping, Entertainment, Utilities, Healthcare, 
Fuel, EMI, Subscription, Forex, Fee, Cashback, Other.

Also provide a "categoryConfidence" score from 0 to 100 indicating how certain you are of the category choice. If it's ambiguous (e.g., SWIGGY could be Food or Groceries), provide a lower score like 60-70.

Mark isRecurring: true if the merchant appears more than once OR if it looks 
like a subscription (Netflix, Spotify, insurance, etc).

Mark isForex: true if the transaction involves a foreign currency or 
international merchant.

RECONCILIATION SUMMARY QUIRKS:
1. EMI installments appear as both a credit and a debit — extract both rows separately. Do not deduplicate.
2. Finance charges often have an internal reference suffix (e.g. FIN CHGS FOR THIS STMT...  - 20001 - 1), do NOT parse that suffix as an amount.
3. Your provided 'reconciliationSummary' fields must be exactly what is PRINTED on the statement sum section, not what you calculate.

Return ONLY valid JSON in this exact structure:
{
  "currency": string,
  "bankName": { "val": string, "box": [number, number, number, number], "page": number },
  "creditLimit": { "val": number, "box": [number, number, number, number], "page": number },
  "availableLimit": { "val": number, "box": [number, number, number, number], "page": number },
  "outstandingTotal": { "val": number, "box": [number, number, number, number], "page": number },
  "minPaymentDue": { "val": number, "box": [number, number, number, number], "page": number },
  "paymentDueDate": { "val": string, "box": [number, number, number, number], "page": number },
  "statementDate": { "val": string, "box": [number, number, number, number], "page": number },
  "statementPeriod": { "from": string, "to": string, "box": [number, number, number, number], "page": number },

  "previousBalance": { "val": number, "box": [number, number, number, number], "page": number },
  "lastPaymentAmount": { "val": number, "box": [number, number, number, number], "page": number },
  "lastPaymentDate": { "val": string, "box": [number, number, number, number], "page": number },

  "totalDebits": { "val": number, "box": [number, number, number, number], "page": number },
  "totalCredits": { "val": number, "box": [number, number, number, number], "page": number },
  "totalInterestCharged": { "val": number, "box": [number, number, number, number], "page": number },
  "totalLateFee": { "val": number, "box": [number, number, number, number], "page": number },
  "totalForexFee": { "val": number, "box": [number, number, number, number], "page": number },
  "totalFees": { "val": number, "box": [number, number, number, number], "page": number },
  "cashAdvance": { "amount": number, "fee": number, "box": [number, number, number, number], "page": number },
  "isRevolvingBalance": { "val": boolean },

  "rewardPointsEarned": { "val": number, "box": [number, number, number, number], "page": number },
  "rewardPointsRedeemed": { "val": number, "box": [number, number, number, number], "page": number },
  "rewardPointsBalance": { "val": number, "box": [number, number, number, number], "page": number },
  "rewardPointsExpiry": { "val": string, "box": [number, number, number, number], "page": number },

  "transactions": [{
    "date": string,
    "description": "string (the FULL raw text of the transaction line)",
    "merchantName": "string (the cleaned-up, concise name of the merchant)",
    "amount": number,
    "type": "Debit" | "Credit",
    "category": string,
    "categoryConfidence": number,
    "isRecurring": boolean,
    "isForex": boolean,
    "box": [number, number, number, number],
    "page": number
  }],

  "emiList": [{
    "name": string,
    "amount": number,
    "box": [number, number, number, number],
    "page": number
  }],

  "reconciliationSummary": {
    "openingBalance": number,
    "closingBalance": number,
    "totalDebits": number,
    "totalCredits": number,
    "transactionCount": number
  },
  "summary": string
}
`;

const bankPromptText = `Analyze this Bank Statement carefully. YOU MUST EXTRACT EVERY SINGLE TRANSACTION FROM EVERY SINGLE PAGE. DO NOT SKIP ANY DATA. 

CRITICAL INSTRUCTIONS:
1. You are a rigid JSON generation machine. 
2. Output ONLY the raw JSON object. 
3. Do NOT abbreviate, truncate, or skip any transactions.
4. For bank statements, "Deposits" are Credits and "Withdrawals" are Debits.
5. You MUST extract the "Balance" field for every single transaction row accurately.

For every extracted field, provide bounding box coords in a flat array of exactly 4 numbers: [ymin, xmin, ymax, xmax] in normalized scale [0-1000] and the page number.

Identify the primary currency used in the statement (e.g., INR, USD).

Return ONLY valid JSON in this exact structure:
{
  "currency": string,
  "bankName": { "val": string, "box": [number, number, number, number], "page": number },
  "accountNumber": { "val": string, "box": [number, number, number, number], "page": number },
  "accountHolder": { "val": string, "box": [number, number, number, number], "page": number },
  "statementPeriod": { "from": string, "to": string, "box": [number, number, number, number], "page": number },

  "openingBalance": { "val": number, "box": [number, number, number, number], "page": number },
  "closingBalance": { "val": number, "box": [number, number, number, number], "page": number },
  "totalDeposits": { "val": number, "box": [number, number, number, number], "page": number },
  "totalWithdrawals": { "val": number, "box": [number, number, number, number], "page": number },

  "transactions": [{
    "date": string,
    "description": "string (the FULL raw text)",
    "deposit": number (0 if none),
    "withdrawal": number (0 if none),
    "balance": number (The running balance PRINTED on this exact row),
    "type": "Credit" | "Debit",
    "box": [number, number, number, number],
    "page": number
  }],

  "reconciliationSummary": {
    "openingBalance": number,
    "closingBalance": number,
    "totalDeposits": number,
    "totalWithdrawals": number,
    "transactionCount": number
  },
  "summary": string
}
`;

const extractionSchema = {
  description: "Credit card statement extraction schema",
  type: "object",
  properties: {
    currency: { type: "string", description: "Primary currency ISO code (e.g. INR, USD)" },
    bankName: {
      type: "object",
      properties: {
        val: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    creditLimit: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    availableLimit: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    outstandingTotal: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    minPaymentDue: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    paymentDueDate: {
      type: "object",
      properties: {
        val: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    statementDate: {
      type: "object",
      properties: {
        val: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    statementPeriod: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["from", "to"]
    },
    previousBalance: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    lastPaymentAmount: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    lastPaymentDate: {
      type: "object",
      properties: {
        val: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    totalDebits: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    totalCredits: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    totalInterestCharged: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    totalLateFee: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    totalForexFee: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    totalFees: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["val"]
    },
    cashAdvance: {
      type: "object",
      properties: {
        amount: { type: "number" },
        fee: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      },
      required: ["amount"]
    },
    isRevolvingBalance: {
      type: "object",
      properties: { val: { type: "boolean" } },
      required: ["val"]
    },
    rewardPointsEarned: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    rewardPointsRedeemed: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    rewardPointsBalance: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    rewardPointsExpiry: {
      type: "object",
      properties: { val: { type: "string" } }
    },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          description: { type: "string" },
          merchantName: { type: "string" },
          amount: { type: "number" },
          type: { type: "string", enum: ["Debit", "Credit"] },
          category: { type: "string" },
          categoryConfidence: { type: "number" },
          isRecurring: { type: "boolean" },
          isForex: { type: "boolean" },
          box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
          page: { type: "number" }
        },
        required: ["date", "description", "amount", "type"]
      }
    },
    emiList: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
          page: { type: "number" }
        }
      }
    },
    reconciliationSummary: {
      type: "object",
      properties: {
        openingBalance: { type: "number" },
        closingBalance: { type: "number" },
        totalDebits: { type: "number" },
        totalCredits: { type: "number" },
        transactionCount: { type: "number" }
      }
    },
    summary: { type: "string" }
  },
  required: ["bankName", "currency", "transactions", "reconciliationSummary"]
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

const bankExtractionSchema = {
  description: "Bank statement extraction schema",
  type: "object",
  properties: {
    currency: { type: "string" },
    bankName: {
      type: "object",
      properties: {
        val: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    accountNumber: {
      type: "object",
      properties: {
        val: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    openingBalance: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    closingBalance: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    totalDeposits: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    totalWithdrawals: {
      type: "object",
      properties: {
        val: { type: "number" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    statementPeriod: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        page: { type: "number" }
      }
    },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          description: { type: "string" },
          deposit: { type: "number" },
          withdrawal: { type: "number" },
          balance: { type: "number" },
          type: { type: "string", enum: ["Credit", "Debit"] },
          box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
          page: { type: "number" }
        }
      }
    },
    reconciliationSummary: {
      type: "object",
      properties: {
        openingBalance: { type: "number", description: "Balance before the first transaction in the statement" },
        closingBalance: { type: "number", description: "Final balance after the last transaction in the statement" },
        totalDeposits: { type: "number", description: "SUM of all deposits/credits across ALL pages. If the PDF only gives page-wise totals, SUM them yourself into this final total." },
        totalWithdrawals: { type: "number", description: "SUM of all withdrawals/debits across ALL pages. If the PDF only gives page-wise totals, SUM them yourself into this final total." },
        transactionCount: { type: "number", description: "Total count of transaction rows extracted" }
      }
    },
    summary: { type: "string" }
  },
  required: ["bankName", "currency", "transactions", "reconciliationSummary"]
};

function reconcileBankStatement(summary, transactions) {
  if (!summary) summary = {};
  const {
    openingBalance = 0,
    closingBalance = 0,
    totalDeposits = null,
    totalWithdrawals = null,
    transactionCount = 0
  } = summary;

  const reasons = [];
  let matched = true;

  // 1. Opening + Credits - Debits = Closing
  const extractedDeposits = round2(transactions.reduce((sum, t) => sum + (t.deposit || 0), 0));
  const extractedWithdrawals = round2(transactions.reduce((sum, t) => sum + (t.withdrawal || 0), 0));
  const calculatedClosing = round2(openingBalance + extractedDeposits - extractedWithdrawals);
  const balanceDelta = round2(Math.abs(calculatedClosing - closingBalance));

  if (balanceDelta > 0.02) {
    matched = false;
    reasons.push(`Overall math mismatch: Expected closing ${closingBalance}, but calculated ${calculatedClosing} (Op: ${openingBalance} + Dep: ${extractedDeposits} - Wth: ${extractedWithdrawals})`);
  }

  // 2. Running Balance Continuity
  let currentRunningBalance = openingBalance;
  let continuityFails = 0;
  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    const expectedRowBalance = round2(currentRunningBalance + (t.deposit || 0) - (t.withdrawal || 0));
    if (round2(Math.abs(expectedRowBalance - t.balance)) > 0.05) {
      continuityFails++;
      if (continuityFails <= 3) {
        reasons.push(`Continuity fail at row ${i + 1}: Start ${currentRunningBalance} -> End ${t.balance} (Expected ${expectedRowBalance})`);
      }
    }
    currentRunningBalance = t.balance; // Pivot to printed balance to prevent cascading errors for single misreads
  }
  if (continuityFails > 0) {
    matched = false;
    if (continuityFails > 3) reasons.push(`... and ${continuityFails - 3} more continuity errors.`);
  }

  // 3. Totals Check
  if (totalDeposits !== null && Math.abs(extractedDeposits - totalDeposits) > 0.02) {
    matched = false;
    reasons.push(`Total Deposits mismatch: Extracted ${extractedDeposits}, Statement shows ${totalDeposits}`);
  }
  if (totalWithdrawals !== null && Math.abs(extractedWithdrawals - totalWithdrawals) > 0.02) {
    matched = false;
    reasons.push(`Total Withdrawals mismatch: Extracted ${extractedWithdrawals}, Statement shows ${totalWithdrawals}`);
  }

  // 4. Count Check
  if (transactionCount > 0 && transactions.length !== transactionCount) {
    matched = false;
    reasons.push(`Count mismatch: Expected ${transactionCount} rows, extracted ${transactions.length}`);
  }

  // 5. Duplicates Check
  const seen = new Set();
  let duplicateCount = 0;
  for (const t of transactions) {
    const key = `${t.date}-${t.description}-${t.deposit}-${t.withdrawal}`;
    if (seen.has(key)) {
      duplicateCount++;
    }
    seen.add(key);
  }
  if (duplicateCount > 0) {
    reasons.push(`Potential Duplicates: ${duplicateCount} rows look identical to others.`);
  }

  return {
    matched,
    balanceDelta,
    extractedDeposits,
    extractedWithdrawals,
    calculatedClosing,
    expectedClosing: closingBalance,
    transactionCount: transactions.length,
    continuityErrors: continuityFails,
    duplicateCount,
    reasons
  };
}

function reconcileStatement(summary, transactions) {
  if (!summary) summary = {};
  const { openingBalance = 0, closingBalance = 0, totalDebits = null, totalCredits = null } = summary;

  // Sum extracted transactions by type
  // ROOT CAUSE FIX: Exclude fixed payments (FP) from transaction sums to prevent double counting
  // Fixed payments are generally merchant EMIs that are already accounted for elsewhere 
  // or are part of the previous balance loan bucket.
  const extractedDebits = transactions
    .filter(t => (t.type === 'Debit' || t.type === 'debit') && !t.description?.toUpperCase().includes('FP EMI'))
    .reduce((sum, t) => sum + t.amount, 0);

  const extractedCredits = transactions
    .filter(t => (t.type === 'Credit' || t.type === 'credit'))
    .reduce((sum, t) => sum + t.amount, 0);

  // Core equation: opening + debits - credits = closing
  const calculatedClosing = round2(openingBalance + extractedDebits - extractedCredits);
  const balanceDelta = round2(Math.abs(calculatedClosing - closingBalance));

  // Secondary checks (if statement printed these)
  const debitDelta = totalDebits != null
    ? round2(Math.abs(extractedDebits - totalDebits))
    : null;

  const creditDelta = totalCredits != null
    ? round2(Math.abs(extractedCredits - totalCredits))
    : null;

  const matched = balanceDelta < 0.02; // 2 paise tolerance for float weirdness

  const reasons = [];
  if (!matched) {
    if (debitDelta && debitDelta > 0.01) {
      reasons.push(`Debit mismatch: Extracted ${extractedDebits.toFixed(2)} but summary says ${totalDebits.toFixed(2)}. Difference: ${debitDelta.toFixed(2)}.`);
    }
    if (creditDelta && creditDelta > 0.01) {
      reasons.push(`Credit mismatch: Extracted ${extractedCredits.toFixed(2)} but summary says ${totalCredits.toFixed(2)}. Difference: ${creditDelta.toFixed(2)}.`);
    }
    if (balanceDelta > 0.01 && !debitDelta && !creditDelta) {
      reasons.push(`Balance mismatch: The math (Opening + Debits - Credits) results in ${calculatedClosing.toFixed(2)}, but the PDF shows ${closingBalance.toFixed(2)}.`);
    }
    if (summary.transactionCount && summary.transactionCount !== transactions.length) {
      reasons.push(`Count mismatch: Summary shows ${summary.transactionCount} transactions, but only ${transactions.length} were extracted.`);
    }
    if (reasons.length === 0) {
      reasons.push("Calculation mismatch: An unidentified discrepancy exists between the extracted data and the statement summary.");
    }
  }

  return {
    matched,
    balanceDelta,
    debitDelta,
    creditDelta,
    calculatedClosing,
    expectedClosing: closingBalance,
    extractedDebits,
    extractedCredits,
    transactionCount: transactions.length,
    reasons
  };
}

const processStatementInBackground = async (statementId, pdfBuffer) => {
  // Wait a small bit to ensure the DB record is fully persisted if multiple processes are flickering
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    const statement = await Statement.findById(statementId);
    if (!statement) return;

    // 1. Mark as PROCESSING
    statement.status = 'PROCESSING';
    await statement.save();

    // 2. Select Engine
    const isBank = statement.type === 'BANK';
    const activePrompt = isBank ? bankPromptText : promptText;
    const activeSchema = isBank ? bankExtractionSchema : extractionSchema;
    const ocrEngine = statement.ocrEngine || 'gemini';

    let extraction = null;
    let attempt = 0;
    const maxAttempts = 2;

    if (ocrEngine.startsWith('ocr_space')) {
      let variant = "1";
      if (ocrEngine === 'ocr_space_v2') variant = "2";
      if (ocrEngine === 'ocr_space_v3') variant = "3";

      console.log(`[Background] OCR.space Engine ${variant} process starting for ${statementId}...`);
      extraction = await processWithOCRSpace(pdfBuffer, activePrompt, activeSchema, variant);
      console.log(`[Background] OCR.space completed for ${statementId}`);
    } else if (ocrEngine === 'ocr_mistral') {
      console.log(`[Background] Mistral Neural OCR process starting for ${statementId}...`);
      extraction = await processWithMistralOCR(pdfBuffer, `statement_${statementId}.pdf`);
      console.log(`[Background] Mistral OCR completed for ${statementId}`);
    } else if (ocrEngine === 'mistral_llama_hybrid') {
      console.log(`[Hybrid Flow] Stage 1: Cropping to first page and sending to Mistral OCR...`);

      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const firstPageDoc = await PDFDocument.create();
      const [firstPage] = await firstPageDoc.copyPages(pdfDoc, [0]);
      firstPageDoc.addPage(firstPage);
      const firstPageBuffer = Buffer.from(await firstPageDoc.save());

      const mistralRaw = await processWithMistralOCR(firstPageBuffer, `statement_${statementId}.pdf`);
      const allMarkdown = mistralRaw.data.pages.map(p => p.markdown).join('\n\n');

      console.log(`[Hybrid Flow] Stage 2: Mapping markdown to JSON via Groq (Llama 3)...`);
      const llamaResult = await processWithGroq(allMarkdown, activePrompt);

      extraction = { ...llamaResult, type: 'MISTRAL_LLAMA_HYBRID_MAPPED', rawMistral: mistralRaw };
      console.log(`[Hybrid Flow] Joint pipeline completed for ${statementId}`);
    } else if (ocrEngine === 'groq_llama') {
      console.log(`[Background] Groq LLM Chain process starting for ${statementId}...`);
      // Groq needs text. We'll use OCR.space V2 as the high-accuracy text provider.
      const rawTextData = await processWithOCRSpace(pdfBuffer, activePrompt, activeSchema, "2");
      const allText = rawTextData.parsedResults.map(p => p.text).join('\n\n');

      const groqResult = await processWithGroq(allText, activePrompt);
      extraction = { ...groqResult, type: 'GROQ_LLAMA_MAPPED' };
      console.log(`[Background] Groq LLM completion successful for ${statementId}`);
    } else {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: activeSchema,
        }
      });

      while (attempt < maxAttempts) {
        try {
          console.log(`[Background] Gemini Extraction starting for ${statementId} (${statement.type})...`);
          const startTime = Date.now();

          const result = await model.generateContent([
            activePrompt,
            {
              inlineData: {
                data: pdfBuffer.toString("base64"),
                mimeType: "application/pdf"
              }
            }
          ]);

          const response = await result.response;
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[Background] Gemini Response received in ${duration}s for ${statementId}`);
          const text = response.text();

          const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
          extraction = JSON.parse(cleanedText);
          break;
        } catch (err) {
          attempt++;
          console.error(`[Background] Gemini attempt ${attempt} failed for ${statementId}:`, err.message);
          if (attempt >= maxAttempts) throw err;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    // Save raw AI response for debugging
    statement.rawAIResponse = extraction;

    if (extraction && extraction.type === 'OCR_SPACE_RAW') {
      statement.status = 'COMPLETED';
      await statement.save();
      console.log(`[Background] Statement ${statementId} stored with RAW OCR data.`);
      return;
    }

    await statement.save();

    // 3. Map extraction to statement model using common utility
    await mapAIResponseToStatement(statement, extraction);
    await statement.save();

    console.log(`[Background] Statement ${statementId} processed successfully.`);

    return;

  } catch (error) {
    console.error(`[Background] Processing error for ${statementId}:`, error);
    try {
      await Statement.findByIdAndUpdate(statementId, {
        status: 'FAILED',
        processingError: error.message
      });
    } catch (e) {
      console.error('Final error update failed', e);
    }
  }
};

const mapAIResponseToStatement = async (statement, extraction) => {
  const isBank = statement.type === 'BANK';

  // 1. If this is raw OCR.space data, perform the Gemini mapping step now
  if (extraction && extraction.type === 'OCR_SPACE_RAW') {
    console.log(`[Mapping] Performing on-the-fly Gemini mapping for raw OCR data...`);
    const activePrompt = isBank ? bankPromptText : promptText;
    const activeSchema = isBank ? bankExtractionSchema : extractionSchema;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // Using gemini-2.5-flash for accurate mapping
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: activeSchema,
      }
    });

    const allText = extraction.parsedResults.map(p => p.text).join('\n\n');
    const allOverlay = extraction.parsedResults.map(p => p.overlay);

    const chainPrompt = `
    You are an expert financial auditor receiving raw OCR output with coordinate data. 
    Map this raw text to the specified JSON schema with extreme precision.
    
    ${activePrompt}
    
    RAW OCR EXTRACT:
    ${allText}
    
    SPATIAL OVERLAY DATA:
    ${JSON.stringify(allOverlay)}
    `;

    const result = await model.generateContent([chainPrompt]);
    const geminiText = result.response.text();
    extraction = JSON.parse(geminiText.replace(/```json/g, "").replace(/```/g, "").trim());
    console.log(`[Mapping] Gemini mapping completed.`);
  }

  // 1b. If this is raw Mistral OCR data, perform the Gemini mapping
  if (extraction && extraction.type === 'MISTRAL_OCR_RAW') {
    console.log(`[Mapping] Performing Gemini mapping for Mistral Markdown data...`);
    const activePrompt = isBank ? bankPromptText : promptText;
    const activeSchema = isBank ? bankExtractionSchema : extractionSchema;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: activeSchema,
      }
    });

    const allMarkdown = extraction.data.pages.map(p => p.markdown).join('\n\n');

    const mappingPrompt = `
    You are an expert financial auditor receiving Mistral multi-modal OCR output in Markdown.
    Map this high-fidelity markdown to the specified JSON schema for our audit database.
    
    ${activePrompt}
    
    MISTRAL MARKDOWN:
    ${allMarkdown}
    `;

    const result = await model.generateContent([mappingPrompt]);
    const geminiText = result.response.text();
    const mappedResult = JSON.parse(geminiText.replace(/```json/g, "").replace(/```/g, "").trim());

    // We keep the original rawAIResponse for debugging but update extraction for the DB merge
    extraction = { ...mappedResult, type: 'MISTRAL_MAPPED' };
  }

  // Apply Vendor Rules
  const userRules = await VendorRule.find({ user: statement.user });
  const rulesMap = new Map();
  userRules.forEach(rule => rulesMap.set(rule.merchantName, rule.category));

  if (extraction.transactions && Array.isArray(extraction.transactions)) {
    extraction.transactions = extraction.transactions.map(tx => {
      if (tx.merchantName && rulesMap.has(tx.merchantName)) {
        return {
          ...tx,
          category: rulesMap.get(tx.merchantName),
          categoryConfidence: 100
        };
      }
      return tx;
    });
  }

  // Detect bank name
  let finalBankName = { val: 'Unknown Bank', box: [], page: 0 };
  const rawBank = extraction.bankName;

  if (typeof rawBank === 'object' && rawBank !== null) {
    finalBankName = {
      val: rawBank.val || 'Unknown Bank',
      box: Array.isArray(rawBank.box) ? rawBank.box : [],
      page: rawBank.page || 0
    };
  } else if (typeof rawBank === 'string') {
    finalBankName.val = rawBank;
  } else if (statement.bankName?.val) {
    finalBankName = statement.bankName;
  }

  Object.assign(statement, {
    status: 'COMPLETED',
    bankName: finalBankName,
    currency: extraction.currency || 'INR',
    creditLimit: extraction.creditLimit,
    availableLimit: extraction.availableLimit,
    outstandingTotal: extraction.outstandingTotal,
    minPaymentDue: extraction.minPaymentDue,
    paymentDueDate: extraction.paymentDueDate,
    statementDate: extraction.statementDate,
    statementPeriod: extraction.statementPeriod,
    accountNumber: extraction.accountNumber,
    accountHolder: extraction.accountHolder,
    openingBalance: extraction.openingBalance,
    closingBalance: extraction.closingBalance,
    totalDeposits: extraction.totalDeposits,
    totalWithdrawals: extraction.totalWithdrawals,
    previousBalance: extraction.previousBalance,
    lastPaymentAmount: extraction.lastPaymentAmount,
    lastPaymentDate: extraction.lastPaymentDate,
    totalDebits: extraction.totalDebits,
    totalCredits: extraction.totalCredits,
    totalInterestCharged: extraction.totalInterestCharged,
    totalLateFee: extraction.totalLateFee,
    totalForexFee: extraction.totalForexFee,
    totalFees: extraction.totalFees,
    cashAdvance: extraction.cashAdvance,
    isRevolvingBalance: extraction.isRevolvingBalance,
    rewardPointsEarned: extraction.rewardPointsEarned,
    rewardPointsRedeemed: extraction.rewardPointsRedeemed,
    rewardPointsBalance: extraction.rewardPointsBalance,
    rewardPointsExpiry: extraction.rewardPointsExpiry,
    transactions: extraction.transactions,
    emiList: extraction.emiList,
    reconciliationSummary: extraction.reconciliationSummary,
    summary: extraction.summary,
    rawAIResponse: extraction
  });

  let severity = 'unverified';
  if (extraction.reconciliationSummary && Array.isArray(extraction.transactions)) {
    const rec = isBank
      ? reconcileBankStatement(extraction.reconciliationSummary, extraction.transactions)
      : reconcileStatement(extraction.reconciliationSummary, extraction.transactions);

    statement.reconciliation = { ...rec, checkedAt: new Date() };

    if (rec.matched) {
      severity = 'verified';
    } else {
      severity = rec.balanceDelta < 10 ? 'minor_mismatch' : 'extraction_error';
    }
  }

  statement.extractionQuality = severity;
  return statement;
};

module.exports = {
  processStatementInBackground,
  mapAIResponseToStatement
};
