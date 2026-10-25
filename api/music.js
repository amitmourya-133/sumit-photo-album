const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const MUSIC_DIR = path.join(ROOT, '..', 'music');
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

    if (pathname === '/api/music') {
      const action = req.query.action || 'load';

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
              if (data.tracks && data.tracks[active]) {
                data.tracks[active].startTime = startTime;
              }
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