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
        var label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
        button.setAttribute('aria-label', label);
        button.title = label;
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

  // Page geometry. gutter, gap and page mirror style.css (--gutter, --gap and
  // the 2200px page width; a test checks they match) and phone is its
  // breakpoint. The build reads this line too, to work out how wide the first
  // photos will be before any script runs, so keep it on one line.
  var LAYOUT = { gutter: [16, 0.032, 48], gap: [6, 0.0075, 12], page: 2200, phone: 599, minTile: [64, 80], chrome: 84, fit: 0.9 };

  var MAX_PER_ROW = 12;
  var phone = window.matchMedia('(max-width: ' + LAYOUT.phone + 'px)');

  function viewportHeight() { return document.documentElement.clientHeight || window.innerHeight; }

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
   * fills the width exactly, except a last row that would be stretched too
   * tall: that one is drawn no taller than the row above it, and costs more
   * the emptier it is (most of all a single photo), so earlier rows
   * rebalance to give the gallery a good ending.
   */
  function partition(ratios, width, gap, target, minTile, maxH) {
    var n = ratios.length;
    var JUMP = 0.8;    // uneven neighbouring rows
    var LAST = 1.2;    // an unfilled last row
    var SINGLE = 0.5;  // ... holding a single photo
    var prefix = [0];
    for (var i = 0; i < n; i++) prefix.push(prefix[i] + ratios[i]);
    var heightOf = function (s, e) { return (width - gap * (e - s - 1)) / (prefix[e] - prefix[s]); };
    var lastHeight = function (prevHeight) { return Math.min(target, prevHeight || target); };

    // best[e][k]: lowest cost for photos [0, e) when the last row has k photos.
    // For the gallery's last row there are two ways to draw it: justified
    // (full width) or left part-filled at the height of the row above;
    // `open[k]` remembers which was cheaper.
    var best = [[]];
    var back = [[]];
    var open = [];
    for (var e = 1; e <= n; e++) {
      best[e] = [];
      back[e] = [];
      var minRatio = Infinity;
      for (var k = 1; k <= MAX_PER_ROW && k <= e; k++) {
        var s = e - k;
        minRatio = Math.min(minRatio, ratios[s]);
        var h = heightOf(s, e);
        if (h < target * 0.4 && k > 1) break; // more photos only make it shorter
        var isLast = e === n;
        var mustOpen = isLast && h > target * 1.3; // justified would be far too tall
        var c = Infinity;
        if (!mustOpen) {
          var d = Math.log(h / target); // half the target is as bad as double
          c = d * d * (h > target ? 1.5 : 1);
          if (h > target * 1.3) c += 4 * Math.pow(Math.log(h / (target * 1.3)), 2);
          if (h < target * 0.8) c += 4 * Math.pow(Math.log(h / (target * 0.8)), 2);
          if (k > 1 && h * minRatio < minTile) c += 10; // no slivers
          // Taller than the screen (a phone held sideways): only as a last resort.
          if (maxH && h > maxH) c += 20 + 50 * Math.pow(Math.log(h / maxH), 2);
        }
        var sum = prefix[e] - prefix[s];
        var openCost = function (drawn) {
          var fill = Math.min(1, (sum * drawn + gap * (k - 1)) / width);
          return LAST * Math.pow(1 - fill, 2) + (k === 1 && n > 1 ? SINGLE : 0);
        };
        // Cost of this row after a previous row of height prevH (0: first row).
        var rowCost = function (prevH) {
          var justified = c;
          if (prevH && c < Infinity) {
            var j = Math.log(h / prevH);
            // Ending taller than the row above costs extra: the gallery
            // shouldn't finish on its biggest pictures.
            justified += (isLast && j > 0 ? JUMP * 3 : JUMP) * j * j;
          }
          if (!isLast) return { cost: justified, open: false };
          var drawn = lastHeight(prevH);
          var o = openCost(drawn) + (prevH ? JUMP * Math.pow(Math.log(drawn / prevH), 2) : 0);
          return o < justified && h > drawn ? { cost: o, open: true } : { cost: justified, open: false };
        };
        if (s === 0) {
          var first = rowCost(0);
          best[e][k] = first.cost;
          back[e][k] = 0;
          if (isLast) open[k] = first.open;
          continue;
        }
        var bestTotal = Infinity;
        var bestK = 0;
        var bestOpen = false;
        for (var k2 = 1; k2 <= MAX_PER_ROW && k2 <= s; k2++) {
          if (best[s][k2] === undefined) continue;
          var r = rowCost(heightOf(s - k2, s));
          if (best[s][k2] + r.cost < bestTotal) {
            bestTotal = best[s][k2] + r.cost;
            bestK = k2;
            bestOpen = r.open;
          }
        }
        if (bestK) {
          best[e][k] = bestTotal;
          back[e][k] = bestK;
          if (isLast) open[k] = bestOpen;
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
      rows.unshift({ start: start, end: end, height: heightOf(start, end), justified: true });
      var prev = back[end][size];
      end = start;
      size = prev;
    }
    var last = rows[rows.length - 1];
    if (last && open[lastK]) {
      last.justified = false;
      last.height = lastHeight(rows.length > 1 ? rows[rows.length - 2].height : 0);
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

  /**
   * The first photos start with the build's per-screen-size `sizes`, which
   * the browser re-evaluates whenever the window changes (e.g. on rotation),
   * fetching new files. Once one has loaded, pin `sizes` to the file it
   * shows; from then on only upgrade() asks for more, within the 2x cap.
   */
  function freeze(img, picture) {
    if (img.dataset.frozen || img.loading === 'lazy') return;
    var apply = function () {
      var have = candidateWidth(img);
      if (!have) return;
      img.dataset.frozen = '1';
      var value = Math.max(1, Math.floor(have / (window.devicePixelRatio || 1))) + 'px';
      each(picture.querySelectorAll('source, img'), function (node) { node.setAttribute('sizes', value); });
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
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
    freeze(img, picture);
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
    // On short screens (a phone held sideways) a row, with its caption,
    // should fit on the screen.
    var maxH = viewportHeight() - LAYOUT.chrome; // room for captions
    target = Math.min(target, maxH * LAYOUT.fit);
    var minTile = LAYOUT.minTile[phone.matches ? 0 : 1] * Math.min(1, factor + 0.25);
    var rows = partition(ratios, width, gap, target, minTile, maxH);

    rows.forEach(function (row) {
      for (var k = row.start; k < row.end; k++) {
        var tile = tiles[k];
        // Floor to 1/100 px so a row can never overflow and wrap early.
        var w = Math.floor(ratios[k] * row.height * 100) / 100;
        tile.style.setProperty('--w', w + 'px');
        tile.style.setProperty('--h', Math.round(row.height * 100) / 100 + 'px');
        tile.classList.toggle('is-row-end', row.justified && k === row.end - 1);
        tile.classList.toggle('is-narrow', w < 170); // just the frame number
        updateSizes(tile, w);
      }
    });
    gallery.classList.add('is-justified');
  }

  /** Fade thumbnails in as they arrive (only those not already decoded).
   *  The first row (eager) appears as soon as it can: no fade to wait for. */
  function fadeIn(gallery) {
    each(gallery.querySelectorAll('.tile img[loading="lazy"]'), function (img) {
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

    var lastHeight = 0;

    function relayout() {
      lastWidth = gallery.getBoundingClientRect().width;
      lastHeight = viewportHeight();
      try {
        layout(gallery, size);
      } catch (e) {
        gallery.classList.add('layout-failed'); // the CSS grid takes over; photos still load
        throw e;
      }
    }

    fadeIn(gallery);
    relayout();

    function onResize(force) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        // Behind an open viewer the gallery's width is held; the viewer
        // calls relayout() itself when it closes (see viewer.js).
        if (root.classList.contains('viewer-open')) return;
        var widthChanged = force === true || Math.abs(gallery.getBoundingClientRect().width - lastWidth) >= 0.5;
        // Height only matters for the short-screen cap; ignore small changes
        // such as a phone's address bar showing and hiding while scrolling.
        var heightChanged = Math.abs(viewportHeight() - lastHeight) > lastHeight * 0.25;
        if (!widthChanged && !heightChanged) return;
        // Keep the photo that was in the middle of the screen there (e.g.
        // when a phone is turned, the screen's height changes too).
        // (The window has already changed size: find the photo using the
        // middle of the screen as it was.)
        var anchor = window.scrollY > 0 ? centreTile(lastHeight / 2) : null;
        relayout();
        if (anchor) {
          var r = anchor.getBoundingClientRect();
          var delta = r.height < window.innerHeight ? r.top + r.height / 2 - window.innerHeight / 2 : r.top - 16;
          if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: 'instant' });
        }
      });
    }
    if ('ResizeObserver' in window) new ResizeObserver(function () { onResize(); }).observe(gallery);
    window.addEventListener('resize', function () { onResize(); });
    if (phone.addEventListener) phone.addEventListener('change', function () { onResize(true); });

    /** The photo nearest the centre of the screen (the one being looked at). */
    function centreTile(midY) {
      var cx = window.innerWidth / 2;
      var cy = midY == null ? window.innerHeight / 2 : midY;
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

    return { gallery: gallery, tiles: tiles, relayout: relayout };
  }

  /* ----------------------------------------------------------------- start */

  initTheme();
  var gallery = initGallery();

  // Shared with viewer.js.
  var shared = window.Portfolio = {
    gallery: gallery && gallery.gallery, tiles: gallery ? gallery.tiles : [], store: store, partition: partition,
    relayout: gallery ? gallery.relayout : function () {},
    viewerReady: false, heldLink: null,
  };

  // A photo clicked before viewer.js has arrived (slow connection): wait for
  // the viewer to open it, rather than leaving the page for the bare JPEG.
  // If the viewer can't load (or takes over 3 s), follow the link after all.
  if (shared.gallery) {
    var holdTimer = 0;
    var follow = function () {
      var link = shared.heldLink;
      shared.heldLink = null;
      if (link) { link.classList.remove('is-holding'); window.location.href = link.href; }
    };
    shared.gallery.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('.tile-link');
      if (!link || shared.viewerReady || root.classList.contains('no-viewer')) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (shared.heldLink) shared.heldLink.classList.remove('is-holding');
      shared.heldLink = link;
      link.classList.add('is-holding'); // "on its way"
      clearTimeout(holdTimer);
      holdTimer = setTimeout(follow, 3000);
    });
    // Set by the viewer <script>'s onerror in index.html.
    window.addEventListener('portfolio:no-viewer', follow);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  });
})();
