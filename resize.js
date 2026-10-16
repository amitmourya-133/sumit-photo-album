const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const rawFolder = path.join(__dirname, 'raw-photos');
const photosFolder = path.join(__dirname, 'photos');

// Ensure output folder exists
fs.mkdirSync(photosFolder, { recursive: true });

// Get all image files from raw-photos
const supportedExt = ['.jpg', '.jpeg', '.png', '.webp', '. JPG'];
const files = fs.readdirSync(rawFolder).filter(f => {
  const ext = path.extname(f).toLowerCase();
  return supportedExt.includes(ext);
});

console.log(`Found ${files.length} images to process`);

const processed = [];

async function processFile(file) {
  const inputPath = path.join(rawFolder, file);
  const outputName = path.basename(file, path.extname(file)) + '.webp';
  const outputPath = path.join(photosFolder, outputName);

  try {
    await sharp(inputPath)
      .resize({
        width: 1400,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toFile(outputPath);

    console.log(`✅ ${file} → ${outputName}`);
    processed.push(outputName);
  } catch (err) {
    console.error(`❌ Error processing ${file}:`, err.message);
  }
}

// Process all files sequentially
const run = async () => {
  for (const file of files) {
    await processFile(file);
  }

  // Generate photos.json
  const photoPaths = processed.map(name => `/photos/${name}`);
  const photosJson = {
    total: photoPaths.length,
    photos: photoPaths,
    generatedAt: new Date().toISOString(),
  };

  const jsonPath = path.join(__dirname, 'photos.json');
  fs.writeFileSync(jsonPath, JSON.stringify(photosJson, null, 2));
  console.log(`\n📸 photos.json generated with ${photoPaths.length} entries at ${jsonPath}`);
};

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});