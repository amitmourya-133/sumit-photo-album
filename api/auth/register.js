const session = require('../../lib/session');
const redis = require('../../lib/redis-rest');

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload || {});
  if (!body) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end('{}');
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// Rate limiting: simple in-memory fallback when KV not configured
// Production should have KV configured for proper rate limiting
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

module.exports = async function(req, res) {
  // CORS preflight
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
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: 'Invalid request body' });
  }

  const { name, email, password, confirmPassword, acceptTerms } = body || {};

  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return sendJson(res, 400, { error: 'Full name must be at least 2 characters' });
  }
  if (name.trim().length > 100) {
    return sendJson(res, 400, { error: 'Full name must be less than 100 characters' });
  }

  // Validate email
  const normalizedEmail = session.normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return sendJson(res, 400, { error: 'Please provide a valid email address' });
  }

  // Validate password
  if (!password || typeof password !== 'string') {
    return sendJson(res, 400, { error: 'Password is required' });
  }
  if (password !== confirmPassword) {
    return sendJson(res, 400, { error: 'Passwords do not match' });
  }
  if (!isStrongPassword(password)) {
    return sendJson(res, 400, { error: 'Password must be at least 8 characters with uppercase, lowercase, and a number' });
  }

  // Validate terms acceptance
  if (!acceptTerms) {
    return sendJson(res, 400, { error: 'You must accept the Terms and Privacy Policy' });
  }

  // Check if Redis is configured
  if (!redis.isConfigured()) {
    return sendJson(res, 503, { error: 'Storage not configured' });
  }

  // Check for duplicate email
  try {
    const exists = await session.emailExists(normalizedEmail);
    if (exists) {
      return sendJson(res, 409, { error: 'An account with this email already exists' });
    }
  } catch (e) {
    return sendJson(res, 500, { error: 'Registration failed. Please try again.' });
  }

  // Hash password
  let passwordHash;
  try {
    passwordHash = await session.hashPassword(password);
  } catch (e) {
    return sendJson(res, 500, { error: 'Registration failed. Please try again.' });
  }

  // Create user
  try {
    const user = await session.createUser({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'user' // Regular user, NOT admin
    });
    return sendJson(res, 201, {
      success: true,
      message: 'Account created successfully. Please log in.',
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (e) {
    return sendJson(res, 500, { error: 'Registration failed. Please try again.' });
  }
};