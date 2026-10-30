const redis = require('../../lib/redis-rest');
const crypto = require('crypto');

const EMAIL_TOKEN_TTL = 15 * 60 * 1000; // 15 minutes
const PASSWORD_RESET_TTL = 1 * 60 * 60; // 1 hour

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Store email verification token for a user
async function storeEmailVerificationToken(email, token) {
  const r = redis();
  if (!r.isConfigured()) return false;
  try {
    const key = `email:verification:${normalizeEmail(email)}`;
    await r.setJSON(key, { token, createdAt: new Date().toISOString() });
    await r.expire(key, Math.ceil(EMAIL_TOKEN_TTL / 1000));
    return true;
  } catch (e) {
    return false;
  }
}

// Get email verification token for a user
async function getEmailVerificationToken(email) {
  const r = redis();
  if (!r.isConfigured()) return null;
  try {
    const key = `email:verification:${normalizeEmail(email)}`;
    return await r.getJSON(key);
  } catch (e) {
    return null;
  }
}

// Verify email verification token
async function verifyEmailToken(email, token) {
  const stored = await getEmailVerificationToken(email);
  if (!stored || stored.token !== token) return false;
  if (Date.now() - new Date(stored.createdAt).getTime() > EMAIL_TOKEN_TTL) {
    // Token expired, clean up
    await deleteEmailVerificationToken(email);
    return false;
  }
  // Use single-use: delete token after verification
  await deleteEmailVerificationToken(email);
  return true;
}

// Delete email verification token
async function deleteEmailVerificationToken(email) {
  const r = redis();
  if (!r.isConfigured()) return false;
  try {
    const key = `email:verification:${normalizeEmail(email)}`;
    await r.del(key);
    return true;
  } catch (e) {
    return false;
  }
}

// Store password reset token
async function storePasswordResetToken(email, token) {
  const r = redis();
  if (!r.isConfigured()) return false;
  try {
    const key = `password:reset:${normalizeEmail(email)}`;
    await r.setJSON(key, { token, createdAt: new Date().toISOString() });
    await r.expire(key, Math.ceil(PASSWORD_RESET_TTL / 1000));
    return true;
  } catch (e) {
    return false;
  }
}

// Get password reset token
async function getPasswordResetToken(email) {
  const r = redis();
  if (!r.isConfigured()) return null;
  try {
    const key = `password:reset:${normalizeEmail(email)}`;
    return await r.getJSON(key);
  } catch (e) {
    return null;
  }
}

// Verify password reset token
async function verifyPasswordResetToken(email, token) {
  const stored = await getPasswordResetToken(email);
  if (!stored || stored.token !== token) return false;
  if (Date.now() - new Date(stored.createdAt).getTime() > PASSWORD_RESET_TTL) {
    await deletePasswordResetToken(email);
    return false;
  }
  // Use single-use: delete token after verification
  await deletePasswordResetToken(email);
  return true;
}

// Delete password reset token
async function deletePasswordResetToken(email) {
  const r = redis();
  if (!r.isConfigured()) return false;
  try {
    const key = `password:reset:${normalizeEmail(email)}`;
    await r.del(key);
    return true;
  } catch (e) {
    return false;
  }
}

// Normalize email for storage
function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

module.exports = {
  generateToken,
  storeEmailVerificationToken,
  getEmailVerificationToken,
  verifyEmailToken,
  deleteEmailVerificationToken,
  storePasswordResetToken,
  getPasswordResetToken,
  verifyPasswordResetToken,
  deletePasswordResetToken,
  normalizeEmail
};