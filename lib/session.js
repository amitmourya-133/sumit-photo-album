'use strict';

const crypto = require('crypto');

function redis() {
  return require('./redis-rest');
}

// ===== Password Hashing (using scrypt - built-in, secure) =====
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derivedKey) => {
      if (err) return reject(err);
      const saltHex = salt.toString('hex');
      const hashHex = derivedKey.toString('hex');
      resolve(`scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${saltHex}:${hashHex}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    if (!storedHash || typeof storedHash !== 'string') return resolve(false);
    const parts = storedHash.split(':');
    if (parts[0] !== 'scrypt' || parts.length !== 6) return resolve(false);
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'hex');
    const hash = Buffer.from(parts[5], 'hex');
    crypto.scrypt(password, salt, hash.length, { N, r, p }, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== hash.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(derivedKey, hash));
      } catch (e) {
        resolve(false);
      }
    });
  });
}

// ===== Email Normalization =====
function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

// ===== User Storage (Redis) =====
async function emailExists(email) {
  const r = redis();
  if (!r.isConfigured()) return false;
  const key = `user:email:${normalizeEmail(email)}`;
  const data = await r.getJSON(key);
  return !!data;
}

async function getUserByEmail(email) {
  const r = redis();
  if (!r.isConfigured()) return null;
  const key = `user:email:${normalizeEmail(email)}`;
  return r.getJSON(key);
}

async function createUser({ name, email, passwordHash, role }) {
  const r = redis();
  if (!r.isConfigured()) throw new Error('Storage not configured');
  const normalizedEmail = normalizeEmail(email);
  const key = `user:email:${normalizedEmail}`;
  const id = crypto.randomUUID();
  const user = {
    id,
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role: role || 'user',
    createdAt: new Date().toISOString()
  };
  await r.setJSON(key, user);
  return user;
}

// ===== Session Management with Server-Side Revocation =====
function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_API_KEY || 'dev-session-secret-change-me';
}

// Generate a unique session ID
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// Sign session data into a cookie value
function signSession(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64');
  const hmac = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return payload + '.' + hmac;
}

// Verify signed session cookie
function verifySession(cookieValue) {
  if (typeof cookieValue !== 'string' || cookieValue.indexOf('.') === -1) return null;
  const idx = cookieValue.lastIndexOf('.');
  const payload = cookieValue.slice(0, idx);
  const hmac = cookieValue.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  if (hmac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch (e) {
    return null;
  }
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); } catch (e) { return null; }
  if (!data || typeof data.exp !== 'number' || Date.now() > data.exp) return null;
  if (!data.sid) return null; // Require session ID for revocation
  return data;
}

// Create a new session with server-side storage
async function createSession(username, role) {
  const r = redis();
  const sid = generateSessionId();
  const exp = Date.now() + 24 * 60 * 60 * 1000;
  const sessionData = { sid, u: username, r: role || 'user', exp };

  // Store in Redis for revocation support
  if (r.isConfigured()) {
    try {
      await r.setJSON(`session:${sid}`, { u: username, r: role || 'user', exp, createdAt: new Date().toISOString() });
      // Set TTL via direct pipeline (setJSON doesn't support TTL)
      // We'll use a separate approach: store with expiry in the value and check on read
    } catch (e) {
      // Redis unavailable, continue with stateless session
    }
  }

  return signSession(sessionData);
}

// Check if session is valid (signature + server-side existence)
async function isSessionValid(cookieValue) {
  const data = verifySession(cookieValue);
  if (!data) return null;

  const r = redis();
  if (r.isConfigured()) {
    try {
      const stored = await r.getJSON(`session:${data.sid}`);
      if (!stored) return null; // Session was revoked or never existed
      if (stored.exp && Date.now() > stored.exp) {
        await revokeSession(data.sid);
        return null;
      }
    } catch (e) {
      // Redis error - fail closed for security
      return null;
    }
  }

  return data;
}

// Revoke a session server-side
async function revokeSession(sid) {
  if (!sid) return;
  const r = redis();
  if (r.isConfigured()) {
    try {
      await r.pipeline([['del', `session:${sid}`]]);
    } catch (e) {
      // Best effort
    }
  }
}

// Revoke session from cookie
async function revokeSessionFromCookie(cookieValue) {
  const data = verifySession(cookieValue);
  if (data && data.sid) {
    await revokeSession(data.sid);
  }
}

function parseSessionCookie(req) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const m = header.match(/(?:^|;\\s*)session=([^;]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (e) {
    return m[1];
  }
}

function setSessionCookie(res, token) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'session=' + encodeURIComponent(token) + '; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax' + secure);
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' + secure);
}

function requireAuth(req, res) {
  const cookie = parseSessionCookie(req);
  const s = verifySession(cookie);
  if (!s) {
    const body = JSON.stringify({ error: 'Unauthorized' });
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
    return null;
  }
  return s;
}

// Async version of requireAuth that checks server-side session
async function requireAuthAsync(req, res) {
  const cookie = parseSessionCookie(req);
  const s = await isSessionValid(cookie);
  if (!s) {
    const body = JSON.stringify({ error: 'Unauthorized' });
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
    return null;
  }
  return s;
}

function createSessionPayload(username, role) {
  // This is kept for backward compatibility but now uses createSession
  return null; // Use createSession instead
}

module.exports = {
  secret, signSession, verifySession, parseSessionCookie, setSessionCookie, clearSessionCookie,
  requireAuth, requireAuthAsync, createSession, isSessionValid, revokeSession, revokeSessionFromCookie,
  hashPassword, verifyPassword, normalizeEmail, emailExists, getUserByEmail, createUser
};