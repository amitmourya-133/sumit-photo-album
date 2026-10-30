const session = require('../../lib/session');
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
};

function handleAuth(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const parsedBody = body ? JSON.parse(body) : {};
      const hasLoginCreds = parsedBody.username || parsedBody.password;
      const hasLogoutCreds = parsedBody && parsedBody.logout === true;

      // --- Logout handler ---
      if (hasLogoutCreds) {
        try {
          const cookie = session.parseSessionCookie(req);
          if (cookie) {
            await session.revokeSessionFromCookie(cookie);
          }
        } catch (e) {
          // Best effort
        }
        session.clearSessionCookie(res);
        return sendJson(res, 200, { success: true, message: 'Logged out' });
      }

      // --- Login handler ---
      if (hasLoginCreds) {
        if (req.method !== 'POST') {
          return sendJson(res, 405, { error: 'Method not allowed' });
        }

        const { username, password, email } = parsedBody || {};
        const adminUser = process.env.ADMIN_USERNAME || 'admin';
        const adminPass = process.env.ADMIN_PASSWORD || '';
        const loginEmail = session.normalizeEmail(email || username || '');
        const loginPassword = password || '';

        // Check admin credentials first
        if (adminPass && (loginEmail === adminUser || loginEmail === adminUser.toLowerCase()) && loginPassword === adminPass) {
          try {
            const token = await session.createSession(adminUser, 'admin');
            session.setSessionCookie(res, token);
            return sendJson(res, 200, { success: true, message: 'Login successful', role: 'admin' });
          } catch (e) {
            return sendJson(res, 503, { error: 'Session creation failed' });
          }
          return;
        }

        // Check registered users in Redis
        if (redis.isConfigured() && loginEmail) {
          try {
            const user = await session.getUserByEmail(loginEmail);
            if (user && user.passwordHash) {
              const passwordValid = await session.verifyPassword(loginPassword, user.passwordHash);
              if (passwordValid) {
                const token = await session.createSession(user.email, user.role || 'user');
                session.setSessionCookie(res, token);
                return sendJson(res, 200, { success: true, message: 'Login successful', role: user.role || 'user' });
              }
            }
          } catch (e) {
            // Fall through to invalid credentials
          }
        }

        // Invalid credentials
        return sendJson(res, 401, { error: 'Invalid credentials' });
      }

      // No recognized endpoint
      return sendJson(res, 400, { error: 'Invalid request' });
    } catch (e) {
      return sendJson(res, 500, { error: 'Internal server error' });
    }
  });
};

module.exports = handleAuth;