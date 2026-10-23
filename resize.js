const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

sharp.cache(false);

const rawFolder = path.join(__dirname, 'raw-photos');
const photosFolder = path.join(__dirname, 'photos');
const manifestPath = path.join(__dirname, 'photos.json');

const supported = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tiff', '.tif', '.heic', '.heif'
]);

fs.mkdirSync(rawFolder, { recursive: true });
fs.mkdirSync(photosFolder, { recursive: true });

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function sanitizeBase(name) {
  const cleaned = path
    .basename(name, path.extname(name))
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  return cleaned || 'photo';
}

const files = fs
  .readdirSync(rawFolder)
  .filter((file) => {
    const full = path.join(rawFolder, file);
    try {
      return fs.statSync(full).isFile() && supported.has(path.extname(file).toLowerCase());
    } catch (e) {
      return false;
    }
  })
  .sort(naturalCompare);

console.log(`Found ${files.length} source image(s) in raw-photos/`);

const usedNames = new Map();
const processed = [];

async function processFile(file) {
  const inputPath = path.join(rawFolder, file);
  const base = sanitizeBase(file);
  const count = (usedNames.get(base) || 0) + 1;
  usedNames.set(base, count);
  const outputName = (count === 1 ? base : `${base}-${count}`) + '.webp';
  const outputPath = path.join(photosFolder, outputName);

  try {
    const info = await sharp(inputPath, { failOn: 'error' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toFile(outputPath);
    console.log(`OK  ${file} -> photos/${outputName} (${Math.round(info.size / 1024)} KB, ${info.width}x${info.height})`);
    processed.push(outputName);
  } catch (err) {
    console.error(`FAIL ${file}: ${err.message}`);
  }
}

async function run() {
  for (const file of files) {
    await processFile(file);
  }

  let existing = [];
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(data.photos)) existing = data.photos.map((p) => '/photos/' + path.basename(p));
  } catch (e) {
    existing = [];
  }

  const processedSet = new Set(processed);
  const kept = existing.filter((p) => processedSet.has(path.basename(p)));
  const keptSet = new Set(kept.map((p) => path.basename(p)));
  const appended = processed.filter((name) => !keptSet.has(name)).map((name) => '/photos/' + name);
  const photos = [...kept, ...appended];

  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ total: photos.length, photos, generatedAt: new Date().toISOString() }, null, 2) + '\n'
  );
  console.log(`\nphotos.json updated: ${photos.length} photo(s).`);
  if (!photos.length) {
    console.log('Add real photos to raw-photos/ or use the manager at http://localhost:3000/admin.html');
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});