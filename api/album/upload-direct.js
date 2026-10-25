const { put } = require('@vercel/blob');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN' });
    }
    const Busboy = require('busboy');
    const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 100 * 1024 * 1024 } });
    let result = null;
    bb.on('file', (fieldname, file, info) => {
      const chunks = [];
      file.on('data', d => chunks.push(d));
      file.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const key = 'albums/uploads/' + Date.now() + '-' + (info.filename || 'file').replace(/[^a-zA-Z0-9.-]/g,'_');
          const blob = await put(key, buffer, { access: 'public', contentType: info.mimeType || 'application/octet-stream' });
          result = { url: blob.url };
        } catch(e) {
          result = { error: e.message };
        }
      });
    });
    bb.on('finish', () => {
      if (!res.headersSent) res.status(200).json(result || { error: 'no file' });
    });
    req.pipe(bb);
  } catch(e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
};