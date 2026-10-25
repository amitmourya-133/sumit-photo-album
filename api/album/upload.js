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
      console.error('upload: missing BLOB_READ_WRITE_TOKEN');
      return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN. Configure Vercel Blob in environment variables.' });
    }

    const bb = Busboy({ headers: req.headers, limits: { files: 100, fileSize: 50 * 1024 * 1024 } });
    const uploadPromises = [];
    const uploads = [];

    bb.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      const p = new Promise((resolve) => {
        file.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) {
              uploads.push({ error: 'Empty file', name: filename, fieldname });
              return resolve();
            }
            const ext = (filename.split('.').pop() || 'bin').toLowerCase();
            const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
            const key = `albums/${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${safeName}`;
            const blob = await put(key, buffer, { access: 'public', contentType: mimeType || 'application/octet-stream' });
            uploads.push({ url: blob.url, name: filename, type: mimeType, fieldname });
            resolve();
          } catch (e) {
            console.error('upload: blob put failed');
            uploads.push({ error: e.message, name: filename, fieldname });
            resolve();
          }
        });
      });
      uploadPromises.push(p);
    });

    bb.on('error', (err) => {
      console.error('upload: busboy error');
      if (!res.headersSent) {
        res.status(400).json({ error: err.message });
      }
    });

    bb.on('finish', async () => {
      try {
        await Promise.all(uploadPromises);
        if (res.headersSent) return;
        res.status(200).json({ uploads });
      } catch (e) {
        console.error('upload: finish error');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Upload processing failed' });
        }
      }
    });

    req.pipe(bb);
  } catch (e) {
    console.error('upload: unexpected error');
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
};