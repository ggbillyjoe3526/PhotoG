/* ==========================================================================
   Portfolio: page.js
   The build (tools/build.mjs) inlines this file right after the gallery, so
   everything here works from the first paint: the gallery's rows are sized
   before any photo appears or chooses a file to download, and the theme
   toggle and S/M/L control respond at once. Run `npm run build` after editing.

   1. Theme     light / dark; follows the system until the visitor chooses
   2. Gallery   justified rows (nothing cropped), re-laid out on resize
   3. Size      S / M / L thumbnails, remembered
   viewer.js (loaded separately) adds the full-screen viewer.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;

  var store = {
    get: function (key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set: function (key, value) {
      try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (e) { /* private mode, storage disabled */ }
    },
  };

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  /* ---------------------------------------------------------------- theme */

  function initTheme() {
    var button = document.querySelector('.theme-toggle');
    var system = window.matchMedia('(prefers-color-scheme: dark)');
    var metas = Array.prototype.slice.call(document.querySelectorAll('meta[name="theme-color"]'));
    var original = metas.map(function (m) { return m.getAttribute('content'); });

    function systemTheme() { return system.matches ? 'dark' : 'light'; }
    function current() { return root.getAttribute('data-theme') || systemTheme(); }
    function follow() {
      root.removeAttribute('data-theme');
      store.set('theme', null);
    }

    function sync() {
      var theme = current();
      var explicit = root.hasAttribute('data-theme');
      var bg = getComputedStyle(document.body).backgroundColor;
      metas.forEach(function (meta, i) { meta.setAttribute('content', explicit ? bg : original[i]); });
      if (button) {
        button.setAttribute('data-current', theme);
        button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      }
    }

    /** Switch all colours at once (no element fades while others jump). */
    function instantly(fn) {
      root.classList.add('theme-switching');
      fn();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { root.classList.remove('theme-switching'); });
      });
    }

    if (button) {
      button.addEventListener('click', function () {
        instantly(function () {
          var next = current() === 'dark' ? 'light' : 'dark';
          // Choosing the system's own theme means "follow the system" again.
          if (next === systemTheme()) follow();
          else {
            root.setAttribute('data-theme', next);
            store.set('theme', next);
          }
          sync();
        });
      });
      button.classList.add('is-ready');
    }

    function onSystemChange() {
      instantly(function () {
        // If the system now matches the visitor's choice, follow it again.
        if (root.getAttribute('data-theme') === systemTheme()) follow();
        sync();
      });
    }
    if (system.addEventListener) system.addEventListener('change', onSystemChange);
    else if (system.addListener) system.addListener(onSystemChange);
    sync();
  }

  /* -------------------------------------------------------------- gallery */

  // Target row height for a gallery `width` px wide, before the S/M/L factor:
  // clamp(min, base + vw * width, max). The build reads this line to write the
  // matching CSS value (sizes hints, no-JS layout), so keep it on one line.
  var ROW = { min: 220, base: 200, vw: 0.09, max: 440 };

  var MAX_PER_ROW = 12;
  var phone = window.matchMedia('(max-width: 599px)'); // same breakpoint as style.css

  function baseRowHeight(width) {
    return Math.max(ROW.min, Math.min(ROW.max, ROW.base + ROW.vw * width));
  }

  // S / M / L. Phones get a denser S so it really shows three across.
  function sizeFactor(size) {
    if (size === 's') return phone.matches ? 0.45 : 0.6;
    if (size === 'l') return 1.75;
    return 1;
  }

  /**
   * Split photos (aspect ratios) into rows: dynamic programming over every
   * possible set of line breaks, as in typesetting. Each row costs more the
   * further its height is from the target (much more beyond 0.8x / 1.3x, or
   * if a photo would become a sliver), and neighbouring rows cost more the
   * more their heights differ, so the page has an even rhythm. Every row
   * fills the width exactly, except a last row that would be stretched.
   */
  function partition(ratios, width, gap, target, minTile) {
    var n = ratios.length;
    var JUMP = 0.8;
    var prefix = [0];
    for (var i = 0; i < n; i++) prefix.push(prefix[i] + ratios[i]);
    var heightOf = function (s, e) { return (width - gap * (e - s - 1)) / (prefix[e] - prefix[s]); };

    // best[e][k]: lowest cost for photos [0, e) when the last row has k photos.
    var best = [[]];
    var back = [[]];
    for (var e = 1; e <= n; e++) {
      best[e] = [];
      back[e] = [];
      var minRatio = Infinity;
      for (var k = 1; k <= MAX_PER_ROW && k <= e; k++) {
        var s = e - k;
        minRatio = Math.min(minRatio, ratios[s]);
        var h = heightOf(s, e);
        if (h < target * 0.4 && k > 1) break; // more photos only make it shorter
        var stretched = e === n && h > target * 1.3; // last row, left short
        var c = 0;
        if (!stretched) {
          var d = Math.log(h / target); // half the target is as bad as double
          c = d * d * (h > target ? 1.5 : 1);
          if (h > target * 1.3) c += 4 * Math.pow(Math.log(h / (target * 1.3)), 2);
          if (h < target * 0.8) c += 4 * Math.pow(Math.log(h / (target * 0.8)), 2);
          if (k > 1 && h * minRatio < minTile) c += 10; // no slivers
        }
        if (s === 0) {
          best[e][k] = c;
          back[e][k] = 0;
          continue;
        }
        var bestPrev = Infinity;
        var bestK = 0;
        for (var k2 = 1; k2 <= MAX_PER_ROW && k2 <= s; k2++) {
          if (best[s][k2] === undefined) continue;
          var jump = stretched ? 0 : JUMP * Math.pow(Math.log(h / heightOf(s - k2, s)), 2);
          if (best[s][k2] + jump < bestPrev) {
            bestPrev = best[s][k2] + jump;
            bestK = k2;
          }
        }
        if (bestK) {
          best[e][k] = bestPrev + c;
          back[e][k] = bestK;
        }
      }
    }

    var lastK = 0;
    var lowest = Infinity;
    for (var kk = 1; kk <= MAX_PER_ROW && kk <= n; kk++) {
      if (best[n][kk] !== undefined && best[n][kk] < lowest) { lowest = best[n][kk]; lastK = kk; }
    }
    var rows = [];
    for (var end = n, size = lastK; end > 0;) {
      var start = end - size;
      var height = heightOf(start, end);
      var justified = !(end === n && height > target * 1.3);
      rows.unshift({ start: start, end: end, height: justified ? height : target, justified: justified });
      var prev = back[end][size];
      end = start;
      size = prev;
    }
    return rows;
  }

  /* ---- choosing thumbnail files */

  /** Width descriptor of the file an <img> is showing ("…-1200.avif" → 1200). */
  function candidateWidth(img) {
    var match = /-(\d+)\.(?:avif|webp|jpe?g|png)(?:[?#]|$)/i.exec(img.currentSrc || '');
    return match ? Number(match[1]) : 0;
  }

  // Thumbnails stop at 2x density: on 3x phones the difference is invisible
  // at thumbnail size, and the files are less than half the size.
  function density() { return Math.min(window.devicePixelRatio || 1, 2); }

  function setSizes(picture, width) {
    var value = Math.ceil(width * density() / (window.devicePixelRatio || 1)) + 'px';
    each(picture.querySelectorAll('source, img'), function (node) {
      if (node.getAttribute('sizes') !== value) node.setAttribute('sizes', value);
    });
  }

  var pending = typeof WeakMap === 'function' ? new WeakMap() : null;
  var nearby = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        nearby.unobserve(entry.target);
        var w = pending && pending.get(entry.target);
        if (w) upgrade(entry.target.querySelector('picture'), w);
      });
    }, { rootMargin: '100% 0px' })
    : null;

  function upgrade(picture, width) {
    var img = picture.querySelector('img');
    var have = candidateWidth(img);
    if (have && have >= width * density() * 0.98) return;
    setSizes(picture, width);
  }

  /**
   * Keep each thumbnail sharp without ever downloading it twice. A lazy image
   * that hasn't picked a file yet (no currentSrc) gets its exact width.
   * Everything else keeps the estimate it started with: eager images may
   * already have been fetched by the browser's preload scanner, and changing
   * `sizes` mid-download makes browsers fetch the image again. A loaded
   * image is upgraded only if it is genuinely too small (e.g. after switching
   * to L), and only once it is within a screen of the viewport.
   */
  function updateSizes(tile, width) {
    var picture = tile.querySelector('picture');
    var img = picture && picture.querySelector('img');
    if (!img) return;
    if (!img.currentSrc && img.loading === 'lazy') return setSizes(picture, width);
    if (!pending) return;
    pending.set(tile, width);
    if (!(img.complete && img.naturalWidth)) {
      if (!img.dataset.waiting) {
        img.dataset.waiting = '1';
        img.addEventListener('load', function () {
          delete img.dataset.waiting;
          updateSizes(tile, pending.get(tile));
        }, { once: true });
      }
      return;
    }
    var r = tile.getBoundingClientRect();
    var near = r.bottom > -window.innerHeight && r.top < window.innerHeight * 2;
    if (near || !nearby) upgrade(picture, width);
    else nearby.observe(tile);
  }

  /** Lay out the gallery at size 's' | 'm' | 'l'. */
  function layout(gallery, size) {
    // Exact (fractional) width minus 1px of slack for sub-pixel rounding;
    // the last tile of each justified row grows to absorb it.
    var width = gallery.getBoundingClientRect().width - 1;
    if (width <= 0) return;
    var tiles = gallery.querySelectorAll('.tile');
    var ratios = [];
    each(tiles, function (tile) { ratios.push(parseFloat(tile.style.getPropertyValue('--ar')) || 1.5); });
    var gap = parseFloat(getComputedStyle(gallery).columnGap) || 0;
    var factor = sizeFactor(size);
    var target = baseRowHeight(width) * factor;
    var minTile = (phone.matches ? 64 : 80) * Math.min(1, factor + 0.25);
    var rows = partition(ratios, width, gap, target, minTile);

    rows.forEach(function (row) {
      for (var k = row.start; k < row.end; k++) {
        var tile = tiles[k];
        // Floor to 1/100 px so a row can never overflow and wrap early.
        var w = Math.floor(ratios[k] * row.height * 100) / 100;
        tile.style.setProperty('--w', w + 'px');
        tile.style.setProperty('--h', Math.round(row.height * 100) / 100 + 'px');
        tile.classList.toggle('is-row-end', row.justified && k === row.end - 1);
        updateSizes(tile, w);
      }
    });
    gallery.classList.add('is-justified');
  }

  /** Fade thumbnails in as they arrive (only those not already decoded). */
  function fadeIn(gallery) {
    each(gallery.querySelectorAll('.tile img'), function (img) {
      if (img.complete && img.naturalWidth) return;
      img.classList.add('is-loading');
      var done = function () { img.classList.remove('is-loading'); };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  function initGallery() {
    var gallery = document.getElementById('gallery');
    if (!gallery) return null;
    var tiles = Array.prototype.slice.call(gallery.querySelectorAll('.tile'));
    var size = root.getAttribute('data-size') || 'm';
    var lastWidth = 0;
    var frame = 0;

    function relayout() {
      lastWidth = gallery.getBoundingClientRect().width;
      layout(gallery, size);
    }

    fadeIn(gallery);
    relayout();

    function onResize() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        if (Math.abs(gallery.getBoundingClientRect().width - lastWidth) >= 0.5) relayout();
      });
    }
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(gallery);
    else window.addEventListener('resize', onResize);
    if (phone.addEventListener) phone.addEventListener('change', relayout);

    /** The photo nearest the centre of the screen (the one being looked at). */
    function centreTile() {
      var cx = window.innerWidth / 2;
      var cy = window.innerHeight / 2;
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < tiles.length; i++) {
        var r = tiles[i].getBoundingClientRect();
        if (r.bottom < 0) continue;
        if (r.top > window.innerHeight) break;
        var dx = Math.max(r.left - cx, 0, cx - r.right);
        var dy = Math.max(r.top - cy, 0, cy - r.bottom);
        if (dx * dx + dy * dy < bestDist) { best = tiles[i]; bestDist = dx * dx + dy * dy; }
      }
      return best;
    }

    /* ---- S / M / L */
    var control = document.querySelector('.size-control');
    if (control) {
      var buttons = control.querySelectorAll('button[data-size]');
      var syncButtons = function () {
        each(buttons, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-size') === size)); });
      };
      each(buttons, function (button) {
        button.addEventListener('click', function () {
          var next = button.getAttribute('data-size');
          if (next === size) return;
          // Keep the photo in the middle of the screen where it is (unless
          // the page is at the very top, where it simply stays put).
          var anchor = window.scrollY > 0 ? centreTile() : null;
          var before = anchor ? anchor.getBoundingClientRect().top : 0;
          size = next;
          if (size === 'm') root.removeAttribute('data-size');
          else root.setAttribute('data-size', size);
          store.set('gallery-size', size === 'm' ? null : size);
          syncButtons();
          relayout();
          if (anchor) {
            var delta = anchor.getBoundingClientRect().top - before;
            if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
          }
        });
      });
      syncButtons();
      control.classList.add('is-ready');
    }

    return { gallery: gallery, tiles: tiles };
  }

  /* ----------------------------------------------------------------- start */

  initTheme();
  var gallery = initGallery();

  // Shared with viewer.js.
  window.Portfolio = { gallery: gallery && gallery.gallery, tiles: gallery ? gallery.tiles : [], store: store, partition: partition };

  document.addEventListener('DOMContentLoaded', function () {
    var year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  });
})();
