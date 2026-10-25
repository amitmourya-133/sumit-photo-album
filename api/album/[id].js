const redis = require('../../lib/redis-rest');

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
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed. Use GET.' });
      return;
    }
    if (!redis.isConfigured()) {
      sendJson(res, 503, { error: 'Missing KV_REST_API_URL or KV_REST_API_TOKEN. Connect Upstash Redis (Vercel KV) in Vercel Storage settings.' });
      return;
    }
    const id = (req.query && req.query.id) || (req.url.match(/album\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) {
      sendJson(res, 400, { error: 'Missing album id' });
      return;
    }
    const album = await redis.getJSON(`album:${id}`);
    if (album && album.photos && !album.chunked) {
      sendJson(res, 200, {
        id: album.id,
        title: album.title,
        photos: album.photos,
        music: album.music,
        settings: album.settings,
        createdAt: album.createdAt
      });
      return;
    }
    const meta = (await redis.getJSON(`album:${id}:meta`)) || album;
    if (!meta || !meta.id) {
      sendJson(res, 404, { error: 'Album not found' });
      return;
    }
    const chunksCount = meta.chunkCount || 0;
    let photos = [];
    if (chunksCount > 0) {
      const commands = [];
      for (let c = 0; c < chunksCount; c++) commands.push(['get', `album:${id}:chunk:${c}`]);
      const results = await redis.pipeline(commands);
      for (const raw of results) {
        if (typeof raw === 'string') {
          try {
            const chunk = JSON.parse(raw);
            if (Array.isArray(chunk)) photos = photos.concat(chunk);
          } catch (e) {
            // ignore malformed chunk
          }
        }
      }
    }
    if (!photos.length) photos = meta.photos || [];
    sendJson(res, 200, {
      id: meta.id,
      title: meta.title,
      photos,
      music: meta.music,
      settings: meta.settings,
      createdAt: meta.createdAt
    });
  } catch (error) {
    console.error('api/album/[id] failed:', error && error.message ? error.message : 'unknown');
    sendJson(res, 500, { error: error && error.message ? error.message : 'Failed to load album' });
  }
};
