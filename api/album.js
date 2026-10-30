const redis = require('../lib/redis-rest');
const crypto = require('crypto');
const session = require('../lib/session');

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

function isHttpUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
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
      const s = await session.requireAuthAsync(req, res);
      if (!s) return; // Already sent 401

      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        sendJson(res, 400, { error: e.message });
        return;
      }
      if (!body) {
        sendJson(res, 400, { error: 'Empty body' });
        return;
      }
      const { title, photos, music, settings } = body || {};
      if (!Array.isArray(photos) || photos.length === 0) {
        sendJson(res, 400, { error: 'At least one photo URL is required.' });
        return;
      }
      if (photos.length > MAX_PHOTOS) {
        sendJson(res, 400, { error: 'Album supports up to ' + MAX_PHOTOS + ' photos.' });
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
          ownerId: s.u,
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
          ownerId: s.u,
          music: music || null,
          settings: settingsSafe,
          createdAt: new Date().toISOString()
        };
        await redis.setJSON(`album:${id}`, album);
      }

      // Associate album with user's album list
      try {
        const userAlbumsKey = `user:albums:${s.u}`;
        const existing = await redis.getJSON(userAlbumsKey) || [];
        existing.push(id);
        await redis.setJSON(userAlbumsKey, existing);
      } catch (e) {
        // Best effort
      }

      const url = `https://${req.headers.host || 'sumit-photo-album.vercel.app'}/album/${id}`;
      sendJson(res, 200, { id, url, qr: url });
      return;
    }

    if (req.method === 'GET') {
      // Always require authentication for album access
      const s = await session.requireAuthAsync(req, res);
      if (!s) return; // Already sent 401

      if (!req.query || !req.query.id) {
        sendJson(res, 200, { ok: true });
        return;
      }
      const id = req.query.id;
      // First, try to get the full album object (non-chunked)
      const album = await redis.getJSON(`album:${id}`);
      if (album && album.photos && !album.chunked) {
        // Non-chunked album: verify ownership before serving
        const isOwned = album.ownerId === s.u;
        const isPublic = !album.ownerId;
        const isAdmin = s.r === 'admin';
        if (!isOwned && !isPublic && !isAdmin) {
          sendJson(res, 403, { error: 'Access denied. This album is private.' });
          return;
        }
        sendJson(res, 200, {
          id: album.id,
          title: album.title,
          photos: album.photos,
          music: album.music,
          settings: album.settings,
          createdAt: album.createdAt
        });
        return;
      }
      // Chunked or meta-based album: get metadata and verify ownership
      const meta = (await redis.getJSON(`album:${id}:meta`)) || album;
      if (!meta || !meta.id) {
        sendJson(res, 404, { error: 'Album not found' });
        return;
      }
      // Verify ownership: user must own the album or it must be public (no owner)
      const isOwned = meta.ownerId === s.u;
      const isPublic = !meta.ownerId;
      const isAdmin = s.r === 'admin';
      if (!isOwned && !isPublic && !isAdmin) {
        sendJson(res, 403, { error: 'Access denied. This album is private.' });
        return;
      }
      const chunksCount = meta.chunkCount || 0;
      let photos = [];
      if (chunksCount > 0) {
        const commands = [];
        for (let c = 0; c < chunksCount; c++) commands.push(['get', `album:${id}:chunk:${c}`]);
        const results = await redis.pipeline(commands);
        for (const raw of results) {
          if (typeof raw === 'string') {
            try {
              const chunk = JSON.parse(raw);
              if (Array.isArray(chunk)) photos = photos.concat(chunk);
            } catch (e) {
              // ignore malformed chunk
            }
          }
        }
      }
      if (!photos.length) photos = meta.photos || [];
      sendJson(res, 200, {
        id: meta.id,
        title: meta.title,
        photos,
        music: meta.music,
        settings: meta.settings,
        createdAt: meta.createdAt
      });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
  } catch (error) {
    try {
      if (!res.headersSent) sendJson(res, 500, { error: error && error.message ? error.message : 'Failed to process album' });
      else res.end();
    } catch (e) {
      res.end();
    }
  }
};