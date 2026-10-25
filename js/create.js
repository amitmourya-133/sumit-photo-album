(function () {
  'use strict';

  let photos = [];
  let musicFile = null;
  let photoFiles = [];

  const dropzone = document.getElementById('dropzone');
  const photoInput = document.getElementById('photoInput');
  const folderInput = document.getElementById('folderInput');
  const photoGrid = document.getElementById('photoGrid');
  const addMorePhotos = document.getElementById('addMorePhotos');
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  const photoStats = document.getElementById('photoStats');
  const photoCountEl = document.getElementById('photoCount');
  const photoSizeEl = document.getElementById('photoSize');

  if (!globalThis.blobUploadUpload) {
    alert('Photo uploader failed to load. Please refresh the page.');
    return;
  }

  dropzone.addEventListener('click', (e) => {
    if (e.target.id === 'selectFolderBtn') return;
    photoInput.click();
  });
  photoInput.addEventListener('change', handlePhotoSelect);
  addMorePhotos.addEventListener('click', () => photoInput.click());
  selectFolderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    folderInput.click();
  });
  folderInput.addEventListener('change', handlePhotoSelect);

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
    handleFiles(e.dataTransfer ? e.dataTransfer.files : []);
  });

  function handlePhotoSelect(e) {
    handleFiles(e.target.files);
    e.target.value = '';
  }

  function handleFiles(files) {
    let added = 0;
    Array.from(files || []).forEach(file => {
      if (!file) return;
      if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(file.name)) {
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        console.warn('Skipping oversized file', file.name);
        return;
      }
      photoFiles.push(file);
      added++;
      if (photoFiles.length <= 200) {
        const reader = new FileReader();
        reader.onload = (e) => {
          photos.push({ url: e.target.result, name: file.name });
          renderPhotos();
        };
        reader.readAsDataURL(file);
      }
    });
    if (added) {
      renderPhotos();
      updateStats();
    }
  }

  function updateStats() {
    if (photoFiles.length === 0) {
      photoStats.style.display = 'none';
      return;
    }
    photoStats.style.display = 'block';
    photoCountEl.textContent = photoFiles.length;
    const totalBytes = photoFiles.reduce((sum, f) => sum + f.size, 0);
    photoSizeEl.textContent = (totalBytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderPhotos() {
    photoGrid.innerHTML = '';
    const showCount = Math.min(photos.length, 200);
    for (let idx = 0; idx < showCount; idx++) {
      const p = photos[idx];
      const div = document.createElement('div');
      div.className = 'photo-item';
      div.innerHTML = '<img src="' + p.url + '" alt="" loading="lazy"><button class="photo-remove" onclick="removePhoto(' + idx + ')">×</button>';
      photoGrid.appendChild(div);
    }
    const total = photoFiles.length;
    if (total > 200) {
      const more = document.createElement('div');
      more.style.cssText = 'grid-column:1/-1;text-align:center;padding:12px;color:#666';
      more.textContent = '+ ' + (total - 200) + ' more photos selected';
      photoGrid.appendChild(more);
    }
  }

  window.removePhoto = function (idx) {
    photoFiles.splice(idx, 1);
    photos.splice(Math.min(idx, photos.length), 1);
    renderPhotos();
    updateStats();
  };

  document.getElementById('toStep2').addEventListener('click', () => {
    if (photoFiles.length === 0) return alert('Please upload at least one photo');
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
    if (file.size > 60 * 1024 * 1024) return alert('Audio file too large (max 60MB)');
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
    document.getElementById('sumPhotos').textContent = photoFiles.length;
    document.getElementById('sumMusic').textContent = musicFile ? musicFile.name : 'No music';
    const title = document.getElementById('albumTitle').value || 'Photo Album';
    const dur = document.getElementById('duration').value;
    document.getElementById('sumSettings').textContent = '"' + title + '" • ' + dur + 's per photo';
  }

  document.getElementById('generateBtn').addEventListener('click', generateAlbum);

  async function uploadFile(file, pathname, attempts) {
    attempts = attempts || 3;
    for (let i = 0; i < attempts; i++) {
      try {
        const blob = await globalThis.blobUploadUpload(pathname, file, {
          access: 'public',
          handleUploadUrl: '/api/blob/token',
        });
        if (!blob || !blob.url) throw new Error('Upload returned no URL');
        return blob.url;
      } catch (e) {
        if (i === attempts - 1) {
          throw e;
        }
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }

  async function safeJson(res) {
    const raw = await res.text();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(raw.slice(0, 300) || ('HTTP ' + res.status));
    }
  }

  async function generateAlbum() {
    if (photoFiles.length === 0) return alert('Please upload at least one photo');
    const btn = document.getElementById('generateBtn');
    const status = document.getElementById('generateStatus');
    const progress = document.getElementById('uploadProgress');
    const progressText = document.getElementById('progressText');
    const progressPercent = document.getElementById('progressPercent');
    const progressBar = document.getElementById('progressBar');
    const progressDetails = document.getElementById('progressDetails');

    btn.disabled = true;
    btn.textContent = '⏳ Creating Album...';
    status.textContent = 'Starting uploads...';
    progress.style.display = 'block';

    try {
      const total = photoFiles.length;
      const photoUrls = new Array(total);
      const concurrency = 3;
      let completed = 0;
      let failed = 0;
      const failedNames = [];

      function updateProgress() {
        const pct = Math.min(60, Math.round((completed / total) * 60));
        progressBar.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
        progressText.textContent = 'Uploading photos...';
        progressDetails.textContent = completed + ' / ' + total + ' completed' + (failed ? ', ' + failed + ' failed' : '');
      }

      let cursor = 0;
      async function worker() {
        while (cursor < total) {
          const myIndex = cursor++;
          const file = photoFiles[myIndex];
          const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          try {
            const url = await uploadFile(file, 'albums/photos/' + Date.now() + '-' + myIndex + '-' + safe);
            photoUrls[myIndex] = url;
            completed++;
          } catch (e) {
            failed++;
            failedNames.push(file.name + ': ' + (e && e.message ? e.message : 'upload failed'));
          }
          updateProgress();
        }
      }
      await Promise.all([worker(), worker(), worker()]);

      if (failed === total) throw new Error('All photo uploads failed. ' + failedNames[0]);
      if (failed > 0) throw new Error(failed + ' photo(s) failed to upload. ' + failedNames.slice(0, 3).join(' | '));

      let musicObj = null;
      if (musicFile) {
        progressText.textContent = 'Uploading music...';
        progressBar.style.width = '75%';
        progressPercent.textContent = '75%';
        const mSafe = musicFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const mUrl = await uploadFile(musicFile, 'albums/music/' + Date.now() + '-' + mSafe, 3);
        musicObj = { src: mUrl, title: musicFile.name };
      }

      progressText.textContent = 'Saving album...';
      progressBar.style.width = '90%';
      progressPercent.textContent = '90%';

      const albumRes = await fetch('/api/album', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.getElementById('albumTitle').value || 'Photo Album',
          photos: photoUrls,
          music: musicObj,
          settings: {
            duration: Math.max(3, Math.min(5, parseInt(document.getElementById('duration').value) || 3)),
            transition: document.getElementById('transition').value,
            musicVolume: parseFloat(document.getElementById('musicVolume').value) || 0.7,
            openingMsg: document.getElementById('openingMsg').value || '',
            romanticTheme: !!document.getElementById('romanticTheme').checked
          }
        })
      });
      const albumData = await safeJson(albumRes);
      if (!albumRes.ok || (albumData && albumData.error)) {
        throw new Error((albumData && albumData.error) || ('Failed to create album (HTTP ' + albumRes.status + ')'));
      }

      progressBar.style.width = '100%';
      progressPercent.textContent = '100%';
      progressText.textContent = 'Complete!';

      status.textContent = 'Generating QR code...';
      const qrDataUrl = await QRCode.toDataURL(albumData.url, { width: 300, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
      document.getElementById('qrImg').src = qrDataUrl;
      document.getElementById('albumLink').value = albumData.url;
      document.getElementById('openAlbum').href = albumData.url;
      document.getElementById('result').style.display = 'block';

      document.getElementById('downloadQR').onclick = () => {
        const a = document.createElement('a');
        a.href = qrDataUrl;
        a.download = 'album-qr.png';
        a.click();
      };
      document.getElementById('copyLink').onclick = () => {
        navigator.clipboard.writeText(albumData.url).then(() => {
          const old = document.getElementById('copyLink').textContent;
          document.getElementById('copyLink').textContent = '✅ Copied!';
          setTimeout(() => document.getElementById('copyLink').textContent = old, 2000);
        });
      };
      document.getElementById('createAnother').onclick = () => location.reload();

      btn.textContent = '✅ Done!';
      status.textContent = '';
    } catch (e) {
      alert('Error: ' + (e && e.message ? e.message : 'Failed to create album.'));
      btn.disabled = false;
      btn.textContent = '🎉 GENERATE MY ALBUM & QR CODE';
      status.textContent = '';
      document.getElementById('uploadProgress').style.display = 'none';
    }
  }
})();