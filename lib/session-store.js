'use strict';

const crypto = require('crypto');
const redis = require('./redis-rest');

function isConfigured() {
  return redis.isConfigured();
}

function generateId() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(username, ttlSeconds) {
  ttlSeconds = ttlSeconds || 24 * 60 * 60;
  if (!isConfigured()) throw new Error('Session store not configured');
  const sid = generateId();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  await redis.set(`session:${sid}`, JSON.stringify({ u: username, exp: expiresAt }), { ex: ttlSeconds });
  return { sid, expiresAt };
}

async function getSession(sid) {
  if (!sid || !isConfigured()) return null;
  const raw = await redis.get(`session:${sid}`);
  if (!raw) return null;
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data.exp !== 'number' || Date.now() > data.exp) {
      await destroySession(sid);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

async function destroySession(sid) {
  if (!sid || !isConfigured()) return;
  try { await redis.del(`session:${sid}`); } catch (e) {}
}

module.exports = { isConfigured, createSession, getSession, destroySession };
