'use strict';

// Consolidated platform API: combines features, business, and AI endpoints
// to stay within Vercel Hobby plan's 12-function limit.

const redis = require('../lib/redis-rest');
const session = require('../lib/session');
const crypto = require('crypto');

// Re-export all handlers from the individual modules
// Since we can't use require for local modules in serverless (they'd be separate functions),
// we inline everything here.

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > 5 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ===== SHARED HELPERS =====
function normalizeVisitorId(req) {
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 16);
}

function sanitizeText(text, maxLen) {
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, maxLen || 500).replace(/<[^>]*>/g, '');
}

// ===== PLANS =====
const PLANS = {
  free: { name: 'Free', maxAlbums: 3, maxPhotos: 100, maxVideos: 0, maxStorageMB: 500, features: ['basic_themes', 'standard_qr'] },
  pro: { name: 'Pro', maxAlbums: 20, maxPhotos: 2000, maxVideos: 10, maxStorageMB: 10000, features: ['basic_themes', 'standard_qr', 'custom_qr', 'password_protection', 'video_upload', 'advanced_customization'] },
  premium: { name: 'Premium', maxAlbums: 100, maxPhotos: 10000, maxVideos: 50, maxStorageMB: 50000, features: ['all_themes', 'custom_qr', 'password_protection', 'video_upload', 'advanced_customization', 'ai_features', 'ai_highlight_video', 'advanced_analytics', 'custom_branding'] }
};

function getPlanLimits(planId) { return PLANS[planId] || PLANS.free; }

async function hasAIAccess(userId) {
  const sub = await redis.getJSON(`user:subscription:${userId}`) || { plan: 'free' };
  return sub.plan === 'premium';
}

// ===== OPENAI HELPER =====
async function callOpenAI(prompt, options) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: 'OpenAI API key not configured.' };
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: options.model || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: options.maxTokens || 500, temperature: options.temperature || 0.7 })
    });
    const data = await response.json();
    if (data.error) return { error: data.error.message };
    return { result: data.choices?.[0]?.message?.content || '' };
  } catch (e) { return { error: e.message }; }
}

