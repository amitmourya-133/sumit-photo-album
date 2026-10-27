const redis = require('../lib/redis-rest');
const crypto = require('crypto');

const CHUNK_SIZE = 350;
const MAX_PHOTOS = 5000;

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

async function readJsonBody(req) {
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

function isHttpUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

const session = require('../lib/session');

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }
    if (!redis.isConfigured()) {
      sendJson(res, 503, { error: 'Missing KV_REST_API_URL or KV_REST_API_TOKEN. Connect Upstash Redis (Vercel KV) in Vercel Storage settings.' });
      return;
    }

    if (req.method === 'POST') {
      const s = await session.getSession(req);
      if (!s) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        sendJson(res, 400, { error: e.message });
        return;
      }
      const { title, photos, music, settings } = body || {};
      if (!Array.isArray(photos) || photos.length === 0) {
        sendJson(res, 400, { error: 'At least one photo URL is required.' });
        return;
      }
      if (photos.length > MAX_PHOTOS) {
        sendJson(res, 400, { error: `Album supports up to ${MAX_PHOTOS} photos.` });
        return;
      }
      if (!photos.every(isHttpUrl)) {
        sendJson(res, 400, { error: 'One or more photo URLs are invalid.' });
        return;
      }
      if (music && music.src && !isHttpUrl(music.src)) {
        sendJson(res, 400, { error: 'Invalid music URL.' });
        return;
      }
      const settingsSafe = { ...(settings || {}) };
      settingsSafe.duration = Math.max(3, Math.min(5, parseInt(settingsSafe.duration) || 3));
      settingsSafe.transition = typeof settingsSafe.transition === 'string' ? settingsSafe.transition.slice(0, 20) : 'fade';
      settingsSafe.musicVolume = Math.max(0, Math.min(1, Number(settingsSafe.musicVolume) || 0.7));
      settingsSafe.openingMsg = typeof settingsSafe.openingMsg === 'string' ? settingsSafe.openingMsg.slice(0, 200) : '';
      settingsSafe.romanticTheme = !!settingsSafe.romanticTheme;
      settingsSafe.autoTheme = settingsSafe.autoTheme !== false;
      const ALLOWED_FRAMES = ['automatic', 'wedding', 'romantic', 'travel', 'celebration', 'family', 'minimal'];
      settingsSafe.frameStyle = ALLOWED_FRAMES.indexOf(settingsSafe.frameStyle) !== -1 ? settingsSafe.frameStyle : 'automatic';
      settingsSafe.photoFit = 'contain';
      const titleSafe = (typeof title === 'string' ? title.trim() : '').slice(0, 120) || 'Photo Album';

      const id = crypto.randomUUID();
      if (photos.length > CHUNK_SIZE) {
        const chunks = [];
        for (let i = 0; i < photos.length; i += CHUNK_SIZE) chunks.push(photos.slice(i, i + CHUNK_SIZE));
        const meta = {
          id,
          title: titleSafe,
          photoCount: photos.length,
          chunked: true,
          chunkCount: chunks.length,
          music: music || null,
          settings: settingsSafe,
          createdAt: new Date().toISOString()
        };
        const commands = [['set', `album:${id}:meta`, JSON.stringify(meta)]];
        for (let c = 0; c < chunks.length; c++) {
          commands.push(['set', `album:${id}:chunk:${c}`, JSON.stringify(chunks[c])]);
        }
        await redis.pipeline(commands);
      } else {
        const album = {
          id,
          title: titleSafe,
          photos,
          music: music || null,
          settings: settingsSafe,
          createdAt: new Date().toISOString()
        };
        await redis.setJSON(`album:${id}`, album);
      }

      const url = `https://${req.headers.host || 'sumit-photo-album.vercel.app'}/album/${id}`;
      sendJson(res, 200, { id, url, qr: url });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
  } catch (error) {
    console.error('api/album failed:', error && error.message ? error.message : 'unknown');
    sendJson(res, 500, { error: error && error.message ? error.message : 'Failed to create album' });
  }
};
