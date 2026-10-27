'use strict';

const crypto = require('crypto');
const store = require('./session-store');

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_API_KEY || 'dev-session-secret-change-me';
}

function signSid(sid) {
  const hmac = crypto.createHmac('sha256', secret()).update(sid).digest('hex');
  return sid + '.' + hmac;
}

function verifySignedSid(signed) {
  if (typeof signed !== 'string' || signed.indexOf('.') === -1) return null;
  const idx = signed.lastIndexOf('.');
  const sid = signed.slice(0, idx);
  const hmac = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret()).update(sid).digest('hex');
  if (hmac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch (e) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(sid)) return null;
  return sid;
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

function setSessionCookie(res, signedSid, maxAge) {
  maxAge = maxAge || 86400;
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'session=' + encodeURIComponent(signedSid) + '; HttpOnly; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure);
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' + secure);
}

async function createSession(username) {
  const { sid, expiresAt } = await store.createSession(username, 24 * 60 * 60);
  return { token: signSid(sid), expiresAt };
}

async function getSession(req) {
  const cookies = parseCookies(req);
  const raw = cookies.session;
  if (!raw) return null;
  const sid = verifySignedSid(raw);
  if (!sid) return null;
  const data = await store.getSession(sid);
  if (!data) return null;
  return { sid, ...data };
}

async function destroySession(req) {
  const cookies = parseCookies(req);
  const raw = cookies.session;
  if (!raw) return;
  const sid = verifySignedSid(raw);
  if (!sid) return;
  await store.destroySession(sid);
}

module.exports = { createSession, getSession, destroySession, setSessionCookie, clearSessionCookie, parseCookies };
