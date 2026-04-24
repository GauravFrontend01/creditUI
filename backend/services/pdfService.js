const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function tryDecryptWithQpdf(buffer, password) {
  const tmpIn = path.join(os.tmpdir(), `enc-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  const tmpOut = path.join(os.tmpdir(), `dec-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  try {
    console.log(`[PDF Service] Writing buffer to temp file: ${tmpIn}`);
    fs.writeFileSync(tmpIn, buffer);
    console.log(`[PDF Service] Executing qpdf...`);
    execFileSync('qpdf', ['--password', password, '--decrypt', tmpIn, tmpOut], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`[PDF Service] qpdf success, reading output: ${tmpOut}`);
    const out = fs.readFileSync(tmpOut);
    return { buffer: out, isUnlocked: true };
  } catch (e) {
    const stderr = String(e?.stderr || e?.message || '');
    const lower = stderr.toLowerCase();
    console.error(`[PDF Service] qpdf error: ${stderr}`);
    if (lower.includes('invalid password') || lower.includes('incorrect password')) {
      throw new Error('Incorrect password for PDF decryption.');
    }
    if (lower.includes('enoent') || lower.includes('not found')) {
      console.warn(`[PDF Service] CRITICAL: qpdf is NOT installed on this system.`);
      return { buffer, isUnlocked: false, warning: 'qpdf is not installed (needed for some AES-encrypted PDFs).' };
    }
    return { buffer, isUnlocked: false, warning: `qpdf fallback failed: ${stderr}` };
  } finally {
    try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
  }
}

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

    // Some bank statements use AES/object layouts pdf-lib cannot rewrite.
    // Try qpdf as a robust fallback if available on host.
    console.warn(`[PDF Service] pdf-lib decrypt failed, trying qpdf fallback: ${err.message}`);
    return tryDecryptWithQpdf(buffer, trimmedPassword);
  }
}

module.exports = {
  decryptPdf,
};
