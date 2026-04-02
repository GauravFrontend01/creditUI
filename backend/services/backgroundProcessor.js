const { GoogleGenerativeAI } = require("@google/generative-ai");
const Statement = require("../models/Statement");
const VendorRule = require("../models/VendorRule");

const API_KEY = process.env.GOOGLE_API_KEY || "";
const genAI = new GoogleGenerativeAI(API_KEY);

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
    "openingBalance": { "type": "number", "description": "Balance before the first transaction in this PDF" },
    "closingBalance": { "type": "number", "description": "Balance after the last transaction in this PDF" },
    "totalDeposits": { "type": "number", "description": "Cumulative sum of all deposits across ALL pages. If the statement only provides page-wise totals, you MUST sum them yourself." },
    "totalWithdrawals": { "type": "number", "description": "Cumulative sum of all withdrawals across ALL pages. If the statement only provides page-wise totals, you MUST sum them yourself." },
    "transactionCount": { "type": "number", "description": "Total number of rows extracted" }
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

    // 2. Call Gemini
    const isBank = statement.type === 'BANK';
    const activePrompt = isBank ? bankPromptText : promptText;
    const activeSchema = isBank ? bankExtractionSchema : extractionSchema;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: activeSchema,
      }
    });

    let result = null;
    let text = "";
    let extraction = null;
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      try {
        console.log(`[Background] AI Extraction starting for ${statementId} (${statement.type})...`);
        const startTime = Date.now();

        result = await model.generateContent([
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
        console.log(`[Background] AI Response received in ${duration}s for ${statementId}`);
        text = response.text();

        // Clean JSON markdown if any
        const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
        extraction = JSON.parse(cleanedText);

        // Save raw AI response for debugging
        statement.rawAIResponse = extraction;
        await statement.save();

        break; // Success! Break out of the retry loop.
      } catch (err) {
        attempt++;
        console.error(`[Background] Attempt ${attempt} failed for ${statementId}:`, err.message);
        if (attempt >= maxAttempts) {
          throw new Error(`Failed after ${maxAttempts} attempts. Last error: ${err.message}`);
        }
        // Small delay before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

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
