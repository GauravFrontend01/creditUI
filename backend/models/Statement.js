const mongoose = require('mongoose');

const boxField = { type: [Number], default: [] };

const transactionSchema = new mongoose.Schema({
  date: String,
  description: String,
  merchantName: String,
  amount: Number,
  type: { type: String, enum: ['Credit', 'Debit'] },
  category: String,
  categoryConfidence: Number,
  isRecurring: Boolean,
  isForex: Boolean,
  box: boxField,
  page: Number,
});

const emiSchema = new mongoose.Schema({
  name: String,
  amount: Number,
  box: boxField,
  page: Number,
});

const statValSchema = {
  val: Number,
  box: boxField,
  page: Number,
};

const statementSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  bankName:         { type: String, default: 'Unknown Bank' },
  currency:         { type: String, default: 'INR' },

  // ── Key Balances ──────────────────────────────────────────────────────────
  creditLimit:      statValSchema,
  availableLimit:   statValSchema,
  outstandingTotal: statValSchema,
  minPaymentDue:    statValSchema,

  // ── Dates ─────────────────────────────────────────────────────────────────
  paymentDueDate:   { val: String, box: boxField, page: Number },
  statementDate:    { val: String, box: boxField, page: Number },
  statementPeriod:  { from: String, to: String, box: boxField, page: Number },

  // ── Previous Cycle ─────────────────────────────────────────────────────────
  previousBalance:    statValSchema,
  lastPaymentAmount:  statValSchema,
  lastPaymentDate:    { val: String, box: boxField, page: Number },

  // ── Totals ─────────────────────────────────────────────────────────────────
  totalDebits:          statValSchema,
  totalCredits:         statValSchema,
  totalInterestCharged: statValSchema,
  totalLateFee:         statValSchema,
  totalForexFee:        statValSchema,
  totalFees:            statValSchema,
  cashAdvance:          { amount: Number, fee: Number, box: boxField, page: Number },
  isRevolvingBalance:   { val: Boolean },

  // ── Rewards ────────────────────────────────────────────────────────────────
  rewardPointsEarned:    statValSchema,
  rewardPointsRedeemed:  statValSchema,
  rewardPointsBalance:   statValSchema,
  rewardPointsExpiry:    { val: String, box: boxField, page: Number },

  // ── Transactions & EMIs ────────────────────────────────────────────────────
  transactions: [transactionSchema],
  emiList:      [emiSchema],

  // ── AI Narrative ───────────────────────────────────────────────────────────
  summary:        String,
  
  // ── Reconciliation Engine ──────────────────────────────────────────────────
  reconciliationSummary: {
    openingBalance: Number,
    closingBalance: Number,
    totalDebits: Number,
    totalCredits: Number,
    transactionCount: Number
  },
  reconciliation: {
    matched: Boolean,
    balanceDelta: Number,
    debitDelta: Number,
    creditDelta: Number,
    calculatedClosing: Number,
    expectedClosing: Number,
    extractedDebits: Number,
    extractedCredits: Number,
    transactionCount: Number,
    reasons: [String],
    checkedAt: Date
  },
  extractionQuality: {
    type: String,
    enum: ['unverified', 'verified', 'minor_mismatch', 'extraction_error'],
    default: 'unverified'
  },

  // ── PDF Storage ────────────────────────────────────────────────────────────
  pdfStorageUrl: String,
  pdfFileName:   String,
  pdfPassword:   { type: String, default: '' },

  // ── Status & Processing ────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING'
  },
  processingError: String,
  isApproved: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Statement', statementSchema);
