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

const session = require('../../lib/session');

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
    const s = await session.getSession(req);
    if (!s) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
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