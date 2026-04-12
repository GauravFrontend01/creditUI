const { PDFDocument } = require('pdf-lib');

// PDF.js Node environment polyfills
if (typeof DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    }
  };
}

const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * Decrypts a PDF buffer using the provided password.
 * Returns the decrypted buffer.
 * @param {Buffer} buffer 
 * @param {string} password 
 * @returns {Promise<Buffer>}
 */
async function decryptPdf(buffer, password) {
  if (!password) return buffer;
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
    // Saving the loaded document produces a version without the encryption dictionaries
    const decryptedUint8Array = await pdfDoc.save();
    return Buffer.from(decryptedUint8Array);
  } catch (err) {
    console.error(`[PDF Service] Primary decryption error (len=${trimmedPassword.length}):`, err.message);
    
    // Fallback: Verify with pdfjs-dist (supports modern encryption)
    try {
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        password: trimmedPassword,
        stopAtErrors: false
      });
      await loadingTask.promise;
      
      // If we are here, the password is CORRECT, but pdf-lib (Revision 4 library) failed.
      console.warn(`[PDF Service] Password IS correct (verified via pdfjs), but library limitation prevents saving unlocked version.`);
      throw new Error('This PDF uses high-security AES-256 encryption. We can verify your password is correct, but we currently cannot "unlock" a downloadable copy for you. However, you can proceed to "Audit Selected" and we will attempt text extraction.');
    } catch (verifErr) {
       console.error(`[PDF Service] Verification fallback failed (type=${verifErr.name}):`, verifErr.message);
       if (verifErr.name === 'PasswordException' || verifErr.message.toLowerCase().includes('password')) {
         throw new Error('Incorrect password for PDF decryption.');
       }
       throw new Error(`PDF Parsing Error: ${err.message}`);
    }
  }
}

/**
 * Extracts raw text from a PDF buffer (handles AES-256).
 * @param {Buffer} buffer 
 * @param {string} password 
 * @returns {Promise<string>}
 */
async function extractTextWithPdfJs(buffer, password) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    password: password ? password.trim() : undefined,
    stopAtErrors: false
  });
  const pdf = await loadingTask.promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    fullText += `--- PAGE ${i} ---\n` + strings.join(' ') + '\n\n';
  }
  
  return fullText;
}

module.exports = {
  decryptPdf,
  extractTextWithPdfJs
};
