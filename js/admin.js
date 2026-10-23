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
    apiOk: false
  };

  function setStatus(id, message, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.dataset.kind = kind || '';
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    let data = null;
    try {
      data = await res.json();
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
        reject(new Error('Network error. Is "npm start" still running?'));
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
    const data = await api('/api/photos');
    state.order = Array.isArray(data.photos) ? data.photos.slice() : [];
    state.dirty = false;
    renderPhotos();
  }

  function markDirty() {
    state.dirty = true;
    $('save-order').disabled = false;
    setStatus('photo-status', 'Order changed. Click "Save order" to store it.');
  }

  async function saveOrder() {
    try {
      await api('/api/photos/reorder', {
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
      radio.setAttribute('aria-label', `Use ${track.title}`);

      const title = document.createElement('span');
      title.className = 'track-title';
      title.textContent = track.title;

      const file = document.createElement('span');
      file.className = 'track-file';
      file.textContent = track.src.split('/').pop();

      const actions = document.createElement('div');
      actions.className = 'track-actions';
      const preview = makeButton('Preview', 'preview', { index: String(index), src: track.src });
      const remove = makeButton('Remove', 'delete', { index: String(index), src: track.src }, true);
      actions.append(preview, remove);

      row.append(radio, title, file, actions);
      list.appendChild(row);
    });
  }

  async function loadMusic() {
    const data = await api('/api/music');
    state.tracks = Array.isArray(data.tracks) ? data.tracks : [];
    state.active = Number.isInteger(data.active) ? data.active : 0;
    renderTracks();
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
      event.dataTransfer.effectAllowed = 'move';
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
    bindPhotoEvents();
    bindMusicEvents();

    try {
      const health = await api('/api/health');
      state.apiOk = Boolean(health.ok);
    } catch (e) {
      state.apiOk = false;
      showWarning('The management API is not reachable. Start it with "npm start" in the project folder, then open http://localhost:3000/admin.html. This page does not work on the Vercel URL.');
      return;
    }

    if (!state.apiOk) {
      showWarning('The management API reported it is unavailable.');
      return;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();