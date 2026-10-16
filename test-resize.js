const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const input = path.join(__dirname, 'raw-photos', 'test.jpg');
const output = path.join(__dirname, 'photos', 'test.webp');

if (!fs.existsSync(input)) {
  console.log('Creating test image...');
  fs.writeFileSync(input, Buffer.alloc(1024)); // dummy
}

sharp(input)
  .resize({ width: 1400, fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 80 })
  .toFile(output)
  .then(() => {
    console.log('✅ Resize done:', output);
    // Cleanup
    try { fs.unlinkSync(input); } catch {}
    try { fs.unlinkSync(output); } catch {}
  })
  .catch(e => console.error('❌ Error:', e.message));