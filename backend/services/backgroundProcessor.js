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
  "bankName": string,
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
}`;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function reconcileStatement(summary, transactions) {
  if (!summary) summary = {};
  const { openingBalance = 0, closingBalance = 0, totalDebits = null, totalCredits = null } = summary;

  // Sum extracted transactions by type
  const extractedDebits = transactions
    .filter(t => t.type === 'Debit' || t.type === 'debit')
    .reduce((sum, t) => sum + t.amount, 0);

  const extractedCredits = transactions
    .filter(t => t.type === 'Credit' || t.type === 'credit')
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

  return {
    matched,
    balanceDelta,
    debitDelta,
    creditDelta,
    calculatedClosing,
    expectedClosing: closingBalance,
    extractedDebits,
    extractedCredits,
    transactionCount: transactions.length
  };
}

exports.processStatement = async (statementId, pdfBuffer) => {
  try {
    const statement = await Statement.findById(statementId);
    if (!statement) return;

    // 1. Mark as PROCESSING
    statement.status = 'PROCESSING';
    await statement.save();

    // Call Gemini Vision
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    
    let result = null;
    let text = "";
    let extraction = null;
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      try {
        console.log(`[Background] Processing ${statementId} - Attempt ${attempt + 1}/${maxAttempts}...`);
        result = await model.generateContent([
          promptText,
          {
            inlineData: {
              data: pdfBuffer.toString("base64"),
              mimeType: "application/pdf"
            }
          }
        ]);

        const response = await result.response;
        text = response.text();
        
        // Clean JSON markdown if any
        const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
        extraction = JSON.parse(cleanedText);
        
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

    // 3. Apply Vendor Rules
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

    // 4. Update Statement with full data
    // Detect bank name if not explicitly provided
    let detectedBank = extraction.bankName || statement.bankName;
    if (detectedBank === 'Unknown Bank') {
        const banks = ['HSBC', 'HDFC', 'ICICI', 'AXIS', 'KOTAK', 'SBI', 'AMEX', 'CHASE', 'CITI', 'BARCLAYS'];
        const searchStr = JSON.stringify(extraction).toUpperCase();
        for (const bank of banks) {
          if (searchStr.includes(bank)) { detectedBank = `${bank} Credit Card`; break; }
        }
    }

    Object.assign(statement, {
        status: 'COMPLETED',
        bankName: detectedBank,
        currency: extraction.currency || 'INR',
        creditLimit: extraction.creditLimit,
        availableLimit: extraction.availableLimit,
        outstandingTotal: extraction.outstandingTotal,
        minPaymentDue: extraction.minPaymentDue,
        paymentDueDate: extraction.paymentDueDate,
        statementDate: extraction.statementDate,
        statementPeriod: extraction.statementPeriod,
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
        isApproved: false // User must approve later
    });

    let severity = 'unverified';
    if (extraction.reconciliationSummary && Array.isArray(extraction.transactions)) {
      const rec = reconcileStatement(extraction.reconciliationSummary, extraction.transactions);
      statement.reconciliation = { ...rec, checkedAt: new Date() };

      if (rec.matched) {
        severity = 'verified';
      } else {
        console.warn('[Validation] Reconciliation failed', {
          statementId,
          delta: rec.balanceDelta,
          extractedDebits: rec.extractedDebits,
          expectedDebits: extraction.reconciliationSummary.totalDebits,
          txCount: extraction.transactions.length
        });
        
        severity = rec.balanceDelta < 10 ? 'minor_mismatch' : 'extraction_error';
      }
    }
    
    statement.extractionQuality = severity;

    await statement.save();
    console.log(`[Background] Statement ${statementId} processed successfully.`);

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
