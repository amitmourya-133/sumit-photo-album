const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const PHOTOS_DIR = path.join(ROOT, '..', 'photos');
const MUSIC_DIR = path.join(ROOT, '..', 'music');
const PHOTOS_MANIFEST = path.join(ROOT, '..', 'photos.json');
const MUSIC_MANIFEST = path.join(ROOT, '..', 'music.json');

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

function readJson(file, fallback) {
  try {
    const data = fs.readFileSync(file, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return fallback;
  }
}

async function api(req, res) {
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

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/api/photos') {
      const action = req.query.action || 'load';
      
      if (action === 'load') {
        const data = readJson(PHOTOS_MANIFEST, { photos: [], active: 0 });
        sendJson(res, 200, { photos: data.photos || [], active: data.active || 0 });
      } else if (action === 'upload') {
        // Handle photo upload - simplified for Vercel
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const { photos } = parsed;
            if (!Array.isArray(photos)) {
              sendJson(res, 400, { error: 'No photos provided.' });
              return;
            }
            const existing = readJson(PHOTOS_MANIFEST, { photos: [], active: 0 });
            const newPhotos = [...(existing.photos || []), ...photos];
            // Write updated manifest
            fs.writeFileSync(PHOTOS_MANIFEST, JSON.stringify({ photos: newPhotos, active: existing.active || 0 }));
            sendJson(res, 200, { photos: newPhotos, active: existing.active || 0 });
          } catch (e) {
            sendJson(res, 500, { error: e.message });
          }
        });
        return;
      } else if (action === 'delete') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { photo } = JSON.parse(body || '{}');
            if (!photo) {
              sendJson(res, 400, { error: 'No photo path provided.' });
              return;
            }
            const existing = readJson(PHOTOS_MANIFEST, { photos: [], active: 0 });
            const filtered = existing.photos.filter(p => p !== photo);
            fs.writeFileSync(PHOTOS_MANIFEST, JSON.stringify({ photos: filtered, active: existing.active >= filtered.length ? filtered.length - 1 : existing.active }));
            sendJson(res, 200, { photos: filtered, active: Math.min(existing.active, filtered.length - 1) });
          } catch (e) {
            sendJson(res, 500, { error: e.message });
          }
        });
        return;
      } else if (action === 'reorder') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { order } = JSON.parse(body || '{}');
            if (!Array.isArray(order)) {
              sendJson(res, 400, { error: 'No order provided.' });
              return;
            }
            const existing = readJson(PHOTOS_MANIFEST, { photos: [], active: 0 });
            const reordered = order.map(src => existing.photos.find(p => p === src)).filter(p => p);
            fs.writeFileSync(PHOTOS_MANIFEST, JSON.stringify({ photos: reordered, active: existing.active }));
            sendJson(res, 200, { photos: reordered, active: existing.active });
          } catch (e) {
            sendJson(res, 500, { error: e.message });
          }
        });
        return;
      }

      const data = readJson(PHOTOS_MANIFEST, { photos: [], active: 0 });
      sendJson(res, 200, { photos: data.photos || [], active: data.active || 0 });
      return;
    }

    if (pathname === '/api/music') {
      const action = req.query.action;

      if (action === 'load') {
        const data = readJson(MUSIC_MANIFEST, { active: 0, tracks: [] });
        sendJson(res, 200, { tracks: data.tracks || [], active: data.active || 0 });
      } else if (action === 'active') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { index, startTime } = JSON.parse(body || '{}');
            const data = readJson(MUSIC_MANIFEST, { active: 0, tracks: [] });
            let active = index !== undefined ? Number(index) : data.active || 0;
            if (startTime !== undefined) {
              data.tracks[active].startTime = startTime;
            }
            if (active < 0 || active >= (data.tracks || []).length) {
              active = 0;
            }
            data.active = active;
            fs.writeFileSync(MUSIC_MANIFEST, JSON.stringify(data));
            sendJson(res, 200, { active, tracks: data.tracks });
          } catch (e) {
            sendJson(res, 500, { error: e.message });
          }
        });
        return;
      }

      const data = readJson(MUSIC_MANIFEST, { active: 0, tracks: [] });
      sendJson(res, 200, { tracks: data.tracks || [], active: data.active || 0 });
      return;
    }

    if (pathname === '/api/health') {
      // Check authorization
      const adminKey = process.env.ADMIN_API_KEY;
      const authHeader = req.headers['x-admin-token'];
      const isAuthorized = adminKey && authHeader && authHeader === adminKey;
      sendJson(res, 200, { ok: isAuthorized });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('API error:', e && e.message ? e.message : 'unknown');
    sendJson(res, 500, { error: e && e.message ? e.message : 'Internal server error' });
  }
}

module.exports = api;