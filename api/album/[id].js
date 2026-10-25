const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const id = req.query.id || (req.url.match(/album\/([a-zA-Z0-9_-]+)/)||[])[1];
    if (!id) return res.status(400).json({ error: 'Missing album id' });
    let album = null;
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      album = await kv.get(`album:${id}`);
    } else {
      global._albums = global._albums || {};
      album = global._albums[id];
    }
    if (!album) return res.status(404).json({ error: 'Album not found' });
    return res.status(200).json(album);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};