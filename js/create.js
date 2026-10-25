let photos = [];
let musicFile = null;
let musicUrl = null;
let uploadedPhotos = [];

const dropzone = document.getElementById('dropzone');
const photoInput = document.getElementById('photoInput');
const photoGrid = document.getElementById('photoGrid');
const addMorePhotos = document.getElementById('addMorePhotos');

dropzone.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', handlePhotoSelect);
addMorePhotos.addEventListener('click', () => photoInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = '#ff6b9d';
  dropzone.style.background = '#ffe4e9';
});
dropzone.addEventListener('dragleave', () => {
  dropzone.style.borderColor = '#ffb6c1';
  dropzone.style.background = '#fff5f8';
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = '#ffb6c1';
  dropzone.style.background = '#fff5f8';
  handleFiles(e.dataTransfer.files);
});

function handlePhotoSelect(e) {
  handleFiles(e.target.files);
}
function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      photos.push({ file, url: e.target.result, name: file.name });
      renderPhotos();
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotos() {
  photoGrid.innerHTML = '';
  photos.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'photo-item';
    div.innerHTML = `
      <img src="${p.url}" alt="${p.name}">
      <button class="photo-remove" onclick="removePhoto(${idx})">×</button>
      ${idx > 0 ? `<button class="photo-move left" onclick="movePhoto(${idx}, -1)">←</button>` : ''}
      ${idx < photos.length-1 ? `<button class="photo-move right" onclick="movePhoto(${idx}, 1)">→</button>` : ''}
    `;
    photoGrid.appendChild(div);
  });
}
window.removePhoto = (idx) => { photos.splice(idx, 1); renderPhotos(); };
window.movePhoto = (idx, dir) => {
  const tmp = photos[idx + dir];
  photos[idx + dir] = photos[idx];
  photos[idx] = tmp;
  renderPhotos();
};

// Step navigation
document.getElementById('toStep2').addEventListener('click', () => {
  if (photos.length === 0) return alert('Please upload at least one photo');
  document.getElementById('step1').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  document.querySelectorAll('.step').forEach((s,i) => s.classList.toggle('active', i <= 1));
});
document.getElementById('backToStep1').addEventListener('click', () => {
  document.getElementById('step2').style.display = 'none';
  document.getElementById('step1').style.display = 'block';
  document.querySelectorAll('.step').forEach((s,i) => s.classList.toggle('active', i <= 0));
});
document.getElementById('toStep3').addEventListener('click', () => {
  document.getElementById('step2').style.display = 'none';
  document.getElementById('step3').style.display = 'block';
  document.querySelectorAll('.step').forEach((s,i) => s.classList.toggle('active', i <= 2));
});
document.getElementById('backToStep2').addEventListener('click', () => {
  document.getElementById('step3').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  document.querySelectorAll('.step').forEach((s,i) => s.classList.toggle('active', i <= 1));
});
document.getElementById('toStep4').addEventListener('click', () => {
  document.getElementById('step3').style.display = 'none';
  document.getElementById('step4').style.display = 'block';
  document.querySelectorAll('.step').forEach((s,i) => s.classList.toggle('active', i <= 3));
  updateSummary();
});
document.getElementById('backToStep3').addEventListener('click', () => {
  document.getElementById('step4').style.display = 'none';
  document.getElementById('step3').style.display = 'block';
  document.querySelectorAll('.step').forEach((s,i) => s.classList.toggle('active', i <= 2));
});

// Music
const musicInput = document.getElementById('musicInput');
const uploadMusicBtn = document.getElementById('uploadMusicBtn');
const removeMusic = document.getElementById('removeMusic');
const musicPlayer = document.getElementById('musicPlayer');
const musicPreview = document.getElementById('musicPreview');
const musicName = document.getElementById('musicName');

