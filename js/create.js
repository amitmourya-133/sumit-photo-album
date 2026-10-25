let photos = [];
let musicFile = null;

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
      ${idx < photos.length - 1 ? `<button class="photo-move right" onclick="movePhoto(${idx}, 1)">→</button>` : ''}
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

document.getElementById('toStep2').addEventListener('click', () => {
  if (photos.length === 0) return alert('Please upload at least one photo');
  document.getElementById('step1').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i <= 1));
});
document.getElementById('backToStep1').addEventListener('click', () => {
  document.getElementById('step2').style.display = 'none';
  document.getElementById('step1').style.display = 'block';
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i <= 0));
});
document.getElementById('toStep3').addEventListener('click', () => {
  document.getElementById('step2').style.display = 'none';
  document.getElementById('step3').style.display = 'block';
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i <= 2));
});
document.getElementById('backToStep2').addEventListener('click', () => {
  document.getElementById('step3').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i <= 1));
});
document.getElementById('toStep4').addEventListener('click', () => {
  document.getElementById('step3').style.display = 'none';
  document.getElementById('step4').style.display = 'block';
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i <= 3));
  updateSummary();
});
document.getElementById('backToStep3').addEventListener('click', () => {
  document.getElementById('step4').style.display = 'none';
  document.getElementById('step3').style.display = 'block';
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i <= 2));
});

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
  if (!file.type.includes('mpeg') && !file.name.toLowerCase().endsWith('.mp3')) {
    alert('Please upload MP3 files only');
    musicInput.value = '';
    return;
  }
  musicFile = file;
  musicPreview.src = URL.createObjectURL(file);
  musicName.textContent = file.name;
  musicPlayer.style.display = 'block';
  removeMusic.style.display = 'inline-block';
});
removeMusic.addEventListener('click', () => {
  musicFile = null;
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
  document.getElementById('sumSettings').textContent = '"' + title + '" • ' + dur + 's • ' + trans + ' transition';
}

document.getElementById('generateBtn').addEventListener('click', generateAlbum);

async function safeJson(res) {
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch (e) {
      return { ok: res.ok, status: res.status, data: { error: text.slice(0, 200) } };
    }
  }
  return { ok: res.ok, status: res.status, data: { error: text.slice(0, 200) || ('HTTP ' + res.status) } };
}

async function generateAlbum() {
  if (photos.length === 0) return alert('Please upload at least one photo');
  const btn = document.getElementById('generateBtn');
  const status = document.getElementById('generateStatus');
  btn.disabled = true;
  btn.textContent = '⏳ Creating Album...';
  status.textContent = 'Uploading photos and music...';

  try {
    const formData = new FormData();
    photos.forEach(p => formData.append('photos', p.file));
    if (musicFile) formData.append('music', musicFile);

    const uploadRes = await fetch('/api/album/upload', { method: 'POST', body: formData });
    const uploadResult = await safeJson(uploadRes);
    if (!uploadResult.ok || uploadResult.data.error) {
      throw new Error(uploadResult.data.error || ('Upload failed: ' + uploadResult.status));
    }

    const uploads = uploadResult.data.uploads || [];
    const failedUploads = uploads.filter(u => u && u.error);
    if (failedUploads.length > 0) {
      throw new Error('Some files failed to upload: ' + failedUploads.map(f => f.name + ' (' + f.error + ')').join(', '));
    }

    const photoUrls = uploads.filter(u => u && u.url && (!musicFile || u.name !== musicFile.name || u.type?.startsWith('image/'))).map(u => u.url);
    if (photoUrls.length !== photos.length) {
      const imageUploads = uploads.filter(u => u && u.url && u.type && u.type.startsWith('image/'));
      if (imageUploads.length === photos.length) {
        photoUrls.splice(0, photoUrls.length, ...imageUploads.map(u => u.url));
      } else {
        throw new Error('Not all photos uploaded successfully. Uploaded ' + imageUploads.length + ' of ' + photos.length);
      }
    }

    let musicObj = null;
    if (musicFile) {
      const musicUpload = uploads.find(u => u && u.url && u.name === musicFile.name && (!u.type || u.type.includes('audio') || u.name.toLowerCase().endsWith('.mp3')));
      if (!musicUpload || !musicUpload.url) {
        throw new Error('Music upload failed');
      }
      musicObj = { src: musicUpload.url, title: musicFile.name };
    }

    status.textContent = 'Saving album metadata...';
    const albumRes = await fetch('/api/album', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('albumTitle').value || 'Photo Album',
        photos: photoUrls,
        music: musicObj,
        settings: {
          duration: parseInt(document.getElementById('duration').value) || 5,
          transition: document.getElementById('transition').value,
          musicVolume: parseFloat(document.getElementById('musicVolume').value) || 0.7,
          openingMsg: document.getElementById('openingMsg').value,
          romanticTheme: document.getElementById('romanticTheme').checked
        }
      })
    });
    const albumResult = await safeJson(albumRes);
    if (!albumResult.ok || albumResult.data.error) {
      throw new Error(albumResult.data.error || ('Failed to create album: ' + albumResult.status));
    }

    status.textContent = 'Generating QR code...';
    const qrDataUrl = await QRCode.toDataURL(albumResult.data.url, { width: 300, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
    document.getElementById('qrImg').src = qrDataUrl;
    document.getElementById('albumLink').value = albumResult.data.url;
    document.getElementById('openAlbum').href = albumResult.data.url;
    document.getElementById('result').style.display = 'block';

    document.getElementById('downloadQR').onclick = () => {
      const a = document.createElement('a');
      a.href = qrDataUrl;
      a.download = 'album-qr.png';
      a.click();
    };
    document.getElementById('copyLink').onclick = () => {
      navigator.clipboard.writeText(albumResult.data.url).then(() => {
        const old = document.getElementById('copyLink').textContent;
        document.getElementById('copyLink').textContent = '✅ Copied!';
        setTimeout(() => document.getElementById('copyLink').textContent = old, 2000);
      });
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