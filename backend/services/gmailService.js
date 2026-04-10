const { google } = require('googleapis');
const { PDFDocument } = require('pdf-lib');

/**
 * Check if a PDF buffer is password protected
 * @param {Buffer} buffer 
 */
async function isPdfEncrypted(buffer) {
  try {
    await PDFDocument.load(buffer, { ignoreEncryption: false });
    return false;
  } catch (err) {
    if (err.message.includes('encrypted')) return true;
    return false;
  }
}

function createOAuth2Client() {
  const cid = process.env.GOOGLE_CLIENT_ID;
  const cs = process.env.GOOGLE_CLIENT_SECRET;
  const uri = process.env.GOOGLE_REDIRECT_URI;
  if (!cid || !cs || !uri) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI');
  }
  return new google.auth.OAuth2(cid, cs, uri.trim());
}

function buildGmailAuthUrl(oauth2Client, state) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    include_granted_scopes: true,
    state,
  });
}

/**
 * @param {import('google-auth-library').OAuth2Client} oauth2Client
 * @param {string} code
 */
async function exchangeCodeForTokens(oauth2Client, code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

function collectPdfParts(payload) {
  const out = [];

  function walk(parts) {
    if (!parts) return;
    for (const p of parts) {
      const mime = (p.mimeType || '').toLowerCase();
      if (mime.startsWith('multipart/') && p.parts) {
        walk(p.parts);
        continue;
      }
      const fn = (p.filename || '').toLowerCase();
      if (
        fn.endsWith('.pdf') ||
        mime === 'application/pdf' ||
        (mime === 'application/octet-stream' && fn.endsWith('.pdf'))
      ) {
        out.push(p);
      }
    }
  }

  if (payload?.parts) walk(payload.parts);
  return out;
}

/**
 * @param {import('googleapis').gmail_v1.Gmail} gmail
 * @param {string} messageId
 * @returns {Promise<{ buffer: Buffer, filename: string, subject: string, from: string }[]>}
 */
async function extractPdfAttachments(gmail, messageId) {
  const full = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = full.data.payload?.headers || [];
  const subject = (headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '').trim();
  const from = (headers.find(h => h.name?.toLowerCase() === 'from')?.value || '').trim();

  const payload = full.data.payload;
  if (!payload) return [];

  const parts = collectPdfParts(payload);
  const results = [];

  for (const part of parts) {
    let buf;
    if (part.body?.data) {
      buf = Buffer.from(part.body.data, 'base64url');
    } else if (part.body?.attachmentId) {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      });
      if (att.data?.data) {
        buf = Buffer.from(att.data.data, 'base64url');
      }
    }
    if (buf && buf.length > 64) {
      const filename = part.filename && part.filename.trim()
        ? part.filename.trim()
        : 'statement.pdf';
      results.push({ buffer: buf, filename, subject, from });
    }
  }

  return results;
}

/**
 * Default Gmail search: PDF attachments that look like statements.
 * Tune via env GMAIL_SYNC_QUERY
 */
function defaultGmailQuery() {
  return (
    process.env.GMAIL_SYNC_QUERY ||
    'has:attachment filename:pdf (statement OR e-statement OR "account summary" OR "summary for account" OR "credit card" OR "account statement")'
  );
}

module.exports = {
  createOAuth2Client,
  buildGmailAuthUrl,
  exchangeCodeForTokens,
  collectPdfParts,
  extractPdfAttachments,
  defaultGmailQuery,
  isPdfEncrypted,
  google,
};