uploadMusicBtn.addEventListener('click', () => musicInput.click());
musicInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.includes('mpeg') && !file.name.endsWith('.mp3')) return alert('Please upload MP3 files only');
  musicFile = file;
  musicUrl = URL.createObjectURL(file);
  musicPreview.src = musicUrl;
  musicName.textContent = file.name;
  musicPlayer.style.display = 'block';
  removeMusic.style.display = 'inline-block';
});
removeMusic.addEventListener('click', () => {
  musicFile = null;
  musicUrl = null;
  musicPreview.src = '';
  musicPlayer.style.display = 'none';
  removeMusic.style.display = 'none';
  musicInput.value = '';
});

function updateSummary() {
  document.getElementById('sumPhotos').textContent = photos.length;
  document.getElementById('sumMusic').textContent = musicFile ? musicFile.name : 'No music';
  const title = document.getElementById('albumTitle').value || 'Photo Album';
  const dur = document.getElementById('duration').value;
  const trans = document.getElementById('transition').value;
  document.getElementById('sumSettings').textContent = `"${title}" • ${dur}s • ${trans} transition`;
}

// Generate
document.getElementById('generateBtn').addEventListener('click', generateAlbum);

async function generateAlbum() {
  if (photos.length === 0) return alert('No photos');
  const btn = document.getElementById('generateBtn');
  const status = document.getElementById('generateStatus');
  btn.disabled = true;
  btn.textContent = '⏳ Creating Album...';
  status.textContent = 'Uploading photos and music...';

  try {
    // Upload all photos
    const formData = new FormData();
    photos.forEach((p, i) => {
      formData.append('photos', p.file);
    });
    if (musicFile) formData.append('music', musicFile);
    
    const uploadRes = await fetch('/api/album/upload', { method: 'POST', body: formData });
    const uploadData = await uploadRes.json();
    if (uploadData.error) throw new Error(uploadData.error);
    
    const photoUrls = (uploadData.uploads || []).filter(u => !u.error && u.url).map(u => u.url);
    let musicObj = null;
    if (musicFile && photoUrls.length > photos.length - 1) {
      // music might be last
      const musicUpload = uploadData.uploads.find(u => u.name === musicFile.name);
      if (musicUpload && musicUpload.url) musicObj = { src: musicUpload.url, title: musicFile.name };
    } else if (musicFile) {
      const musicUpload = uploadData.uploads.find(u => u.name === musicFile.name);
      if (musicUpload && musicUpload.url) musicObj = { src: musicUpload.url, title: musicFile.name };
    }
    
    status.textContent = 'Saving album...';
    const albumRes = await fetch('/api/album', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('albumTitle').value || 'Photo Album',
        photos: photoUrls,
        music: musicObj,
        settings: {
          duration: parseInt(document.getElementById('duration').value),
          transition: document.getElementById('transition').value,
          musicVolume: parseFloat(document.getElementById('musicVolume').value),
          openingMsg: document.getElementById('openingMsg').value,
          romanticTheme: document.getElementById('romanticTheme').checked
        }
      })
    });
    const albumData = await albumRes.json();
    if (albumData.error) throw new Error(albumData.error);
    
    status.textContent = 'Generating QR code...';
    const qrDataUrl = await QRCode.toDataURL(albumData.url, { width: 300, margin: 2 });
    document.getElementById('qrImg').src = qrDataUrl;
    document.getElementById('albumLink').value = albumData.url;
    document.getElementById('openAlbum').href = albumData.url;
    document.getElementById('result').style.display = 'block';
    
    document.getElementById('downloadQR').onclick = () => {
      const a = document.createElement('a');
      a.href = qrDataUrl;
      a.download = `album-${albumData.id}-qr.png`;
      a.click();
    };
    document.getElementById('copyLink').onclick = () => {
      navigator.clipboard.writeText(albumData.url);
      document.getElementById('copyLink').textContent = '✅ Copied!';
      setTimeout(() => document.getElementById('copyLink').textContent = '📋 Copy Link', 2000);
    };
    document.getElementById('createAnother').onclick = () => location.reload();
    
    btn.textContent = '✅ Done!';
    status.textContent = '';
  } catch (e) {
    alert('Error: ' + e.message);
    btn.disabled = false;
    btn.textContent = '🎉 GENERATE MY ALBUM & QR CODE';
    status.textContent = '';
  }
}