const { put } = require('@vercel/blob');
const { kv } = require('@vercel/kv');
const { v4: uuidv4 } = require('uuid');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { title, photos, music, settings } = req.body || {};
      if (!Array.isArray(photos) || photos.length === 0) {
        return res.status(400).json({ error: 'At least one photo is required' });
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
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        await kv.set(`album:${id}`, album);
      } else {
        // Fallback for local/dev without KV
        global._albums = global._albums || {};
        global._albums[id] = album;
      }
      const url = `https://${req.headers.host}/album/${id}`;
      return res.status(200).json({ id, url, qr: url });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.status(405).json({ error: 'Method not allowed' });
};
