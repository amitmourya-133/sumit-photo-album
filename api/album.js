const { kv } = require('@vercel/kv');
const { v4: uuidv4 } = require('uuid');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
        console.error('album: missing KV env vars');
        return res.status(500).json({ error: 'Missing KV_REST_API_URL or KV_REST_API_TOKEN. Configure Vercel KV in environment variables.' });
      }
      const { title, photos, music, settings } = req.body || {};
      if (!Array.isArray(photos) || photos.length === 0) {
        return res.status(400).json({ error: 'At least one photo is required' });
      }
      for (let i = 0; i < photos.length; i++) {
        if (typeof photos[i] !== 'string' || !photos[i].startsWith('http')) {
          return res.status(400).json({ error: 'Invalid photo URL' });
        }
      }
      if (music && (typeof music.src !== 'string' || !music.src.startsWith('http'))) {
        return res.status(400).json({ error: 'Invalid music URL' });
      }
      const id = uuidv4();
      const album = {
        id,
        title: title || 'Photo Album',
        photos,
        music: music || null,
        settings: settings || {},
        createdAt: new Date().toISOString()
      };
      await kv.set(`album:${id}`, album);
      const url = `https://${req.headers.host}/album/${id}`;
      return res.status(200).json({ id, url, qr: url });
    } catch (e) {
      console.error('album: create error');
      return res.status(500).json({ error: e.message });
    }
  }
  res.status(405).json({ error: 'Method not allowed' });
};