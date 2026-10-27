const session = require('../lib/session');

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

module.exports = async function(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  const s = session.getSession(req);
  if (!s) {
    return sendJson(401, { error: 'Unauthorized' });
  }
  if (req.method !== 'GET') {
    return sendJson(405, { error: 'Method not allowed' });
  }
  // Return the default album representing current production data.
  const fs = require('fs');
  const path = require('path');
  let photoCount = 0;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'photos.json'), 'utf8'));
    photoCount = Array.isArray(data.photos) ? data.photos.length : 0;
  } catch (e) {}
  const baseUrl = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://sumit-photo-album.vercel.app';
  sendJson(200, {
    albums: [
      { id: 'default', title: 'My Photo Album', photoCount: photoCount, url: baseUrl + '/album.html?id=default' }
    ]
  });
};
