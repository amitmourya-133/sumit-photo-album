// Local/legacy helper retained for compatibility. The public flow uses
// /api/blob/token + browser PUT directly to Vercel Blob.
const { put } = require('@vercel/blob');
const Busboy = require('busboy');

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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    sendJson(res, 503, { error: 'Missing BLOB_READ_WRITE_TOKEN. Add the Vercel Blob read-write token in environment variables.' });
    return;
  }
  try {
    const bb = new Busboy({ headers: req.headers, limits: { files: 100, fileSize: 30 * 1024 * 1024 } });
    const uploads = [];
    bb.on('file', (fieldname, file, info) => {
      const filename = info.filename || 'file';
      const mimeType = info.mimeType || 'application/octet-stream';
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          if (!buffer.length) uploads.push({ name: filename, error: 'Empty file' });
          else {
            const safe = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
            const blob = await put(`albums/uploads/${Date.now()}-${safe}`, buffer, { access: 'public', contentType: mimeType });
            uploads.push({ url: blob.url, name: filename });
          }
        } catch (e) {
          uploads.push({ name: filename, error: e.message });
        }
      });
    });
    bb.on('finish', async () => {
      const errors = uploads.filter((u) => u.error);
      sendJson(res, errors.length && !uploads.some((u) => u.url) ? 400 : 200, { uploads, errors });
    });
    req.pipe(bb);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
};