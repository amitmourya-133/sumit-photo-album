const session = require('../lib/session');

module.exports = async function(req, res) {
  const sendJson = (status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  const s = await session.requireAuthAsync(req, res);
  if (!s) return; // Already sent 401
  if (req.method !== 'GET') {
    return sendJson(405, { error: 'Method not allowed' });
  }
  const baseUrl = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://sumit-photo-album.vercel.app';
  // List albums associated with this user's session
  const r = require('../lib/redis-rest');
  let userAlbums = [];
  try {
    userAlbums = await r.getJSON(`user:albums:${s.u}`) || [];
  } catch (e) {
    // Best effort
  }
  const albums = [];
  for (const albumId of userAlbums) {
    const meta = await r.getJSON(`album:${albumId}:meta`);
    if (!meta || !meta.id) continue;
    // Include album if owned by user or has no owner (public album)
    const isOwned = meta.ownerId === s.u;
    if (isOwned || !meta.ownerId) {
      albums.push({
        id: meta.id,
        title: meta.title,
        photoCount: meta.photoCount || 0,
        url: baseUrl + '/album.html?id=' + meta.id,
        ownerId: meta.ownerId
      });
    }
  }
  sendJson(200, { albums });
};