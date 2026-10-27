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
  const header = (req.headers && req.headers.cookie) || '';
  const m = header.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) {
    return sendJson(401, { error: 'Unauthorized' });
  }
  if (req.method !== 'GET') {
    return sendJson(405, { error: 'Method not allowed' });
  }
  const baseUrl = 'https://sumit-photo-album.vercel.app';
  sendJson(200, {
    albums: [
      { id: 'default', title: 'My Photo Album', photoCount: 80, url: baseUrl + '/album.html?id=default' }
    ]
  });
};
