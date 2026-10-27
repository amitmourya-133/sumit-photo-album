const session = require('../../lib/session');

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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    return sendJson(405, { error: 'Method not allowed' });
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const username = typeof parsed.username === 'string' ? parsed.username : '';
      const password = typeof parsed.password === 'string' ? parsed.password : '';
      const adminUser = process.env.ADMIN_USERNAME || 'admin';
      const adminPass = process.env.ADMIN_PASSWORD || '';
      if (!adminPass) {
        return sendJson(503, { error: 'Authentication not configured' });
      }
      if (username === adminUser && password === adminPass) {
        try {
          const sess = await session.createSession(username);
          session.setSessionCookie(res, sess.token, 24 * 60 * 60);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          res.end(JSON.stringify({ success: true, message: 'Login successful' }));
        } catch (e) {
          return sendJson(503, { error: 'Session creation failed' });
        }
      } else {
        sendJson(401, { error: 'Invalid credentials' });
      }
    } catch (e) {
      sendJson(400, { error: 'Invalid request' });
    }
  });
};
