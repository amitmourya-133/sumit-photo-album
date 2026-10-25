const { put } = require('@vercel/blob');
const Busboy = require('busboy');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN. Configure Vercel Blob in environment variables.' });
    }
    const bb = Busboy({ headers: req.headers, limits: { files: 100, fileSize: 50 * 1024 * 1024 } });
    const uploads = [];
    bb.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const ext = filename.split('.').pop();
          const key = `albums/${Date.now()}-${Math.random().toString(36).substr(2,9)}.${ext}`;
          const blob = await put(key, buffer, { access: 'public', contentType: mimeType || 'application/octet-stream' });
          uploads.push({ url: blob.url, name: filename, type: mimeType });
        } catch (e) {
          uploads.push({ error: e.message, name: filename });
        }
      });
    });
    bb.on('finish', () => {
      res.status(200).json({ uploads });
    });
    req.pipe(bb);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};