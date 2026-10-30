// Uses a fully bundled (esbuild) copy of the @vercel/blob client's server helper.
// Every npm dependency is inlined, so the serverless bundle never fails on
// "Cannot find module ..." for transitive deps.
const { handleUpload } = require('../../lib/blob-client/bundle.cjs');

// Vercel Blob store access mode is fixed at creation: client uploads require a
// PUBLIC store. sumit-photo-album-public is the public store connected via the
// UPLOADS_* env prefix; the legacy private store's BLOB_* vars stay as fallback.
const UPLOAD_TOKEN_FROM_ENV = process.env.UPLOADS_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || '';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// Session verification using signed cookie
function parseSessionCookie(req) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const m = header.match(/(?:^|;\\s*)session=([^;]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (e) {
    return m[1];
  }
}

function verifySession(cookieValue) {
  if (typeof cookieValue !== 'string' || cookieValue.indexOf('.') === -1) return null;
  const idx = cookieValue.lastIndexOf('.');
  const payload = cookieValue.slice(0, idx);
  const hmac = cookieValue.slice(idx + 1);
  const expected = crypto.createHmac('sha256', process.env.ADMIN_API_KEY || '').update(payload).digest('hex');
  if (hmac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch (e) {
    return null;
  }
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); } catch (e) { return null; }
  if (!data || typeof data.exp !== 'number' || Date.now() > data.exp) return null;
  return data;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }
    // Check authentication via session cookie
    const cookie = parseSessionCookie(req);
    const s = verifySession(cookie);
    if (!s) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      sendJson(res, 400, { error: 'Content-Type must be application/json.' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
      return;
    }
    if (!UPLOAD_TOKEN_FROM_ENV) {
      sendJson(res, 503, { error: 'Missing UPLOADS_READ_WRITE_TOKEN (public Blob store token) and BLOB_READ_WRITE_TOKEN. Connect a public Vercel Blob store to this project and redeploy.' });
      return;
    }
    const jsonResponse = await handleUpload({
      token: UPLOAD_TOKEN_FROM_ENV,
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const safePath = String(pathname || '');
        const isImage = /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp)$/i.test(safePath);
        const isAudio = /\.(mp3|m4a|aac|ogg|wav|flac)$/i.test(safePath);
        if (isImage) {
          return {
            allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'image/gif', 'image/bmp'],
            maximumSizeInBytes: 25 * 1024 * 1024,
            addRandomSuffix: true
          };
        }
        if (isAudio) {
          return {
            allowedContentTypes: ['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-flac', 'audio/flac'],
            maximumSizeInBytes: 60 * 1024 * 1024,
            addRandomSuffix: true
          };
        }
        throw new Error('For security, the upload token is limited to supported photos and audio files.');
      }
    });
    sendJson(res, 200, jsonResponse);
  } catch (error) {
    console.error('api/blob/token failed:', error && error.message ? error.message : 'unknown');
    const message = error && error.message ? error.message : 'Token generation failed.';
    sendJson(res, 400, { error: message });
  }
};