const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const busboy = require('busboy');

sharp.cache(false);

const ROOT = __dirname;
const PHOTOS_DIR = path.join(ROOT, 'photos');
const RAW_DIR = path.join(ROOT, 'raw-photos');
const MUSIC_DIR = path.join(ROOT, 'music');
const PHOTOS_MANIFEST = path.join(ROOT, 'photos.json');
const MUSIC_MANIFEST = path.join(ROOT, 'music.json');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 80;
const IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

for (const dir of [PHOTOS_DIR, RAW_DIR, MUSIC_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

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
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function sanitizeBase(name) {
  const base = path.basename(String(name || 'photo'), path.extname(String(name || '')));
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  return cleaned || 'photo';
}

function uniqueName(dir, base, ext) {
  let candidate = base + ext;
  let i = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${i}${ext}`;
    i += 1;
  }
  return candidate;
}

function normalizePhotoList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => typeof p === 'string' && p.startsWith('/photos/'))
    .map((p) => '/photos/' + path.basename(p));
}

function getPhotos() {
  const data = readJson(PHOTOS_MANIFEST, { photos: [] });
  return normalizePhotoList(data.photos);
}

function savePhotos(photos) {
  writeJson(PHOTOS_MANIFEST, {
    total: photos.length,
    photos,
    generatedAt: new Date().toISOString()
  });
}

function existingPhotos(photos) {
  return photos.filter((p) => fs.existsSync(path.join(PHOTOS_DIR, path.basename(p))));
}

function getMusic() {
  const data = readJson(MUSIC_MANIFEST, { active: 0, tracks: [] });
  const tracks = Array.isArray(data.tracks)
    ? data.tracks
        .filter((t) => t && typeof t.src === 'string' && t.src.startsWith('/music/'))
        .map((t) => ({
          title: typeof t.title === 'string' && t.title.trim() ? t.title.trim() : path.basename(t.src, path.extname(t.src)),
          src: '/music/' + path.basename(t.src),
          startTime: typeof t.startTime === 'number' ? t.startTime : 0
        }))
    : [];
  let active = Number.isInteger(data.active) ? data.active : 0;
  if (active < 0 || active >= tracks.length) active = 0;
  return { active, tracks };
}

function saveMusic(music) {
  writeJson(MUSIC_MANIFEST, {
    active: music.active,
    tracks: music.tracks
  });
}

function syncMusic() {
  const music = getMusic();
  const filtered = music.tracks.filter((t) => fs.existsSync(path.join(MUSIC_DIR, path.basename(t.src))));
  if (filtered.length !== music.tracks.length) {
    const activeSrc = music.tracks[music.active] ? music.tracks[music.active].src : null;
    music.tracks = filtered;
    music.active = Math.max(0, filtered.findIndex((t) => t.src === activeSrc));
    if (music.active < 0) music.active = 0;
    saveMusic(music);
  }
  return music;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit = 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw new Error('Invalid JSON body');
  }
}

function parseMultipart(req, maxFileBytes) {
  return new Promise((resolve, reject) => {
    let busboyInstance;
    try {
      busboyInstance = busboy({
        headers: req.headers,
        limits: { fileSize: maxFileBytes, files: MAX_FILES, fields: 20 }
      });
    } catch (e) {
      reject(new Error('Expected multipart/form-data'));
      return;
    }
    const files = [];
    let failed = null;
    busboyInstance.on('file', (field, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('error', (e) => {
        failed = e;
      });
      stream.on('end', () => {
        files.push({
          field,
          filename: info.filename || '',
          mime: info.mimeType || '',
          buffer: Buffer.concat(chunks),
          truncated
        });
      });
    });
    busboyInstance.on('error', (e) => reject(e));
    busboyInstance.on('close', () => {
      if (failed) reject(failed);
      else resolve(files);
    });
    req.pipe(busboyInstance);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeUnlink(file) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.promises.unlink(file);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      const retryable = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
      if (!retryable || attempt === 5) throw e;
      await sleep(120);
    }
  }
  return false;
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isAuthorized(req) {
  // Allow loopback (local dev)
  if (isLoopback(req)) return true;
  // Allow production with secret token from env var
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;
  const token = req.headers['x-admin-token'];
  return token && token === adminKey;
}

function looksLikeMp3(buffer) {
  if (!buffer || buffer.length < 4) return false;
  if (buffer.slice(0, 3).toString('latin1') === 'ID3') return true;
  const max = Math.min(buffer.length - 1, 4096);
  for (let i = 0; i < max; i += 1) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
}

function looksLikeM4a(buffer) {
  return Boolean(buffer && buffer.length > 12 && buffer.slice(4, 8).toString('latin1') === 'ftyp');
}

async function uploadPhotos(req, res) {
  const files = await parseMultipart(req, MAX_IMAGE_BYTES);
  const uploads = files.filter((f) => f.filename && f.buffer.length);
  if (!uploads.length) {
    sendJson(res, 400, { error: 'No image files were received.' });
    return;
  }
  const photos = getPhotos();
  const added = [];
  const errors = [];
  for (const f of uploads) {
    if (f.truncated) {
      errors.push(`${f.filename}: larger than 30 MB`);
      continue;
    }
    try {
      const meta = await sharp(f.buffer, { failOn: 'error' }).metadata();
      if (!meta.format || !IMAGE_FORMATS.includes(meta.format)) {
        throw new Error(`unsupported image format (${meta.format || 'unknown'})`);
      }
      const base = sanitizeBase(f.filename);
      const outName = uniqueName(PHOTOS_DIR, base, '.webp');
      await sharp(f.buffer, { failOn: 'error' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toFile(path.join(PHOTOS_DIR, outName));
      const rawExt = meta.format === 'jpeg' ? '.jpg' : '.' + meta.format;
      const rawName = uniqueName(RAW_DIR, base, rawExt);
      fs.writeFileSync(path.join(RAW_DIR, rawName), f.buffer);
      const src = '/photos/' + outName;
      photos.push(src);
      added.push(src);
    } catch (e) {
      errors.push(`${f.filename}: ${e.message}`);
    }
  }
  savePhotos(photos);
  sendJson(res, added.length ? 200 : 400, {
    added,
    errors,
    total: photos.length,
    message: added.length
      ? `${added.length} photo(s) optimized and added.`
      : 'No photos were added.'
  });
}

async function deletePhoto(req, res, body) {
  const photo = typeof body.photo === 'string' ? body.photo : '';
  const name = path.basename(photo);
  if (!name || !/\.(webp|jpg|jpeg|png|gif|avif|tiff|heif)$/i.test(name)) {
    sendJson(res, 400, { error: 'A valid photo filename is required.' });
    return;
  }
  const photos = getPhotos();
  const src = '/photos/' + name;
  if (!photos.includes(src)) {
    sendJson(res, 404, { error: 'Photo is not in the album.' });
    return;
  }
  const remaining = photos.filter((p) => p !== src);
  await safeUnlink(path.join(PHOTOS_DIR, name));
  const base = path.basename(name, path.extname(name));
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tiff', '.heif']) {
    const raw = path.join(RAW_DIR, base + ext);
    if (fs.existsSync(raw)) {
      try {
        await safeUnlink(raw);
      } catch (e) {
        /* ignore */
      }
    }
  }
  savePhotos(remaining);
  sendJson(res, 200, { removed: src, total: remaining.length });
}

function reorderPhotos(req, res, body) {
  const order = Array.isArray(body.order) ? body.order.map((p) => String(p)) : null;
  if (!order) {
    sendJson(res, 400, { error: 'order must be an array of photo paths.' });
    return;
  }
  const photos = getPhotos();
  if (order.length !== photos.length) {
    sendJson(res, 400, { error: 'order must contain every photo exactly once.' });
    return;
  }
  const current = new Set(photos);
  const next = new Set(order);
  if (next.size !== order.length || order.some((p) => !current.has(p))) {
    sendJson(res, 400, { error: 'order must be a permutation of the current album.' });
    return;
  }
  savePhotos(order);
  sendJson(res, 200, { photos: order, total: order.length });
}

async function uploadMusic(req, res) {
  const files = await parseMultipart(req, MAX_AUDIO_BYTES);
  const uploads = files.filter((f) => f.filename && f.buffer.length);
  if (!uploads.length) {
    sendJson(res, 400, { error: 'No audio files were received.' });
    return;
  }
  const music = getMusic();
  const added = [];
  const errors = [];
  for (const f of uploads) {
    if (f.truncated) {
      errors.push(`${f.filename}: larger than 40 MB`);
      continue;
    }
    const ext = path.extname(f.filename).toLowerCase();
    const isMp3 = ext === '.mp3' && looksLikeMp3(f.buffer);
    const isM4a = ext === '.m4a' && looksLikeM4a(f.buffer);
    if (!isMp3 && !isM4a) {
      errors.push(`${f.filename}: not a valid MP3/M4A audio file`);
      continue;
    }
    const base = sanitizeBase(f.filename);
    const outExt = isMp3 ? '.mp3' : '.m4a';
    const outName = uniqueName(MUSIC_DIR, base, outExt);
    fs.writeFileSync(path.join(MUSIC_DIR, outName), f.buffer);
    const title = path.basename(f.filename, path.extname(f.filename)).replace(/[_]+/g, ' ').trim() || base;
    // Get startTime from form data, default to 0
    const startTime = Number(req.body.startTime) || 0;
    music.tracks.push({ title, src: '/music/' + outName, startTime });
    added.push({ title, src: '/music/' + outName, startTime });
  }
  if (added.length) {
    if (!Number.isInteger(music.active) || music.active < 0 || music.active >= music.tracks.length) {
      music.active = 0;
    }
    saveMusic(music);
  }
  sendJson(res, added.length ? 200 : 400, {
    added,
    errors,
    tracks: music.tracks,
    active: music.active,
    message: added.length ? `${added.length} track(s) uploaded.` : 'No tracks were uploaded.'
  });
}

function setActiveTrack(req, res, body) {
  const music = getMusic();
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || index >= music.tracks.length) {
    sendJson(res, 400, { error: 'A valid track index is required.' });
    return;
  }
  music.active = index;
  // Update startTime if provided
  if (body.startTime !== undefined) {
    music.tracks[index].startTime = body.startTime;
  }
  saveMusic(music);
  sendJson(res, 200, { active: music.active, tracks: music.tracks });
}

async function deleteTrack(req, res, body) {
  const src = typeof body.src === 'string' ? '/music/' + path.basename(body.src) : '';
  const music = getMusic();
  const index = music.tracks.findIndex((t) => t.src === src);
  if (index === -1) {
    sendJson(res, 404, { error: 'Track not found.' });
    return;
  }
  music.tracks.splice(index, 1);
  if (music.active >= music.tracks.length) music.active = Math.max(0, music.tracks.length - 1);
  await safeUnlink(path.join(MUSIC_DIR, path.basename(src)));
  saveMusic(music);
  sendJson(res, 200, { active: music.active, tracks: music.tracks });
}

async function handleApi(req, res, pathname) {
  const method = req.method || 'GET';
  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      local: true,
      photos: existingPhotos(getPhotos()).length,
      tracks: getMusic().tracks.length
    });
    return;
  }
  if (pathname === '/api/photos' && method === 'GET') {
    const photos = existingPhotos(getPhotos());
    savePhotos(photos);
    sendJson(res, 200, { total: photos.length, photos, items: photos.map((src) => ({ src, name: path.basename(src) })) });
    return;
  }
  if (pathname === '/api/photos/upload' && method === 'POST') {
    await uploadPhotos(req, res);
    return;
  }
  if (pathname === '/api/photos/delete' && method === 'POST') {
    await deletePhoto(req, res, await readJsonBody(req));
    return;
  }
  if (pathname === '/api/photos/reorder' && method === 'POST') {
    reorderPhotos(req, res, await readJsonBody(req));
    return;
  }
  if (pathname === '/api/music' && method === 'GET') {
    const music = syncMusic();
    sendJson(res, 200, music);
    return;
  }
  if (pathname === '/api/music/upload' && method === 'POST') {
    await uploadMusic(req, res);
    return;
  }
  if (pathname === '/api/music/active' && method === 'POST') {
    setActiveTrack(req, res, await readJsonBody(req));
    return;
  }
  if (pathname === '/api/music/delete' && method === 'POST') {
    await deleteTrack(req, res, await readJsonBody(req));
    return;
  }
  sendJson(res, 404, { error: 'Unknown API route.' });
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }
  let filePath;
  try {
    filePath = path.normalize(path.join(ROOT, pathname));
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const isMedia = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.mp3', '.m4a'].includes(ext);
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': isMedia ? 'public, max-age=3600' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    };
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        res.end();
        return;
      }
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stats.size - 1;
      if (!match[1] && match[2]) {
        start = Math.max(0, stats.size - Number(match[2]));
        end = stats.size - 1;
      }
      if (start > end || start >= stats.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        res.end();
        return;
      }
      end = Math.min(end, stats.size - 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    headers['Content-Length'] = stats.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    const url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname.startsWith('/api/')) {
    if (!isAuthorized(req)) {
      sendJson(res, 403, { error: 'Management API access denied.' });
      return;
    }
    handleApi(req, res, pathname).catch((e) => {
      if (!res.headersSent) sendJson(res, 500, { error: e.message || 'Server error' });
      else res.end();
    });
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`QR Photo Album running at http://localhost:${PORT}`);
  console.log(`Album: http://localhost:${PORT}/`);
  console.log(`Manager: http://localhost:${PORT}/admin.html`);
  console.log('Press Ctrl+C to stop.');
});