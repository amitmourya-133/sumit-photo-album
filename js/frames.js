// Photo frame theme engine.
// Classification is a LOCAL color-statistics heuristic computed in the visitor's
// browser from a downscaled canvas copy of the photo (photos are already
// downloaded for display; nothing is sent anywhere). It is NOT AI vision and it
// is deliberately conservative: when the statistics do not clearly match a
// category, the photo falls back to the tasteful "minimal" general theme.
// Results are cached per URL (memory + sessionStorage) so a photo is analyzed once.
(function () {
  'use strict';

  var THEMES = ['wedding', 'romantic', 'travel', 'celebration', 'family', 'nature', 'minimal'];
  var CACHE_KEY = 'photo-frames-v1';
  var memoryCache = new Map();

  var persisted = null;
  try {
    persisted = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) || '{}') || {};
  } catch (e) {
    persisted = {};
  }

  function persist(url, theme) {
    memoryCache.set(url, theme);
    persisted[url] = theme;
    try {
      var entries = Object.keys(persisted);
      if (entries.length > 600) {
        for (var i = 0; i < entries.length - 600; i++) delete persisted[entries[i]];
      }
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(persisted));
    } catch (e) { /* storage may be full/unavailable */ }
  }

  function cached(url) {
    if (memoryCache.has(url)) return memoryCache.get(url);
    if (Object.prototype.hasOwnProperty.call(persisted, url)) {
      var t = persisted[url];
      if (THEMES.indexOf(t) !== -1) {
        memoryCache.set(url, t);
        return t;
      }
    }
    return null;
  }

  var canvas = null;
  function getCanvas() {
    if (!canvas) canvas = document.createElement('canvas');
    return canvas;
  }

  function computeStats(img) {
    var c = getCanvas();
    var S = 48;
    c.width = S; c.height = S;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // Draw the whole image stretched into a small square: color statistics are
    // orientation-agnostic and this only affects analysis, never display.
    ctx.drawImage(img, 0, 0, S, S);
    var data;
    try {
      data = ctx.getImageData(0, 0, S, S).data;
    } catch (e) {
      return null; // canvas tainted (e.g. missing CORS) -> caller falls back
    }
    var n = data.length / 4;
    var sumSat = 0, sumV = 0, colorfulness = 0, white = 0, green = 0, blue = 0, skin = 0, vivid = 0;
    var sumRG = 0, sumYB = 0, sumRG2 = 0, sumYB2 = 0;
    for (var i = 0; i < n; i++) {
      var r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var v = max, s = max === 0 ? 0 : (max - min) / max;
      sumSat += s; sumV += v;
      white += (v > 0.72 && s < 0.18) ? 1 : 0;
      vivid += (s > 0.45 && v > 0.4) ? 1 : 0;

      var h;
      if (s > 0.12) {
        var d = max - min;
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
        if (h < 0) h += 360;
        if (h >= 65 && h <= 175) green += 1;           // leaf/foliage
        else if (h >= 175 && h <= 265) blue += 1;       // sky/sea
      }

      // Skin-tone-ish: reddish over green over blue, mid brightness
      var r8 = r * 255, g8 = g * 255, b8 = b * 255;
      if (r8 > 55 && r8 > g8 && g8 > b8 && r8 - g8 > 14 && r8 - b8 > 20 && r8 < 250) skin += 1;

      // Hasler–Süsstrunk colorfulness components
      var rg = r - g, yb = 0.5 * (r + g) - b;
      sumRG += rg; sumYB += yb;
      sumRG2 += rg * rg; sumYB2 += yb * yb;
    }
    var meanRG = Math.sqrt(sumRG2 / n - Math.pow(sumRG / n, 2));
    var meanYB = Math.sqrt(sumYB2 / n - Math.pow(sumYB / n, 2));
    colorfulness = Math.sqrt(meanRG * meanRG + meanYB * meanYB) + 0.2 * Math.sqrt(Math.abs(sumRG / n) + Math.abs(sumYB / n));

    return {
      satMean: sumSat / n,
      brightMean: sumV / n,
      colorfulness: Math.min(1, colorfulness),
      whiteFrac: white / n,
      greenFrac: green / n,
      blueFrac: blue / n,
      skinFrac: skin / n,
      vividFrac: vivid / n
    };
  }

  // Conservative decision: strong signals only; anything ambiguous -> 'minimal'
  function classifyStats(st) {
    if (!st) return 'minimal';
    // Ivory/white dominance with low colour = wedding (white dress / bright decor)
    if (st.whiteFrac > 0.32 && st.satMean < 0.22 && st.brightMean > 0.48) return 'wedding';
    // Real foliage presence = nature
    if (st.greenFrac > 0.30) return 'nature';
    // Sky/sea dominance with brightness = travel
    if (st.blueFrac > 0.28 && st.brightMean > 0.42) return 'travel';
    // Vivid, colourful mix = celebration confetti/party
    if (st.vividFrac > 0.42 && st.satMean > 0.34 && st.colorfulness > 0.20) return 'celebration';
    // People-ish warm tones:
    if (st.skinFrac > 0.20 && st.satMean > 0.26) return 'romantic';
    if (st.skinFrac > 0.13) return 'family';
    return 'minimal';
  }

  function classifyFromImage(img) {
    var url = img.currentSrc || img.src || '';
    if (!url) return 'minimal';
    var hit = cached(url);
    if (hit) return hit;
    var stats = null;
    try {
      stats = computeStats(img);
    } catch (e) {
      stats = null;
    }
    var theme = classifyStats(stats);
    persist(url, theme);
    return theme;
  }

  function applyTheme(el, theme) {
    if (!el) return;
    var t = THEMES.indexOf(theme) !== -1 ? theme : 'minimal';
    el.setAttribute('data-frame', t);
  }

  function resolve(settings, cat) {
    var manual = settings && settings.frameStyle && settings.frameStyle !== 'automatic' ? settings.frameStyle : null;
    if (manual) return THEMES.indexOf(manual) !== -1 ? manual : 'minimal';
    if (!settings || settings.autoTheme !== false) return cat || 'minimal';
    return 'minimal';
  }

  window.PhotoFrames = {
    THEMES: THEMES,
    classifyFromImage: classifyFromImage,
    classifyStats: classifyStats,
    applyTheme: applyTheme,
    resolve: resolve
  };
})();
