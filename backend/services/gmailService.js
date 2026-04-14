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
  const startedAt = Date.now();
  console.log(`[Gmail API] messages.get(format=full) start messageId=${messageId}`);
  const full = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  console.log(
    `[Gmail API] messages.get(format=full) success messageId=${messageId} elapsedMs=${Date.now() - startedAt}`
  );

  const headers = full.data.payload?.headers || [];
  const subject = (headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '').trim();
  const from = (headers.find(h => h.name?.toLowerCase() === 'from')?.value || '').trim();

  const payload = full.data.payload;
  if (!payload) return [];

  const parts = collectPdfParts(payload);
  console.log(
    `[Gmail Parse] messageId=${messageId} subject="${subject.slice(0, 80)}" pdfParts=${parts.length}`
  );
  const results = [];

  for (const part of parts) {
    let buf;
    if (part.body?.data) {
      console.log(
        `[Gmail Parse] messageId=${messageId} part="${part.filename || 'statement.pdf'}" source=inline`
      );
      buf = Buffer.from(part.body.data, 'base64url');
    } else if (part.body?.attachmentId) {
      const attStart = Date.now();
      console.log(
        `[Gmail API] attachments.get start messageId=${messageId} attachmentId=${part.body.attachmentId} filename="${part.filename || ''}"`
      );
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      });
      console.log(
        `[Gmail API] attachments.get success messageId=${messageId} attachmentId=${part.body.attachmentId} elapsedMs=${Date.now() - attStart}`
      );
      if (att.data?.data) {
        buf = Buffer.from(att.data.data, 'base64url');
      }
    }
    if (buf && buf.length > 64) {
      const filename = part.filename && part.filename.trim()
        ? part.filename.trim()
        : 'statement.pdf';
      console.log(
        `[Gmail Parse] messageId=${messageId} acceptedPdf filename="${filename}" bytes=${buf.length}`
      );
      results.push({ buffer: buf, filename, subject, from });
    }
  }

  console.log(
    `[Gmail Parse] messageId=${messageId} extractedPdfs=${results.length} elapsedMs=${Date.now() - startedAt}`
  );
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

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract human-readable text from Gmail message payload (plain preferred, else HTML stripped).
 */
function extractEmailBodyPlainText(payload) {
  if (!payload) return '';
  const chunks = { plain: [], html: [] };

  function walk(parts) {
    if (!parts) return;
    for (const p of parts) {
      const mime = (p.mimeType || '').toLowerCase();
      if (mime.startsWith('multipart/') && p.parts) {
        walk(p.parts);
        continue;
      }
      if (p.body?.data) {
        const text = Buffer.from(p.body.data, 'base64url').toString('utf8');
        if (mime === 'text/plain') chunks.plain.push(text);
        if (mime === 'text/html') chunks.html.push(text);
      }
    }
  }

  if (payload.parts) walk(payload.parts);
  if (payload.body?.data && !payload.parts) {
    const mime = (payload.mimeType || '').toLowerCase();
    const text = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    if (mime === 'text/plain') chunks.plain.push(text);
    if (mime === 'text/html') chunks.html.push(text);
  }

  const plain = chunks.plain.join('\n').trim();
  if (plain) return plain;
  const htmlJoined = chunks.html.join('\n');
  return stripHtml(htmlJoined);
}

/**
 * @param {import('googleapis').gmail_v1.Gmail} gmail
 * @param {string} messageId
 */
async function getMessageBodyText(gmail, messageId) {
  const startedAt = Date.now();
  console.log(`[Gmail API] messages.get(format=full body) start messageId=${messageId}`);
  const full = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const text = extractEmailBodyPlainText(full.data.payload) || '';
  console.log(
    `[Gmail Parse] messageId=${messageId} bodyTextChars=${text.length} elapsedMs=${Date.now() - startedAt}`
  );
  return text;
}

module.exports = {
  createOAuth2Client,
  buildGmailAuthUrl,
  exchangeCodeForTokens,
  collectPdfParts,
  extractPdfAttachments,
  extractEmailBodyPlainText,
  getMessageBodyText,
  defaultGmailQuery,
  isPdfEncrypted,
  google,
};
