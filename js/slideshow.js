(function() {
    'use strict';

    // ---- State ----
    let photos = [];
    let totalPhotos = 0;
    let currentIndex = 0;
    let autoInterval = null;
    let audioPlaying = false;
    let musicToggle = null;
    let tapOverlay = null;
    let photoEl = null;
    let photoCounter = null;
    let prevBtn = null;
    let nextBtn = null;

    let preloadIndex1 = 0;
    let preloadIndex2 = 1;

    // ---- Helpers ----
    const $ = id => document.getElementById(id);

    // ---- Load photo data ----
    function loadPhotosData() {
        return fetch('photos.json')
            .then(res => res.json())
            .then(data => {
                photos = Array.isArray(data.photos) ? data.photos : [];
                totalPhotos = (typeof data.total === 'number') ? data.total : photos.length;
                return totalPhotos;
            })
            .catch(err => {
                console.error('Error loading photos.json:', err);
                return 0;
            });
    }

    // ---- Preload 2 photos ahead ----
    function preloadImages() {
        if (totalPhotos === 0) return;
        preloadIndex1 = (preloadIndex1 + 1) % totalPhotos;
        preloadIndex2 = (preloadIndex2 + 1) % totalPhotos;

        if (preloadIndex1 !== currentIndex) {
            const img1 = new Image();
            img1.src = photos[preloadIndex1];
            img1.onload = () => {};
            img1.onerror = () => {};
        }
        if (preloadIndex2 !== currentIndex && preloadIndex2 !== preloadIndex1) {
            const img2 = new Image();
            img2.src = photos[preloadIndex2];
            img2.onload = () => {};
            img2.onerror = () => {};
        }
    }

    // ---- Show photo ----
    function showPhoto(index, noPreload) {
        if (totalPhotos === 0) return;
        currentIndex = ((index % totalPhotos) + totalPhotos) % totalPhotos;
        photoEl.src = photos[currentIndex];
        photoCounter.textContent = `${currentIndex + 1} / ${totalPhotos}`;

        if (!noPreload) {
            preloadImages();
        }
    }

    // ---- Auto slide 5s ----
    function startAutoSlide() {
        if (autoInterval) clearInterval(autoInterval);
        if (totalPhotos <= 1) return;
        autoInterval = setInterval(function() {
            showPhoto(currentIndex + 1);
        }, 5000);
    }

    // ---- Music ----
    function startMusic() {
        const audio = $('bg-audio');
        if (!audioPlaying) {
            audio.play().catch(function() {});
            audioPlaying = true;
            musicToggle.textContent = '🔊';
        }
    }

    function toggleMusic() {
        const audio = $('bg-audio');
        if (audioPlaying) {
            audio.pause();
            audioPlaying = false;
            musicToggle.textContent = '🔇';
        } else {
            audio.currentTime = 0;
            audio.play().then(function() {
                audioPlaying = true;
                musicToggle.textContent = '🔊';
            }).catch(function() {});
        }
    }

    // ---- Init handlers ----
    function initTapHandler() {
        if (totalPhotos === 0) {
            if (tapOverlay) tapOverlay.style.display = 'none';
            return;
        }
        const tapHandler = function(e) {
            e.preventDefault();
            if (tapOverlay) tapOverlay.style.display = 'none';
            document.body.removeEventListener('touchstart', tapHandler, { passive: false });
            document.body.removeEventListener('mousedown', tapHandler);
            startMusic();
            startAutoSlide();
        };
        document.body.addEventListener('touchstart', tapHandler, { passive: false });
        document.body.addEventListener('mousedown', tapHandler);
    }

    function initSwipeHandler() {
        if (totalPhotos === 0) return;
        let startX = 0;
        const handleStart = function(e) {
            startX = e.touches ? e.touches[0].clientX : e.clientX;
        };
        const handleEnd = function(e) {
            const endX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const diff = endX - startX;
            if (Math.abs(diff) > 40) {
                if (diff > 0) {
                    showPhoto(currentIndex - 1);
                } else {
                    showPhoto(currentIndex + 1);
                }
                clearInterval(autoInterval);
                startAutoSlide();
            }
        };
        document.body.addEventListener('touchstart', handleStart, { passive: false });
        document.body.addEventListener('touchend', handleEnd, { passive: false });
        document.body.addEventListener('mousedown', handleStart);
        document.body.addEventListener('mouseup', handleEnd);
    }

    function updateActivePhoto(index) {
        if (totalPhotos === 0) return;
        currentIndex = index;
    }

    // ---- Init ----
    async function initApp() {
        photoEl = $('photo');
        tapOverlay = $('tap-overlay');
        musicToggle = $('music-toggle');
        photoCounter = $('photo-counter');
        prevBtn = $('prev');
        nextBtn = $('next');

        await loadPhotosData();

        if (totalPhotos === 0) {
            photoEl.alt = 'No photos available';
            photoCounter.textContent = '0 / 0';
            if (tapOverlay) tapOverlay.style.display = 'none';
            // Show placeholder or hide
            const overlay = $('tap-overlay');
            if (overlay) {
                overlay.innerHTML = '<h1>No Photos</h1><p>Please add photos to the album</p>';
                overlay.style.display = 'flex';
            }
            return;
        }

        showPhoto(0, true);
        initTapHandler();
        initSwipeHandler();
        startAutoSlide();
        setInterval(preloadImages, 1000);

        // Prev/Next button handlers
        if (prevBtn) {
            prevBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                showPhoto(currentIndex - 1);
                clearInterval(autoInterval);
                startAutoSlide();
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                showPhoto(currentIndex + 1);
                clearInterval(autoInterval);
                startAutoSlide();
            });
        }
        if (musicToggle) {
            musicToggle.addEventListener('click', toggleMusic);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
EOF_CONTENT")