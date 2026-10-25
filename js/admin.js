(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    order: [],
    dirty: false,
    tracks: [],
    active: 0,
    dragSrc: null,
    previewSrc: '',
    apiOk: false,
    authorized: false,
    isProduction: false,
    startTime: 0
  };

  function setStatus(id, message, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.dataset.kind = kind || '';
  }

  function showAuthWarning(message) {
    const warning = $('api-warning');
    const authStatus = $('auth-status');
    if (warning) {
      warning.hidden = false;
      warning.textContent = message || '';
    }
    if (authStatus) {
      authStatus.textContent = message || '';
    }
  }

  function setAuthButton(isProduction, authorized) {
    const authStatus = $('auth-status');
    if (isProduction) {
      authStatus.textContent = authorized ? 'Authorized' : 'Unauthorized - some features disabled';
      authStatus.dataset.kind = authorized ? 'ok' : 'error';
      if (!authorized) {
        setStatus('photo-status', 'Not authorized. Upload features disabled.', 'error');
        setStatus('music-status', 'Not authorized. Upload features disabled.', 'error');
      }
    } else {
      authStatus.textContent = 'Local mode - automatic authentication';
      authStatus.dataset.kind = 'ok';
    }
  }

  function api(path, options) {
    const res = fetch(path, options);
    let data = null;
    try {
      data = res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data || {};
  }

  function upload(path, formData, statusId) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path);
      xhr.upload.addEventListener('progress', function (event) {
        if (!event.lengthComputable) return;
        setStatus(statusId, `Uploading... ${Math.round((event.loaded / event.total) * 100)}%`);
      });
      xhr.addEventListener('load', function () {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e) {
          data = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      });
      xhr.addEventListener('error', function () {
        reject(new Error('Network error.'));
      });
      xhr.send(formData);
    });
  }

  function makeButton(label, action, dataset, danger) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini' + (danger ? ' remove' : '');
    btn.textContent = label;
    btn.dataset.action = action;
    Object.keys(dataset || {}).forEach(function (key) {
      btn.dataset[key] = dataset[key];
    });
    return btn;
  }

  function renderPhotos() {
    const grid = $('photo-grid');
    const count = $('photo-count');
    grid.innerHTML = '';
    count.textContent = String(state.order.length);
    $('save-order').disabled = !state.dirty;

    if (!state.order.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No photos yet. Drop images above to add them.';
      grid.appendChild(empty);
      return;
    }

    state.order.forEach(function (src, index) {
      const fig = document.createElement('figure');
      fig.className = 'thumb';
      fig.draggable = true;
      fig.dataset.src = src;

      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';

      const bar = document.createElement('div');
      bar.className = 'thumb-bar';
      const badge = document.createElement('span');
      badge.className = 'index';
      badge.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'fname';
      name.textContent = src.split('/').pop();
      bar.append(badge, name);

      const actions = document.createElement('div');
      actions.className = 'thumb-actions';
      actions.append(
        makeButton('Up', 'up'),
        makeButton('Down', 'down'),
        makeButton('Remove', 'remove', null, true)
      );

      fig.append(img, bar, actions);
      grid.appendChild(fig);
    });
  }

  async function loadPhotos() {
    try {
      const data = await api('/api/photos');
      state.order = Array.isArray(data.photos) ? data.photos.slice() : [];
      state.dirty = false;
      renderPhotos();
      setStatus('photo-status', 'Photo list loaded.', 'ok');
    } catch (e) {
      setStatus('photo-status', e.message, 'error');
    }
  }

  function markDirty() {
    state.dirty = true;
    $('save-order').disabled = false;
    setStatus('photo-status', 'Order changed. Click "Save order" to store it.');
  }

  async function saveOrder() {
    try {
      const data = await api('/api/photos/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: state.order })
      });
      state.dirty = false;
      $('save-order').disabled = true;
      setStatus('photo-status', 'Photo order saved.', 'ok');
    } catch (e) {
      setStatus('photo-status', e.message, 'error');
    }
  }

  async function uploadPhotos(files) {
    if (!files.length) return;
    const form = new FormData();
    files.forEach(function (file) {
      form.append('photos', file, file.name);
    });
    setStatus('photo-status', `Uploading ${files.length} photo(s)...`);
    try {
      const data = await upload('/api/photos/upload', form, 'photo-status');
      const parts = [];
      if (data.added && data.added.length) parts.push(`${data.added.length} photo(s) added`);
      if (data.errors && data.errors.length) parts.push(`${data.errors.length} failed: ${data.errors.join('; ')}`);
      setStatus('photo-status', parts.join('. ') || data.message || 'Done.', data.errors && data.errors.length ? 'error' : 'ok');
      await loadPhotos();
    } catch (e) {
      setStatus('photo-status', e.message, 'error');
    }
  }

  async function removePhoto(src) {
    if (!window.confirm(`Remove "${src.split('/').pop()}" from the album?`)) return;
    try {
      await api('/api/photos/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: src })
      });
      setStatus('photo-status', 'Photo removed.', 'ok');
      await loadPhotos();
    } catch (e) {
      setStatus('photo-status', e.message, 'error');
    }
  }

  function movePhoto(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.order.length) return;
    const next = state.order.slice();
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    state.order = next;
    markDirty();
    renderPhotos();
  }

  function renderTracks() {
    const list = $('track-list');
    list.innerHTML = '';
    $('track-count').textContent = String(state.tracks.length);

    if (!state.tracks.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No tracks yet. Upload an MP3 above.';
      list.appendChild(empty);
      return;
    }

    state.tracks.forEach(function (track, index) {
      const row = document.createElement('div');
      row.className = 'track' + (index === state.active ? ' active' : '');

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'active-track';
      radio.checked = index === state.active;
      radio.dataset.action = 'active';
      radio.dataset.index = String(index);
      radio.setAttribute('aria-label', 'Use ' + track.title);

      const title = document.createElement('span');
      title.className = 'track-title';
      title.textContent = track.title;

      const file = document.createElement('span');
      file.className = 'track-file';
      file.textContent = track.src.split('/').pop();

      const startTimeDisplay = document.createElement('span');
      startTimeDisplay.className = 'track-starttime';
      startTimeDisplay.textContent = formatTime(track.startTime || 0);

      const actions = document.createElement('div');
      actions.className = 'track-actions';
      const preview = makeButton('Preview', 'preview', { index: String(index), src: track.src });
      const remove = makeButton('Remove', 'delete', { index: String(index), src: track.src }, true);
      actions.append(preview, remove);

      row.append(radio, title, file, startTimeDisplay, actions);
      list.appendChild(row);
    });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  async function loadMusic() {
    try {
      const data = await api('/api/music');
      state.tracks = Array.isArray(data.tracks) ? data.tracks : [];
      state.active = Number.isInteger(data.active) ? data.active : 0;
      renderTracks();
      setStatus('music-status', 'Music list loaded.', 'ok');
    } catch (e) {
      setStatus('music-status', e.message, 'error');
    }
  }

  async function setActiveTrack(index) {
    try {
      const data = await api('/api/music/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index })
      });
      state.active = Number.isInteger(data.active) ? data.active : 0;
      renderTracks();
      setStatus('music-status', 'Active track updated.', 'ok');
    } catch (e) {
      setStatus('music-status', e.message, 'error');
      renderTracks();
    }
  }

  async function uploadMusic(files) {
    if (!files.length) return;
    const form = new FormData();
    files.forEach(function (file) {
      form.append('music', file, file.name);
    });
    setStatus('music-status', `Uploading ${files.length} track(s)...`);
    try {
      const data = await upload('/api/music/upload', form, 'music-status');
      const parts = [];
      if (data.added && data.added.length) parts.push(`${data.added.length} track(s) added`);
      if (data.errors && data.errors.length) parts.push(`${data.errors.length} failed: ${data.errors.join('; ')}`);
      setStatus('music-status', parts.join('. ') || data.message || 'Done.', data.errors && data.errors.length ? 'error' : 'ok');
      await loadMusic();
    } catch (e) {
      setStatus('music-status', e.message, 'error');
    }
  }

  function updateTrackStartTime(trackIndex, seconds) {
    if (state.tracks[trackIndex]) {
      state.tracks[trackIndex].startTime = seconds;
      // Update the display
      const startTimeDisplay = $('track-starttime');
      if (startTimeDisplay) {
        startTimeDisplay.textContent = formatTimeDisplay(seconds);
      }
      // Save to server
      const data = api('/api/music/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: state.active, startTime: seconds })
      });
    }
  }

  async function removeTrack(track) {
    if (!window.confirm(`Remove "${track.title}"?`)) return;
    const audio = $('preview-audio');
    if (state.previewSrc === track.src) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      state.previewSrc = '';
    }
    try {
      await api('/api/music/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: track.src })
      });
      setStatus('music-status', 'Track removed.', 'ok');
      await loadMusic();
      updatePreviewButtons();
    } catch (e) {
      setStatus('music-status', e.message, 'error');
    }
  }

  function togglePreview(track) {
    const audio = $('preview-audio');
    if (state.previewSrc === track.src) {
      if (audio.paused) {
        audio.play().catch(function () {
          setStatus('music-status', 'This track could not be played.', 'error');
        });
      } else {
        audio.pause();
      }
    } else {
      state.previewSrc = track.src;
      audio.src = track.src;
      audio.volume = Number($('preview-volume').value) || 0.8;
      audio.play().catch(function () {
        setStatus('music-status', 'This track could not be played.', 'error');
      });
    }
    updatePreviewButtons();
  }

  function updatePreviewButtons() {
    const audio = $('preview-audio');
    document.querySelectorAll('.mini[data-action="preview"]').forEach(function (btn) {
      const playing = state.previewSrc === btn.dataset.src && !audio.paused;
      btn.textContent = playing ? 'Pause' : 'Preview';
    });
  }

  function bindPhotoEvents() {
    const dropzone = $('dropzone');
    const fileInput = $('photo-input');
    const grid = $('photo-grid');

    dropzone.addEventListener('click', function () {
      fileInput.click();
    });

    dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', function (event) {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      uploadPhotos(files);
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', function (event) {
      const files = Array.from(event.dataTransfer.files || []).filter(function (file) {
        return file.type.startsWith('image/');
      });
      if (files.length) uploadPhotos(files);
      else setStatus('photo-status', 'Please drop image files.', 'error');
    });

    $('refresh-photos').addEventListener('click', function () {
      loadPhotos().then(function () {
        setStatus('photo-status', 'Photo list refreshed.', 'ok');
      }).catch(function (e) {
        setStatus('photo-status', e.message, 'error');
      });
    });

    $('save-order').addEventListener('click', saveOrder);

    grid.addEventListener('click', function (event) {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const fig = btn.closest('.thumb');
      if (!fig) return;
      const src = fig.dataset.src;
      const index = state.order.indexOf(src);
      if (btn.dataset.action === 'remove') removePhoto(src);
      else if (btn.dataset.action === 'up') movePhoto(index, -1);
      else if (btn.dataset.action === 'down') movePhoto(index, 1);
    });

    grid.addEventListener('dragstart', function (event) {
      const fig = event.target.closest('.thumb');
      if (!fig) return;
      state.dragSrc = fig.dataset.src;
      fig.classList.add('dragging');
      try {
        event.dataTransfer.effectAllowed = 'move';
      } catch (e) {
        /* ignore */
      }
      try {
        event.dataTransfer.setData('text/plain', state.dragSrc);
      } catch (e) {
        /* ignore */
      }
    });

    grid.addEventListener('dragend', function () {
      state.dragSrc = null;
      grid.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(function (el) {
        el.classList.remove('dragging', 'drop-before', 'drop-after');
      });
    });

    grid.addEventListener('dragover', function (event) {
      if (!state.dragSrc) return;
      event.preventDefault();
      const fig = event.target.closest('.thumb');
      grid.querySelectorAll('.drop-before, .drop-after').forEach(function (el) {
        el.classList.remove('drop-before', 'drop-after');
      });
      if (!fig || fig.dataset.src === state.dragSrc) return;
      const rect = fig.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      fig.classList.add(after ? 'drop-after' : 'drop-before');
    });

    grid.addEventListener('drop', function (event) {
      if (!state.dragSrc) return;
      event.preventDefault();
      const fig = event.target.closest('.thumb');
      if (!fig) return;
      const after = fig.classList.contains('drop-after');
      const from = state.order.indexOf(state.dragSrc);
      if (from === -1) return;
      const next = state.order.slice();
      next.splice(from, 1);
      let to = next.indexOf(fig.dataset.src);
      if (to === -1) return;
      if (after) to += 1;
      next.splice(to, 0, state.dragSrc);
      state.order = next;
      state.dragSrc = null;
      markDirty();
      renderPhotos();
    });
  }

  function bindMusicEvents() {
    const fileInput = $('music-input');
    const list = $('track-list');
    const audio = $('preview-audio');

    fileInput.addEventListener('change', function (event) {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      uploadMusic(files);
    });

    $('refresh-music').addEventListener('click', function () {
      loadMusic().then(function () {
        setStatus('music-status', 'Music list refreshed.', 'ok');
      }).catch(function (e) {
        setStatus('music-status', e.message, 'error');
      });
    });

    list.addEventListener('click', function (event) {
      const radio = event.target.closest('input[data-action="active"]');
      if (radio) {
        setActiveTrack(Number(radio.dataset.index));
        return;
      }
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const track = state.tracks[Number(btn.dataset.index)];
      if (!track) return;
      if (btn.dataset.action === 'delete') removeTrack(track);
      else if (btn.dataset.action === 'preview') togglePreview(track);
    });

    $('preview-volume').addEventListener('input', function (event) {
      audio.volume = Number(event.target.value);
    });

    // Start time controls
    const startTimeInput = $('#start-time-input');
    const startTimeSlider = $('#start-time-slider');
    const startTimeDisplay = $('#start-time-display');
    
    if (startTimeInput) {
      startTimeInput.addEventListener('input', function () {
        let value = this.value;
        // Ensure format MM:SS
        if (!/^\d{1,2}:\d{2}$/.test(value)) {
          // Strip to format
          const parts = value.split(':');
          if (parts.length === 2) {
            const mins = Math.max(0, Math.min(99, parseInt(parts[0] || '0', 10)));
            const secs = Math.max(0, Math.min(59, parseInt(parts[1] || '0', 10)));
            value = mins + ':' + (secs < 10 ? '0' : '') + secs;
          } else {
            value = '00:00';
          }
          this.value = value;
        }
        // Update slider and display
        const seconds = parseInt(value.replace(':', ''), 10) || 0;
        startTimeSlider.value = seconds;
        startTimeDisplay.textContent = value;
        // Update the currently selected track's start time
        if (state.tracks[state.active] && state.tracks[state.active].src) {
          updateTrackStartTime(state.active, seconds);
        }
      });
      
      startTimeSlider.addEventListener('input', function () {
        const seconds = Math.max(0, Math.min(3600, Math.round(this.value)));
        startTimeDisplay.textContent = formatTimeDisplay(seconds);
        if (state.tracks[state.active] && state.tracks[state.active].src) {
          updateTrackStartTime(state.active, seconds);
        }
      });
    }

    function formatTimeDisplay(seconds) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    ['play', 'pause', 'ended'].forEach(function (type) {
      audio.addEventListener(type, updatePreviewButtons);
    });

    audio.addEventListener('error', function () {
      if (audio.src) setStatus('music-status', 'This track could not be loaded.', 'error');
    });
  }

  function showWarning(message) {
    const warning = $('api-warning');
    warning.hidden = false;
    warning.textContent = message;
  }

  async function boot() {
    // Detect if we're on production (Vercel)
    const isProduction = window.location.hostname !== 'localhost' && 
                         window.location.hostname !== '127.0.0.1' && 
                         !window.location.hostname.startsWith('192.168.');

    state.isProduction = isProduction;

    // Try to authenticate
    try {
      const health = await fetch('/api/health');
      const healthData = await health.json();
      state.apiOk = healthData.ok || false;
      state.authorized = healthData.ok || isLoopback();

      if (isProduction && !state.authorized) {
        // On production, check for admin token
        const token = getAdminToken();
        if (token) {
          // Send auth header
          // The admin token will be set by the server check
        }
      }

      setAuthButton(isProduction, state.authorized);

      if (!state.apiOk && !state.authorized) {
        showAuthWarning('The management API is not reachable or not authorized. '
          + 'On localhost, start "npm start". On Vercel, set ADMIN_API_KEY environment variable.');
        // Still try to load data even without full authorization
      }

      try {
          await loadPhotos();
        } catch (e) {
          setStatus('photo-status', e.message, 'error');
        }
        try {
          await loadMusic();
        } catch (e) {
          setStatus('music-status', e.message, 'error');
        }
      }
    } catch (e) {
      showAuthWarning('Failed to check API status: ' + (e.message || ''));
    }
  }

  function getAdminToken() {
    // Try to get token from localStorage or prompt
    // In production, the admin token should be set via Vercel env vars
    // and the server will check it automatically
    return null;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();