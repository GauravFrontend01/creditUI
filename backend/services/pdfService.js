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

async function decryptPdf(buffer, password) {
  if (!password) return { buffer, isUnlocked: true };
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
    console.warn(`[PDF Service] Primary decryption (pdf-lib) failed: ${err.message}. Trying verification fallback...`);
    
    // Fallback: Verify with pdfjs-dist (supports modern AES-256 encryption)
    try {
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        password: trimmedPassword,
        stopAtErrors: false
      });
      await loadingTask.promise;
      
      // Password is CORRECT, but library cannot "save" it unlocked (AES-256).
      // Return original buffer and indicate it is still encrypted but verified.
      console.log(`[PDF Service] Password verified via pdfjs. Returning source buffer (isUnlocked: false).`);
      return { buffer, isUnlocked: false };
    } catch (verifErr) {
       console.error(`[PDF Service] Verification fallback failed (type=${verifErr.name}): ${verifErr.message}`);
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
 * @param {number[]} [pagesToExtract] - 1-indexed array of pages to extract
 * @returns {Promise<string>}
 */
async function extractTextWithPdfJs(buffer, password, pagesToExtract = null) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    password: password ? password.trim() : undefined,
    stopAtErrors: false
  });
  const pdf = await loadingTask.promise;
  let fullText = '';
  
  const targetIndices = pagesToExtract || Array.from({ length: pdf.numPages }, (_, i) => i + 1);

  for (const i of targetIndices) {
    if (i < 1 || i > pdf.numPages) continue;
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    fullText += `--- PAGE ${i} ---\n` + strings.join(' ') + '\n\n';
  }
  
  return fullText;
}

/**
 * Reconstructs a new PDF from a list of image buffers.
 * @param {Buffer[]} imageBuffers 
 * @returns {Promise<Buffer>}
 */
async function createPdfFromImages(imageBuffers) {
  const sharp = require('sharp');
  const newPdf = await PDFDocument.create();

  for (const buffer of imageBuffers) {
    // Standardize to JPEG for compression/size management
    const processedImage = await sharp(buffer)
      .toFormat('jpeg', { quality: 80 })
      .toBuffer();

    const image = await newPdf.embedJpg(processedImage);
    const { width, height } = image.scale(1.0);
    const page = newPdf.addPage([width, height]);
    
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: width,
      height: height,
    });
  }

  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  decryptPdf,
  extractTextWithPdfJs,
  createPdfFromImages
};
