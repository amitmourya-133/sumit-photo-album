const { kv } = require('@vercel/kv');
const { v4: uuidv4 } = require('uuid');

const CHUNK_SIZE = 400;

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
        console.error('album: missing KV env vars');
        return res.status(500).json({ error: 'Missing KV_REST_API_URL or KV_REST_API_TOKEN. Configure Upstash Redis (Vercel KV) in environment variables.' });
      }
      const { title, photos, music, settings } = req.body || {};
      if (!Array.isArray(photos) || photos.length === 0) {
        return res.status(400).json({ error: 'At least one photo is required' });
      }
      for (let i = 0; i < Math.min(photos.length, 5); i++) {
        if (typeof photos[i] !== 'string' || !photos[i].startsWith('http')) {
          return res.status(400).json({ error: 'Invalid photo URL' });
        }
      }
      if (music && music.src && (typeof music.src !== 'string' || !music.src.startsWith('http'))) {
        return res.status(400).json({ error: 'Invalid music URL' });
      }

      const id = uuidv4();
      if (photos.length > CHUNK_SIZE) {
        const chunks = chunkArray(photos, CHUNK_SIZE);
        const meta = {
          id,
          title: title || 'Photo Album',
          photoCount: photos.length,
          chunked: true,
          music: music || null,
          settings: settings || { duration: 3, transition: 'fade', musicVolume: 0.7 },
          createdAt: new Date().toISOString()
        };
        await kv.set(`album:${id}:meta`, meta);
        for (let c = 0; c < chunks.length; c++) {
          await kv.set(`album:${id}:chunk:${c}`, chunks[c]);
        }
        await kv.set(`album:${id}:chunks`, chunks.length);
      } else {
        const album = {
          id,
          title: title || 'Photo Album',
          photos,
          music: music || null,
          settings: settings || { duration: 3, transition: 'fade', musicVolume: 0.7 },
          createdAt: new Date().toISOString()
        };
        await kv.set(`album:${id}`, album);
      }

      const url = `https://${req.headers.host}/album/${id}`;
      return res.status(200).json({ id, url, qr: url });
    } catch (e) {
      console.error('album: create error');
      return res.status(500).json({ error: e.message });
    }
  }
  res.status(405).json({ error: 'Method not allowed' });
};