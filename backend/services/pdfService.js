const { PDFDocument } = require('pdf-lib');

async function decryptPdf(buffer, password) {
  if (!password) throw new Error('PDF password is required');
  const trimmedPassword = password.trim();

  // Verify magic bytes (%PDF-)
  const magic = buffer.slice(0, 5).toString();
  if (magic !== '%PDF-') {
    console.error(`[PDF Service] Invalid buffer. Starts with: ${magic}`);
    throw new Error('Not a valid PDF file (buffer mismatch).');
  }
  
  try {
    const pdfDoc = await PDFDocument.load(buffer, { 
      password: trimmedPassword,
      ignoreEncryption: false 
    });
    const decryptedUint8Array = await pdfDoc.save();
    return { buffer: Buffer.from(decryptedUint8Array), isUnlocked: true };
  } catch (err) {
    const lower = String(err.message || '').toLowerCase();
    if (lower.includes('password') || lower.includes('encrypted')) {
      throw new Error('Incorrect password for PDF decryption.');
    }
    throw new Error(`PDF decryption failed: ${err.message}`);
  }
}

module.exports = {
  decryptPdf,
};
