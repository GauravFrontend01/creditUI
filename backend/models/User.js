const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },

  /** Gmail OAuth (tokens excluded from default queries — use .select('+gmailRefreshToken') when needed) */
  gmailRefreshToken: { type: String, select: false, default: '' },
  gmailAccessToken: { type: String, select: false, default: '' },
  gmailTokenExpiry: { type: Date },
  gmailAddress: { type: String, default: '' },
  gmailConnectedAt: { type: Date },
  gmailLastSyncAt: { type: Date },
  gmailLastSyncError: { type: String, default: '' },
  gmailScanStatus: { type: String, enum: ['idle', 'scanning', 'completed', 'error'], default: 'idle' },
  gmailScanResult: { type: mongoose.Schema.Types.Mixed, default: null },
  gmailScanError: { type: String, default: '' },
  gmailNextPageToken: { type: String, default: '' },
  /** Message IDs we already imported as statements (avoid duplicates on sync) */
  gmailImportedMessageIds: { type: [String], default: [] },
  /** Stored PDF passwords for auto-unlocking (e.g. { label: 'Kotak', password: '...' }) */
  bankPasswords: [{
    label: { type: String, required: true },
    password: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
  }],
});

// Hash password before saving (async hook: do not use next(); Mongoose 9 omits it)
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user-entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
