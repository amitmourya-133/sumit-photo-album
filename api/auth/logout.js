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
  try {
    await session.destroySession(req);
  } catch (e) {}
  session.clearSessionCookie(res);
  sendJson(200, { success: true, message: 'Logged out' });
};
