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
  req.on('end', () => {
    try {
      const { username, password } = JSON.parse(body || '{}');
      const adminUser = process.env.ADMIN_USERNAME || 'admin';
      const adminPass = process.env.ADMIN_PASSWORD || process.env.ADMIN_API_KEY || 'admin123';
      if (username === adminUser && password === adminPass) {
        const token = require('crypto').randomBytes(32).toString('hex');
        const secure = process.env.VERCEL ? '; Secure' : '';
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'session=' + token + '; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax' + secure
        });
        res.end(JSON.stringify({ success: true, message: 'Login successful' }));
      } else {
        sendJson(401, { error: 'Invalid credentials' });
      }
    } catch (e) {
      sendJson(400, { error: 'Invalid request' });
    }
  });
};