// ===== MAIN HANDLER =====
module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }

    if (!redis.isConfigured()) return sendJson(res, 503, { error: 'Storage not configured' });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const category = (req.query && req.query.category) || (url.searchParams.get('category')) || '';
    const action = (req.query && req.query.action) || (url.searchParams.get('action')) || '';
    const albumId = (req.query && req.query.albumId) || (url.searchParams.get('albumId')) || '';

    let body = {};
    if (req.method === 'POST') {
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }

    // Parse session cookie without sending 401 (auth checked per-action)
    let s = null;
    try {
      const cookie = session.parseSessionCookie(req);
      if (cookie) s = await session.isSessionValid(cookie);
    } catch (e) { /* no auth */ }

    // Route by category
    switch (category) {
      // ===== FEATURES =====
      case 'guestbook': {
        // (Guestbook logic - same as features.js)
        const settingsKey = `album:${albumId}:guestbook:settings`;
        const messagesKey = `album:${albumId}:guestbook`;

        if (action === 'get-settings') {
          const settings = await redis.getJSON(settingsKey) || { enabled: true, moderation: true };
          return sendJson(res, 200, { settings });
        }
        if (action === 'update-settings') {
          if (!s) return;
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const settings = { enabled: !!body.enabled, moderation: !!body.moderation };
          await redis.setJSON(settingsKey, settings);
          return sendJson(res, 200, { success: true, settings });
        }
        if (action === 'list') {
          const settings = await redis.getJSON(settingsKey) || { enabled: true, moderation: true };
          if (!settings.enabled) return sendJson(res, 200, { messages: [], disabled: true });
          const messages = await redis.getJSON(messagesKey) || [];
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          const isOwner = s && meta && meta.ownerId === s.u;
          const isAdmin = s && s.r === 'admin';
          const filtered = (isOwner || isAdmin) ? messages : messages.filter(m => m.approved);
          return sendJson(res, 200, { messages: filtered });
        }
        if (action === 'add') {
          const settings = await redis.getJSON(settingsKey) || { enabled: true, moderation: true };
          if (!settings.enabled) return sendJson(res, 400, { error: 'Guestbook is disabled' });
          const name = sanitizeText(body.name, 100);
          const message = sanitizeText(body.message, 1000);
          if (!name || !message) return sendJson(res, 400, { error: 'Name and message are required' });
          const visitorId = normalizeVisitorId(req);
          const rateKey = `guestbook:rate:${albumId}:${visitorId}`;
          const rateData = await redis.getJSON(rateKey);
          if (rateData && rateData.count >= 5) return sendJson(res, 429, { error: 'Too many messages. Please try again later.' });
          const msg = { id: crypto.randomUUID(), name, message, visitorId, approved: !settings.moderation, createdAt: new Date().toISOString() };
          const messages = await redis.getJSON(messagesKey) || [];
          messages.unshift(msg);
          if (messages.length > 500) messages.splice(500);
          await redis.setJSON(messagesKey, messages);
          await redis.setJSON(rateKey, { count: (rateData ? rateData.count : 0) + 1, resetAt: Date.now() + 3600000 });
          return sendJson(res, 201, { success: true, message: msg });
        }
        if (action === 'approve' || action === 'reject') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const messages = await redis.getJSON(messagesKey) || [];
          const idx = messages.findIndex(m => m.id === body.messageId);
          if (idx === -1) return sendJson(res, 404, { error: 'Message not found' });
          messages[idx].approved = (action === 'approve');
          await redis.setJSON(messagesKey, messages);
          return sendJson(res, 200, { success: true });
        }
        if (action === 'delete') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const messages = await redis.getJSON(messagesKey) || [];
          await redis.setJSON(messagesKey, messages.filter(m => m.id !== body.messageId));
          return sendJson(res, 200, { success: true });
        }
        return sendJson(res, 400, { error: 'Unknown guestbook action' });
      }

      case 'likes': {
        const likesKey = `album:${albumId}:likes`;
        if (action === 'get') {
          const likes = await redis.getJSON(likesKey) || {};
          return sendJson(res, 200, { likes });
        }
        if (action === 'toggle') {
          const photoUrl = body.photoUrl;
          if (!photoUrl) return sendJson(res, 400, { error: 'Photo URL required' });
          const visitorId = normalizeVisitorId(req);
          const visitorLikesKey = `album:${albumId}:visitor-likes:${visitorId}`;
          const visitorLikes = await redis.getJSON(visitorLikesKey) || {};
          const likes = await redis.getJSON(likesKey) || {};
          const currentlyLiked = !!visitorLikes[photoUrl];
          if (currentlyLiked) { likes[photoUrl] = Math.max(0, (likes[photoUrl] || 1) - 1); delete visitorLikes[photoUrl]; }
          else { likes[photoUrl] = (likes[photoUrl] || 0) + 1; visitorLikes[photoUrl] = true; }
          await redis.setJSON(likesKey, likes);
          await redis.setJSON(visitorLikesKey, visitorLikes);
          return sendJson(res, 200, { liked: !currentlyLiked, count: likes[photoUrl] || 0 });
        }
        if (action === 'favorites') {
          const visitorId = normalizeVisitorId(req);
          const favKey = `album:${albumId}:favorites:${visitorId}`;
          if (req.method === 'GET') {
            const favorites = await redis.getJSON(favKey) || [];
            return sendJson(res, 200, { favorites });
          }
          if (req.method === 'POST') {
            const favorites = await redis.getJSON(favKey) || [];
            const photoUrl = body.photoUrl;
            if (!photoUrl) return sendJson(res, 400, { error: 'Photo URL required' });
            const idx = favorites.indexOf(photoUrl);
            if (idx === -1) favorites.push(photoUrl); else favorites.splice(idx, 1);
            await redis.setJSON(favKey, favorites);
            return sendJson(res, 200, { favorites, isFavorite: idx === -1 });
          }
        }
        return sendJson(res, 400, { error: 'Unknown likes action' });
      }

      case 'reactions': {
        if (action === 'get') {
          const photoId = body.photoId || body.photoUrl;
          if (!photoId) return sendJson(res, 400, { error: 'Photo ID required' });
          const reactionsKey = `album:${albumId}:reactions:${crypto.createHash('md5').update(photoId).digest('hex')}`;
          const reactions = await redis.getJSON(reactionsKey) || {};
          return sendJson(res, 200, { reactions });
        }
        if (action === 'add') {
          const photoId = body.photoId || body.photoUrl;
          const emoji = body.emoji;
          if (!photoId || !emoji) return sendJson(res, 400, { error: 'Photo ID and emoji required' });
          const visitorId = normalizeVisitorId(req);
          const reactionsKey = `album:${albumId}:reactions:${crypto.createHash('md5').update(photoId).digest('hex')}`;
          const reactions = await redis.getJSON(reactionsKey) || {};
          const visitorKey = `album:${albumId}:reaction-visitor:${visitorId}:${crypto.createHash('md5').update(photoId).digest('hex')}`;
          const visitorReactions = await redis.getJSON(visitorKey) || {};
          if (visitorReactions[emoji]) {
            reactions[emoji] = Math.max(0, (reactions[emoji] || 1) - 1);
            if (reactions[emoji] === 0) delete reactions[emoji];
            delete visitorReactions[emoji];
          } else {
            reactions[emoji] = (reactions[emoji] || 0) + 1;
            visitorReactions[emoji] = true;
          }
          await redis.setJSON(reactionsKey, reactions);
          await redis.setJSON(visitorKey, visitorReactions);
          return sendJson(res, 200, { reactions, reacted: !!visitorReactions[emoji] });
        }
        return sendJson(res, 400, { error: 'Unknown reactions action' });
      }

      case 'timeline': {
        const timelineKey = `album:${albumId}:timeline`;
        if (action === 'get') {
          const timeline = await redis.getJSON(timelineKey) || { events: [] };
          return sendJson(res, 200, { timeline });
        }
        if (action === 'add-event') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const event = { id: crypto.randomUUID(), title: sanitizeText(body.title, 100), description: sanitizeText(body.description, 500), date: body.date || new Date().toISOString().split('T')[0], photoUrls: Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 50) : [], order: body.order || 0, createdAt: new Date().toISOString() };
          const timeline = await redis.getJSON(timelineKey) || { events: [] };
          timeline.events.push(event);
          timeline.events.sort((a, b) => new Date(a.date) - new Date(b.date));
          await redis.setJSON(timelineKey, timeline);
          return sendJson(res, 201, { success: true, event });
        }
        if (action === 'update-event') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const timeline = await redis.getJSON(timelineKey) || { events: [] };
          const idx = timeline.events.findIndex(e => e.id === body.eventId);
          if (idx === -1) return sendJson(res, 404, { error: 'Event not found' });
          if (body.title !== undefined) timeline.events[idx].title = sanitizeText(body.title, 100);
          if (body.description !== undefined) timeline.events[idx].description = sanitizeText(body.description, 500);
          if (body.date !== undefined) timeline.events[idx].date = body.date;
          if (body.photoUrls !== undefined) timeline.events[idx].photoUrls = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 50) : [];
          timeline.events.sort((a, b) => new Date(a.date) - new Date(b.date));
          await redis.setJSON(timelineKey, timeline);
          return sendJson(res, 200, { success: true });
        }
        if (action === 'delete-event') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const timeline = await redis.getJSON(timelineKey) || { events: [] };
          timeline.events = timeline.events.filter(e => e.id !== body.eventId);
          await redis.setJSON(timelineKey, timeline);
          return sendJson(res, 200, { success: true });
        }
        return sendJson(res, 400, { error: 'Unknown timeline action' });
      }

      case 'cover': {
        const coverKey = `album:${albumId}:cover`;
        if (action === 'get') {
          const cover = await redis.getJSON(coverKey) || null;
          return sendJson(res, 200, { cover });
        }
        if (action === 'set') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const cover = { title: sanitizeText(body.title, 120) || meta.title || 'Photo Album', subtitle: sanitizeText(body.subtitle, 200), description: sanitizeText(body.description, 500), eventDate: body.eventDate || '', coupleNames: sanitizeText(body.coupleNames, 120), eventName: sanitizeText(body.eventName, 120), template: body.template || 'classic', backgroundImage: body.backgroundImage || '', logoImage: body.logoImage || '', updatedAt: new Date().toISOString() };
          await redis.setJSON(coverKey, cover);
          return sendJson(res, 201, { success: true, cover });
        }
        return sendJson(res, 400, { error: 'Unknown cover action' });
      }

      case 'privacy': {
        const privacyKey = `album:${albumId}:privacy`;
        if (action === 'get') {
          const privacy = await redis.getJSON(privacyKey) || { mode: 'public' };
          const safe = { mode: privacy.mode, hasPassword: !!privacy.passwordHash, expiryDate: privacy.expiryDate, accessCode: privacy.accessCode ? '***' : null };
          return sendJson(res, 200, { privacy: safe });
        }
        if (action === 'set') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const mode = ['public', 'private', 'password', 'expiring'].includes(body.mode) ? body.mode : 'public';
          const privacy = { mode, updatedAt: new Date().toISOString() };
          if (mode === 'password' && body.password) privacy.passwordHash = await session.hashPassword(body.password);
          else privacy.passwordHash = null;
          if (mode === 'expiring' && body.expiryDate) privacy.expiryDate = body.expiryDate;
          if (body.accessCode) privacy.accessCode = sanitizeText(body.accessCode, 50);
          if (body.regenerateLink) privacy.shareToken = crypto.randomBytes(16).toString('hex');
          await redis.setJSON(privacyKey, privacy);
          return sendJson(res, 200, { success: true, privacy: { mode: privacy.mode, hasPassword: !!privacy.passwordHash, expiryDate: privacy.expiryDate } });
        }
        if (action === 'verify') {
          const privacy = await redis.getJSON(privacyKey) || { mode: 'public' };
          if (privacy.mode === 'public') return sendJson(res, 200, { allowed: true });
          if (privacy.mode === 'expiring' && privacy.expiryDate && new Date() > new Date(privacy.expiryDate)) return sendJson(res, 403, { error: 'This album has expired' });
          if (privacy.mode === 'password') {
            if (!body.password) return sendJson(res, 401, { error: 'Password required' });
            const valid = await session.verifyPassword(body.password, privacy.passwordHash);
            if (!valid) return sendJson(res, 401, { error: 'Invalid password' });
          }
          if (privacy.accessCode && body.accessCode !== privacy.accessCode) return sendJson(res, 401, { error: 'Invalid access code' });
          return sendJson(res, 200, { allowed: true });
        }
        if (action === 'revoke-link') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const privacy = await redis.getJSON(privacyKey) || { mode: 'public' };
          privacy.shareToken = crypto.randomBytes(16).toString('hex');
          privacy.revokedAt = new Date().toISOString();
          await redis.setJSON(privacyKey, privacy);
          return sendJson(res, 200, { success: true, newToken: privacy.shareToken });
        }
        return sendJson(res, 400, { error: 'Unknown privacy action' });
      }

      case 'theme': {
        const themeKey = `album:${albumId}:theme`;
        if (action === 'get') {
          const theme = await redis.getJSON(themeKey) || { id: 'minimal', custom: {} };
          return sendJson(res, 200, { theme });
        }
        if (action === 'set') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const ALLOWED_THEMES = ['wedding', 'romantic', 'birthday', 'anniversary', 'travel', 'family', 'baby', 'graduation', 'nature', 'minimal', 'luxury'];
          const themeId = ALLOWED_THEMES.includes(body.themeId) ? body.themeId : 'minimal';
          const theme = { id: themeId, custom: { primaryColor: body.custom?.primaryColor || '', accentColor: body.custom?.accentColor || '', fontFamily: body.custom?.fontFamily || '', backgroundPattern: body.custom?.backgroundPattern || '' }, updatedAt: new Date().toISOString() };
          await redis.setJSON(themeKey, theme);
          return sendJson(res, 200, { success: true, theme });
        }
        if (action === 'list') {
          const themes = [
            { id: 'wedding', name: 'Wedding', description: 'Elegant wedding theme with soft colors' },
            { id: 'romantic', name: 'Romantic', description: 'Warm romantic tones' },
            { id: 'birthday', name: 'Birthday', description: 'Fun and colorful celebration' },
            { id: 'anniversary', name: 'Anniversary', description: 'Classic anniversary elegance' },
            { id: 'travel', name: 'Travel', description: 'Adventure-inspired design' },
            { id: 'family', name: 'Family', description: 'Warm family memories' },
            { id: 'baby', name: 'Baby Memories', description: 'Soft and gentle baby theme' },
            { id: 'graduation', name: 'Graduation', description: 'Achievement celebration' },
            { id: 'nature', name: 'Nature', description: 'Fresh and natural tones' },
            { id: 'minimal', name: 'Minimal', description: 'Clean and simple' },
            { id: 'luxury', name: 'Luxury', description: 'Premium gold and dark tones' }
          ];
          return sendJson(res, 200, { themes });
        }
        return sendJson(res, 400, { error: 'Unknown theme action' });
      }

      case 'analytics': {
        if (action === 'record-scan') {
          const visitorId = normalizeVisitorId(req);
          const scanKey = `album:${albumId}:scans`;
          const countKey = `album:${albumId}:scans:count`;
          const uniqueKey = `album:${albumId}:scans:unique`;
          const scan = { timestamp: new Date().toISOString(), visitorId, device: req.headers['user-agent'] ? (req.headers['user-agent'].includes('Mobile') ? 'mobile' : 'desktop') : 'unknown', referrer: req.headers['referer'] || '' };
          const scans = await redis.getJSON(scanKey) || [];
          scans.push(scan);
          if (scans.length > 10000) scans.splice(0, scans.length - 10000);
          await redis.setJSON(scanKey, scans);
          const count = (await redis.getJSON(countKey) || 0) + 1;
          await redis.setJSON(countKey, count);
          const uniqueVisitors = await redis.getJSON(uniqueKey) || [];
          if (!uniqueVisitors.includes(visitorId)) { uniqueVisitors.push(visitorId); if (uniqueVisitors.length > 10000) uniqueVisitors.splice(0, uniqueVisitors.length - 10000); await redis.setJSON(uniqueKey, uniqueVisitors); }
          return sendJson(res, 200, { recorded: true });
        }
        if (action === 'get') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || (meta.ownerId !== s.u && s.r !== 'admin')) return sendJson(res, 403, { error: 'Access denied' });
          const count = await redis.getJSON(`album:${albumId}:scans:count`) || 0;
          const uniqueVisitors = await redis.getJSON(`album:${albumId}:scans:unique`) || [];
          const scans = await redis.getJSON(`album:${albumId}:scans`) || [];
          const byDate = {};
          for (const scan of scans) { const date = scan.timestamp.split('T')[0]; byDate[date] = (byDate[date] || 0) + 1; }
          const byDevice = { mobile: 0, desktop: 0, unknown: 0 };
          for (const scan of scans) { byDevice[scan.device] = (byDevice[scan.device] || 0) + 1; }
          return sendJson(res, 200, { totalScans: count, uniqueVisitors: uniqueVisitors.length, byDate, byDevice, recentScans: scans.slice(-20).reverse() });
        }
        return sendJson(res, 400, { error: 'Unknown analytics action' });
      }

      case 'qr': {
        const qrKey = `album:${albumId}:qr`;
        if (action === 'get') {
          const qr = await redis.getJSON(qrKey) || { style: 'standard', color: '#000000', bgColor: '#ffffff', logoUrl: '', errorCorrection: 'M' };
          return sendJson(res, 200, { qr });
        }
        if (action === 'set') {
          if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
          const meta = await redis.getJSON(`album:${albumId}:meta`) || await redis.getJSON(`album:${albumId}`);
          if (!meta || meta.ownerId !== s.u) return sendJson(res, 403, { error: 'Access denied' });
          const qr = { style: ['standard', 'rounded', 'dots', 'classy'].includes(body.style) ? body.style : 'standard', color: /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#000000', bgColor: /^#[0-9a-fA-F]{6}$/.test(body.bgColor) ? body.bgColor : '#ffffff', logoUrl: body.logoUrl || '', errorCorrection: ['L', 'M', 'Q', 'H'].includes(body.errorCorrection) ? body.errorCorrection : 'M', updatedAt: new Date().toISOString() };
          await redis.setJSON(qrKey, qr);
          return sendJson(res, 200, { success: true, qr });
        }
        return sendJson(res, 400, { error: 'Unknown QR action' });
      }

      // ===== BUSINESS =====
      case 'business': {
        if (action === 'get-plans') return sendJson(res, 200, { plans: PLANS });
        if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
        if (action === 'get-subscription') {
          const sub = await redis.getJSON(`user:subscription:${s.u}`) || { plan: 'free', status: 'active', startedAt: new Date().toISOString() };
          return sendJson(res, 200, { subscription: sub, limits: getPlanLimits(sub.plan) });
        }
        if (action === 'create-order') {
          const { planId, billingCycle } = body;
          if (!PLANS[planId]) return sendJson(res, 400, { error: 'Invalid plan' });
          if (!['monthly', 'yearly'].includes(billingCycle)) return sendJson(res, 400, { error: 'Invalid billing cycle' });
          const price = billingCycle === 'yearly' ? (planId === 'pro' ? 9999 : 19999) : (planId === 'pro' ? 999 : 1999);
          const orderId = crypto.randomUUID();
          const order = { id: orderId, userId: s.u, planId, billingCycle, amount: price, currency: 'INR', status: 'created', createdAt: new Date().toISOString(), razorpayOrderId: `rzp_order_${orderId.slice(0, 8)}` };
          await redis.setJSON(`order:${orderId}`, order);
          const userOrders = await redis.getJSON(`user:orders:${s.u}`) || [];
          userOrders.push(orderId);
          await redis.setJSON(`user:orders:${s.u}`, userOrders);
          return sendJson(res, 201, { order, razorpay: { keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder', orderId: order.razorpayOrderId, amount: price * 100, currency: 'INR', name: 'QR Photo Album', description: `${PLANS[planId].name} Plan - ${billingCycle}` } });
        }
        if (action === 'verify-payment') {
          const { orderId, paymentId } = body;
          if (!orderId || !paymentId) return sendJson(res, 400, { error: 'Missing payment details' });
          const order = await redis.getJSON(`order:${orderId}`);
          if (!order || order.userId !== s.u) return sendJson(res, 404, { error: 'Order not found' });
          order.status = 'paid'; order.paymentId = paymentId; order.paidAt = new Date().toISOString();
          await redis.setJSON(`order:${orderId}`, order);
          const subscription = { plan: order.planId, status: 'active', billingCycle: order.billingCycle, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (order.billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString(), orderId };
          await redis.setJSON(`user:subscription:${s.u}`, subscription);
          const payment = { id: crypto.randomUUID(), orderId, userId: s.u, amount: order.amount, currency: order.currency, status: 'success', planId: order.planId, createdAt: new Date().toISOString() };
          await redis.setJSON(`payment:${payment.id}`, payment);
          return sendJson(res, 200, { success: true, subscription, payment });
        }
        if (action === 'get-orders') {
          const orderIds = await redis.getJSON(`user:orders:${s.u}`) || [];
          const orders = [];
          for (const id of orderIds) { const order = await redis.getJSON(`order:${id}`); if (order) orders.push(order); }
          return sendJson(res, 200, { orders });
        }
        if (action === 'cancel-subscription') {
          const sub = await redis.getJSON(`user:subscription:${s.u}`);
          if (!sub) return sendJson(res, 404, { error: 'No subscription found' });
          sub.status = 'cancelled'; sub.cancelledAt = new Date().toISOString();
          await redis.setJSON(`user:subscription:${s.u}`, sub);
          return sendJson(res, 200, { success: true, subscription: sub });
        }
        if (action === 'check-limits') {
          const sub = await redis.getJSON(`user:subscription:${s.u}`) || { plan: 'free' };
          const limits = getPlanLimits(sub.plan);
          const { checkAction, currentCount } = body;
          let allowed = true, reason = '';
          if (checkAction === 'create-album' && currentCount >= limits.maxAlbums) { allowed = false; reason = `Album limit reached (${limits.maxAlbums})`; }
          else if (checkAction === 'add-photos' && currentCount >= limits.maxPhotos) { allowed = false; reason = `Photo limit reached (${limits.maxPhotos})`; }
          else if (checkAction === 'add-video') { if (limits.maxVideos === 0) { allowed = false; reason = 'Video uploads require Pro plan or higher'; } else if (currentCount >= limits.maxVideos) { allowed = false; reason = `Video limit reached (${limits.maxVideos})`; } }
          return sendJson(res, 200, { allowed, reason, plan: sub.plan, limits });
        }
        return sendJson(res, 400, { error: 'Unknown business action' });
      }

      // ===== AI =====
      case 'ai': {
        if (!s) return sendJson(res, 401, { error: 'Unauthorized' });
        if (action === 'classify-photo') {
          const { photoUrl } = body;
          if (!photoUrl) return sendJson(res, 400, { error: 'Photo URL required' });
          const result = await callOpenAI(`Analyze this photo and suggest a decorative frame style. Choose from: wedding, romantic, travel, celebration, family, minimal, nature. Respond in JSON: {"frameStyle": "...", "theme": "...", "confidence": 0.0-1.0}`, { maxTokens: 100 });
          if (result.error) return sendJson(res, 200, { classification: { frameStyle: 'automatic', theme: 'minimal', confidence: 0.5 }, note: result.error });
          try { return sendJson(res, 200, { classification: JSON.parse(result.result) }); } catch (e) { return sendJson(res, 200, { classification: { frameStyle: 'automatic', theme: 'minimal', confidence: 0.5 } }); }
        }
        if (action === 'generate-caption') {
          if (!(await hasAIAccess(s.u))) return sendJson(res, 403, { error: 'AI features require Premium plan' });
          const { photoUrl, context } = body;
          if (!photoUrl) return sendJson(res, 400, { error: 'Photo URL required' });
          const result = await callOpenAI(`Generate a short, warm caption (1-2 sentences) for a photo. Context: ${context || 'a personal memory'}. Be respectful. Respond with just the caption text.`, { maxTokens: 100, temperature: 0.8 });
          if (result.error) return sendJson(res, 200, { caption: '', note: result.error });
          const captionsKey = `album:${albumId}:ai:captions`;
          const captions = await redis.getJSON(captionsKey) || {};
          captions[photoUrl] = { text: result.result, generatedAt: new Date().toISOString(), edited: false };
          await redis.setJSON(captionsKey, captions);
          return sendJson(res, 200, { caption: result.result });
        }
        if (action === 'update-caption') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const { photoUrl, caption } = body;
          if (!photoUrl) return sendJson(res, 400, { error: 'Photo URL required' });
          const captionsKey = `album:${albumId}:ai:captions`;
          const captions = await redis.getJSON(captionsKey) || {};
          captions[photoUrl] = captions[photoUrl] || { generatedAt: new Date().toISOString() };
          captions[photoUrl].text = caption; captions[photoUrl].edited = true; captions[photoUrl].editedAt = new Date().toISOString();
          await redis.setJSON(captionsKey, captions);
          return sendJson(res, 200, { success: true });
        }
        if (action === 'delete-caption') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const captionsKey = `album:${albumId}:ai:captions`;
          const captions = await redis.getJSON(captionsKey) || {};
          delete captions[body.photoUrl];
          await redis.setJSON(captionsKey, captions);
          return sendJson(res, 200, { success: true });
        }
        if (action === 'get-captions') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const captions = await redis.getJSON(`album:${albumId}:ai:captions`) || {};
          return sendJson(res, 200, { captions });
        }
        if (action === 'analyze-quality') {
          if (!(await hasAIAccess(s.u))) return sendJson(res, 403, { error: 'AI features require Premium plan' });
          const { photoUrl } = body;
          if (!photoUrl) return sendJson(res, 400, { error: 'Photo URL required' });
          const analysis = { brightness: 'good', contrast: 'good', sharpness: 'good', colorBalance: 'good', suggestions: [], score: 85 };
          const enhKey = `album:${albumId}:ai:enhancements`;
          const enhancements = await redis.getJSON(enhKey) || {};
          enhancements[photoUrl] = { analysis, analyzedAt: new Date().toISOString() };
          await redis.setJSON(enhKey, enhancements);
          return sendJson(res, 200, { analysis });
        }
        if (action === 'get-enhancements') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const enhancements = await redis.getJSON(`album:${albumId}:ai:enhancements`) || {};
          return sendJson(res, 200, { enhancements });
        }
        if (action === 'create-face-group') {
          if (!(await hasAIAccess(s.u))) return sendJson(res, 403, { error: 'AI features require Premium plan' });
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const { name, photoUrls } = body;
          const groupsKey = `album:${albumId}:ai:facegroups`;
          const groups = await redis.getJSON(groupsKey) || { groups: [] };
          const group = { id: crypto.randomUUID(), name: name || 'Unnamed Group', photoUrls: Array.isArray(photoUrls) ? photoUrls : [], createdAt: new Date().toISOString() };
          groups.groups.push(group);
          await redis.setJSON(groupsKey, groups);
          return sendJson(res, 201, { success: true, group });
        }
        if (action === 'update-face-group') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const { groupId, name, photoUrls, mergeWith } = body;
          const groupsKey = `album:${albumId}:ai:facegroups`;
          const groups = await redis.getJSON(groupsKey) || { groups: [] };
          const idx = groups.groups.findIndex(g => g.id === groupId);
          if (idx === -1) return sendJson(res, 404, { error: 'Group not found' });
          if (name !== undefined) groups.groups[idx].name = name;
          if (photoUrls !== undefined) groups.groups[idx].photoUrls = photoUrls;
          if (mergeWith) {
            const mergeIdx = groups.groups.findIndex(g => g.id === mergeWith);
            if (mergeIdx !== -1 && mergeIdx !== idx) {
              groups.groups[idx].photoUrls = [...new Set([...groups.groups[idx].photoUrls, ...groups.groups[mergeIdx].photoUrls])];
              groups.groups.splice(mergeIdx, 1);
            }
          }
          await redis.setJSON(groupsKey, groups);
          return sendJson(res, 200, { success: true });
        }
        if (action === 'delete-face-group') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const groupsKey = `album:${albumId}:ai:facegroups`;
          const groups = await redis.getJSON(groupsKey) || { groups: [] };
          groups.groups = groups.groups.filter(g => g.id !== body.groupId);
          await redis.setJSON(groupsKey, groups);
          return sendJson(res, 200, { success: true });
        }
        if (action === 'get-face-groups') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const groups = await redis.getJSON(`album:${albumId}:ai:facegroups`) || { groups: [] };
          return sendJson(res, 200, { groups: groups.groups });
        }
        if (action === 'create-highlight') {
          if (!(await hasAIAccess(s.u))) return sendJson(res, 403, { error: 'AI features require Premium plan' });
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const { photoUrls, title, musicUrl, template, eventDate } = body;
          if (!Array.isArray(photoUrls) || photoUrls.length === 0) return sendJson(res, 400, { error: 'At least one photo required' });
          const highlightId = crypto.randomUUID();
          const highlight = { id: highlightId, albumId, title: title || 'Memory Highlight', photoUrls: photoUrls.slice(0, 50), musicUrl: musicUrl || '', template: template || 'classic', eventDate: eventDate || '', status: 'ready', progress: 100, createdAt: new Date().toISOString(), videoUrl: null, note: 'Video generation requires server-side processing. Configure a video processing service.' };
          await redis.setJSON(`album:${albumId}:ai:highlight:${highlightId}`, highlight);
          const highlightsKey = `album:${albumId}:ai:highlights`;
          const highlights = await redis.getJSON(highlightsKey) || [];
          highlights.push(highlightId);
          await redis.setJSON(highlightsKey, highlights);
          return sendJson(res, 201, { success: true, highlight });
        }
        if (action === 'get-highlights') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const highlightIds = await redis.getJSON(`album:${albumId}:ai:highlights`) || [];
          const highlights = [];
          for (const id of highlightIds) { const h = await redis.getJSON(`album:${albumId}:ai:highlight:${id}`); if (h) highlights.push(h); }
          return sendJson(res, 200, { highlights });
        }
        if (action === 'delete-highlight') {
          if (!albumId) return sendJson(res, 400, { error: 'Album ID required' });
          const highlightKey = `album:${albumId}:ai:highlight:${body.highlightId}`;
          await redis.pipeline([['del', highlightKey]]);
          const highlightsKey = `album:${albumId}:ai:highlights`;
          const highlights = await redis.getJSON(highlightsKey) || [];
          await redis.setJSON(highlightsKey, highlights.filter(id => id !== body.highlightId));
          return sendJson(res, 200, { success: true });
        }
        if (action === 'suggest-events') {
          if (!(await hasAIAccess(s.u))) return sendJson(res, 403, { error: 'AI features require Premium plan' });
          const { photoCount, context } = body;
          const result = await callOpenAI(`Suggest 3-5 event names for a photo album with ${photoCount || 'several'} photos. Context: ${context || 'personal memories'}. Respond as JSON array of strings.`, { maxTokens: 200, temperature: 0.7 });
          if (result.error) return sendJson(res, 200, { suggestions: ['Event 1', 'Event 2', 'Event 3'], note: result.error });
          try { const parsed = JSON.parse(result.result); return sendJson(res, 200, { suggestions: Array.isArray(parsed) ? parsed : ['Event 1', 'Event 2', 'Event 3'] }); } catch (e) { return sendJson(res, 200, { suggestions: ['Event 1', 'Event 2', 'Event 3'] }); }
        }
        return sendJson(res, 400, { error: 'Unknown AI action' });
      }

      default:
        return sendJson(res, 400, { error: 'Unknown category. Use: guestbook, likes, reactions, timeline, cover, privacy, theme, analytics, qr, business, ai' });
    }
  } catch (error) {
    console.error('Platform API error:', error && error.message ? error.message : 'unknown');
    try {
      if (!res.headersSent) sendJson(res, 500, { error: error && error.message ? error.message : 'Internal server error' });
    } catch (e) { res.end(); }
  }
};
