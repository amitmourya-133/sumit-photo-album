(function () {
  'use strict';

  const state = {
    photos: [],
    index: 0,
    started: false,
    autoTimer: null,
    errorTimer: null,
    errorCount: 0,
    loadToken: 0,
    tracks: [],
    trackIndex: 0,
    musicReady: false,
    suppressClickUntil: 0,
    pointer: null
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    els.wrapper = document.querySelector('.photo-wrapper');
    els.photo = $('photo');
    els.fallback = $('photo-fallback');
    els.fallbackMessage = $('fallback-message');
    els.retry = $('fallback-retry');
    els.overlay = $('tap-overlay');
    els.overlayTitle = els.overlay.querySelector('h1');
    els.overlayText = $('tap-overlay-text');
    els.overlayInst = els.overlay.querySelector('.tap-inst');
    els.counter = $('photo-counter');
    els.audio = $('bg-audio');
    els.panel = $('music-panel');
    els.musicToggle = $('music-toggle');
    els.musicClose = $('music-close');
    els.trackCurrent = $('track-current');
    els.trackSelect = $('track-select');
    els.playBtn = $('music-play');
    els.muteBtn = $('music-mute');
    els.volume = $('music-volume');
    els.volumeValue = $('volume-value');
    els.musicStatus = $('music-status');
    els.prevBtn = $('prev');
    els.nextBtn = $('next');
  }

  function basename(src) {
    return String(src).split('/').pop().split('?')[0];
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* storage may be unavailable */
    }
  }

  function setMusicStatus(message) {
    if (els.musicStatus) els.musicStatus.textContent = message || '';
  }

  function normalizeIndex(index) {
    const total = state.photos.length;
    return ((index % total) + total) % total;
  }

  function renderCounter() {
    if (!state.photos.length) {
      els.counter.textContent = '0 / 0';
      return;
    }
    els.counter.textContent = `${state.index + 1} / ${state.photos.length}`;
  }

  function hideFallback() {
    if (els.fallback) els.fallback.hidden = true;
  }

  function showFallback(message) {
    if (!els.fallback) return;
    els.fallbackMessage.textContent = message;
    els.fallback.hidden = false;
  }

  function preloadNext() {
    const total = state.photos.length;
    if (total < 2) return;
    for (let step = 1; step <= 2; step += 1) {
      const i = (state.index + step) % total;
      if (i === state.index) continue;
      const img = new Image();
      img.src = state.photos[i];
    }
  }

  function clearAuto() {
    if (state.autoTimer) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
  }

  function startAuto() {
    clearAuto();
    if (!state.started || state.photos.length < 2) return;
    state.autoTimer = setInterval(function () {
      if (document.hidden) return;
      showPhoto(state.index + 1);
    }, 5000);
  }

  function restartAuto() {
    startAuto();
  }

  function photoUnavailable(src) {
    state.errorCount += 1;
    els.photo.classList.remove('is-visible');
    els.photo.classList.add('is-error');
    if (state.errorCount >= state.photos.length) {
      clearAuto();
      showFallback('None of the photos could be loaded. Check that the files exist in photos/ and that photos.json paths are correct.');
      return;
    }
    showFallback(`Could not load "${basename(src)}". Trying the next photo...`);
    if (state.errorTimer) clearTimeout(state.errorTimer);
    state.errorTimer = setTimeout(function () {
      if (state.photos.length > 1) showPhoto(state.index + 1);
    }, 2500);
  }

  function showPhoto(index, options) {
    const opts = options || {};
    if (!state.photos.length) return;
    if (state.errorTimer) {
      clearTimeout(state.errorTimer);
      state.errorTimer = null;
    }
    state.index = normalizeIndex(index);
    const src = state.photos[state.index];
    const token = (state.loadToken += 1);
    if (!src) {
      photoUnavailable('(empty path)');
      return;
    }
    renderCounter();
    hideFallback();
    els.photo.classList.remove('is-visible');
    els.photo.classList.add('is-error');
    els.photo.onload = function () {
      if (token !== state.loadToken) return;
      state.errorCount = 0;
      els.photo.classList.remove('is-error');
      els.photo.classList.add('is-visible');
      hideFallback();
    };
    els.photo.onerror = function () {
      if (token !== state.loadToken) return;
      photoUnavailable(src);
    };
    els.photo.src = opts.retry ? `${src}${src.includes('?') ? '&' : '?'}retry=${Date.now()}` : src;
    preloadNext();
  }

  function nextPhoto() {
    if (!state.photos.length) return;
    showPhoto(state.index + 1);
  }

  function prevPhoto() {
    if (!state.photos.length) return;
    showPhoto(state.index - 1);
  }

  function showEmptyState(title, text, hint) {
    clearAuto();
    state.photos = [];
    state.index = 0;
    els.photo.removeAttribute('src');
    els.photo.classList.remove('is-visible', 'is-error');
    hideFallback();
    els.overlayTitle.textContent = title;
    els.overlayText.textContent = text;
    els.overlayInst.textContent = hint;
    els.overlay.hidden = false;
    els.overlay.classList.remove('is-hidden');
    renderCounter();
  }

  function updateMusicUI() {
    const audio = els.audio;
    const track = state.tracks[state.trackIndex];
    const playing = state.musicReady && !audio.paused;
    if (els.playBtn) {
      els.playBtn.disabled = !state.musicReady;
      els.playBtn.textContent = playing ? 'Pause' : 'Play';
    }
    if (els.muteBtn) {
      els.muteBtn.disabled = !state.musicReady;
      els.muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute';
    }
    if (els.musicToggle) {
      els.musicToggle.classList.toggle('is-muted', !state.musicReady || audio.muted);
      els.musicToggle.setAttribute('aria-pressed', String(playing));
    }
    if (els.trackCurrent) {
      els.trackCurrent.textContent = track ? track.title : 'No track added';
    }
    if (els.trackSelect && state.musicReady) {
      els.trackSelect.value = String(state.trackIndex);
    }
    if (els.volume) {
      els.volume.value = String(audio.volume);
    }
    if (els.volumeValue) {
      els.volumeValue.textContent = `${Math.round(audio.volume * 100)}%`;
    }
  }

  function applySavedAudioSettings() {
    const savedVolume = Number(storageGet('album-volume'));
    if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) {
      els.audio.volume = savedVolume;
    } else {
      els.audio.volume = 0.8;
    }
    els.audio.muted = storageGet('album-muted') === 'true';
  }

  async function loadMusic() {
    let tracks = [];
    let active = 0;
    try {
      const res = await fetch('music.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tracks)) {
          tracks = data.tracks
            .filter((t) => t && typeof t.src === 'string' && t.src.trim())
            .map((t) => ({
              title: typeof t.title === 'string' && t.title.trim() ? t.title.trim() : basename(t.src),
              src: t.src
            }));
        }
        if (Number.isInteger(data.active)) active = data.active;
      }
    } catch (e) {
      /* no manifest */
    }

    if (!tracks.length) {
      try {
        const head = await fetch('music.mp3', { method: 'HEAD', cache: 'no-store' });
        if (head.ok) {
          tracks = [{ title: 'Background music', src: 'music.mp3' }];
        }
      } catch (e) {
        /* no legacy track */
      }
    }

    els.trackSelect.innerHTML = '';
    if (!tracks.length) {
      state.musicReady = false;
      const opt = document.createElement('option');
      opt.textContent = 'No tracks';
      els.trackSelect.appendChild(opt);
      els.trackSelect.disabled = true;
      setMusicStatus('No music yet. Upload an MP3 with the album manager, then redeploy.');
      updateMusicUI();
      return;
    }

    state.tracks = tracks;
    state.trackIndex = Number.isInteger(active) && active >= 0 && active < tracks.length ? active : 0;
    tracks.forEach(function (track, i) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = track.title;
      els.trackSelect.appendChild(opt);
    });
    els.trackSelect.disabled = tracks.length < 2;
    els.audio.src = tracks[state.trackIndex].src;
    els.audio.load();
    state.musicReady = true;
    setMusicStatus('');
    updateMusicUI();
  }

  function tryPlayMusic() {
    if (!state.musicReady) return;
    if (els.audio.muted || els.audio.volume === 0) {
      updateMusicUI();
      return;
    }
    els.audio
      .play()
      .then(function () {
        setMusicStatus('');
        updateMusicUI();
      })
      .catch(function () {
        setMusicStatus('Tap Play to start music (your browser blocked autoplay).');
        updateMusicUI();
      });
  }

  async function togglePlayback() {
    if (!state.musicReady) return;
    try {
      if (els.audio.paused) {
        await els.audio.play();
        setMusicStatus('');
      } else {
        els.audio.pause();
      }
    } catch (e) {
      setMusicStatus('This track could not be played.');
    }
    updateMusicUI();
  }

  function toggleMute() {
    if (!state.musicReady) return;
    els.audio.muted = !els.audio.muted;
    storageSet('album-muted', String(els.audio.muted));
    updateMusicUI();
  }

  function changeVolume() {
    const volume = Math.min(1, Math.max(0, Number(els.volume.value) || 0));
    els.audio.volume = volume;
    storageSet('album-volume', String(volume));
    updateMusicUI();
  }

  function changeTrack() {
    if (!state.musicReady) return;
    const index = Number(els.trackSelect.value);
    if (!Number.isInteger(index) || index < 0 || index >= state.tracks.length) return;
    const wasPlaying = !els.audio.paused;
    state.trackIndex = index;
    els.audio.src = state.tracks[index].src;
    els.audio.load();
    setMusicStatus('');
    updateMusicUI();
    if (wasPlaying) {
      els.audio.play().catch(function () {
        setMusicStatus('Tap Play to start the selected track.');
      });
    }
  }

  function openPanel() {
    els.panel.hidden = false;
    els.musicToggle.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    els.panel.hidden = true;
    els.musicToggle.setAttribute('aria-expanded', 'false');
  }

  function startExperience() {
    if (state.started) return;
    state.started = true;
    els.overlay.classList.add('is-hidden');
    setTimeout(function () {
      els.overlay.hidden = true;
    }, 420);
    tryPlayMusic();
    if (state.photos.length > 1) startAuto();
  }

  function onWrapperClick() {
    if (Date.now() < state.suppressClickUntil) return;
    if (!state.started) {
      startExperience();
      return;
    }
    if (state.photos.length > 1 && els.fallback.hidden) {
      nextPhoto();
      restartAuto();
    }
  }

  function bindEvents() {
    els.overlay.addEventListener('click', function (event) {
      event.preventDefault();
      startExperience();
    });

    els.wrapper.addEventListener('click', onWrapperClick);

    els.retry.addEventListener('click', function (event) {
      event.stopPropagation();
      if (!state.photos.length) return;
      hideFallback();
      showPhoto(state.index, { retry: true });
      restartAuto();
    });

    els.wrapper.addEventListener(
      'pointerdown',
      function (event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        state.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
      },
      { passive: true }
    );

    els.wrapper.addEventListener(
      'pointerup',
      function (event) {
        const start = state.pointer;
        state.pointer = null;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          state.suppressClickUntil = Date.now() + 400;
          if (dx > 0) prevPhoto();
          else nextPhoto();
          restartAuto();
        }
      },
      { passive: true }
    );

    els.wrapper.addEventListener('pointercancel', function () {
      state.pointer = null;
    });

    els.prevBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      prevPhoto();
      restartAuto();
    });

    els.nextBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      nextPhoto();
      restartAuto();
    });

    els.musicToggle.addEventListener('click', function (event) {
      event.stopPropagation();
      if (els.panel.hidden) openPanel();
      else closePanel();
    });

    els.musicClose.addEventListener('click', function (event) {
      event.stopPropagation();
      closePanel();
    });

    els.playBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      togglePlayback();
    });

    els.muteBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleMute();
    });

    els.volume.addEventListener('input', changeVolume);
    els.trackSelect.addEventListener('change', changeTrack);

    els.audio.addEventListener('play', updateMusicUI);
    els.audio.addEventListener('pause', updateMusicUI);
    els.audio.addEventListener('volumechange', updateMusicUI);
    els.audio.addEventListener('error', function () {
      if (els.audio.src) setMusicStatus('This track could not be loaded.');
      updateMusicUI();
    });

    document.addEventListener('keydown', function (event) {
      const tag = (event.target && event.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (event.key === 'ArrowLeft') {
        if (!state.started) startExperience();
        prevPhoto();
        restartAuto();
      } else if (event.key === 'ArrowRight') {
        if (!state.started) startExperience();
        nextPhoto();
        restartAuto();
      } else if (event.key === ' ' && state.musicReady) {
        event.preventDefault();
        togglePlayback();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearAuto();
      else restartAuto();
    });
  }

  async function loadPhotos() {
    const res = await fetch('photos.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`photos.json returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.photos)) throw new Error('photos.json has no photos array');
    return data.photos.filter((p) => typeof p === 'string' && p.trim());
  }

  async function init() {
    cacheElements();
    applySavedAudioSettings();
    bindEvents();
    updateMusicUI();

    let photos = [];
    try {
      photos = await loadPhotos();
    } catch (e) {
      console.error('Could not load photos.json:', e);
      showEmptyState(
        'Could not load photos',
        'photos.json is missing or invalid. Run npm start and use the album manager to add photos.',
        'Open /admin.html on your computer, then redeploy.'
      );
      await loadMusic();
      return;
    }

    state.photos = photos;
    await loadMusic();

    if (!photos.length) {
      showEmptyState(
        'No photos yet',
        'This album is empty. Add photos with the album manager, then redeploy.',
        'Run npm start and open /admin.html on your computer.'
      );
      return;
    }

    showPhoto(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();