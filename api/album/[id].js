const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({ error: 'Missing KV configuration' });
    }
    const id = req.query.id || (req.url.match(/album\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) return res.status(400).json({ error: 'Missing album id' });

    const album = await kv.get(`album:${id}`);
    if (album) return res.status(200).json(album);

    const meta = await kv.get(`album:${id}:meta`);
    if (!meta) return res.status(404).json({ error: 'Album not found' });

    const chunksCount = await kv.get(`album:${id}:chunks`);
    const photos = [];
    const count = typeof chunksCount === 'number' ? chunksCount : parseInt(chunksCount) || 0;
    for (let c = 0; c < count; c++) {
      const chunk = await kv.get(`album:${id}:chunk:${c}`);
      if (Array.isArray(chunk)) photos.push(...chunk);
    }

    const full = {
      id: meta.id,
      title: meta.title,
      photos,
      music: meta.music,
      settings: meta.settings,
      createdAt: meta.createdAt
    };
    return res.status(200).json(full);
  } catch (e) {
    console.error('album:get error');
    return res.status(500).json({ error: e.message });
  }
};