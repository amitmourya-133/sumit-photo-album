'use strict';

const crypto = require('crypto');

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_API_KEY || 'dev-session-secret-change-me';
}

function sign(payload) {
  const hmac = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return payload + '.' + hmac;
}

function verify(signed) {
  if (typeof signed !== 'string' || signed.indexOf('.') === -1) return null;
  const idx = signed.lastIndexOf('.');
  const payload = signed.slice(0, idx);
  const hmac = signed.slice(idx + 1);
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
  return data;
}

function createSession(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64');
  return sign(payload);
}

function parseCookies(req) {
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
  });
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const raw = cookies.session;
  if (!raw) return null;
  return verify(raw);
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
  const session = getSession(req);
  if (!session) {
    const body = JSON.stringify({ error: 'Unauthorized' });
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
    return null;
  }
  return session;
}

module.exports = { secret, sign, verify, createSession, parseCookies, getSession, setSessionCookie, clearSessionCookie, requireAuth };
