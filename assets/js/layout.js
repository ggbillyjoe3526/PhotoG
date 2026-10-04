/* ==========================================================================
   Portfolio: gallery row layout.

   The build (tools/build.mjs) inlines this file directly after the gallery
   markup, so rows get their final size before the first paint and before any
   lazy image chooses which file to download. Run `npm run build` after
   editing it. main.js reuses it (window.PhotoLayout) on resize and for the
   S/M/L control.
   ========================================================================== */
(function () {
  'use strict';

  // Target row height for a gallery `width` px wide (before the size factor):
  // 220px on phones up to 440px on very large screens.
  // Keep in sync with rowHeightCss() in tools/build.mjs and --row-h in style.css.
  function baseRowHeight(width) {
    return Math.max(220, Math.min(440, 200 + 0.09 * width));
  }

  // S / M / L. Phones get a denser S so it really shows three across.
  function sizeFactor(size, width) {
    if (size === 's') return width < 600 ? 0.45 : 0.6;
    if (size === 'l') return 1.75;
    return 1;
  }

  var MAX_PER_ROW = 12;

  /**
   * Split photos (aspect ratios) into rows whose heights stay close to the
   * target: dynamic programming over all break points, like line breaking in
   * typesetting. Nothing is ever cropped; every row fills the width exactly,
   * except a last row that would have to be stretched too tall.
   */
  function partition(ratios, width, gap, target, minTile) {
    var n = ratios.length;
    var cost = [0];
    var from = [0];

    for (var end = 1; end <= n; end++) {
      cost[end] = Infinity;
      var sum = 0;
      var minRatio = Infinity;
      for (var start = end - 1; start >= 0 && end - start <= MAX_PER_ROW; start--) {
        sum += ratios[start];
        minRatio = Math.min(minRatio, ratios[start]);
        var count = end - start;
        var h = (width - gap * (count - 1)) / sum;
        if (h < target * 0.4 && count > 1) break; // more photos only make it shorter
        var c = 0;
        if (end !== n || h <= target * 1.3) {
          var d = Math.log(h / target); // half the target is as bad as double
          c = d * d * (h > target ? 1.5 : 1);
          if (h > target * 1.3) c += 4 * Math.pow(Math.log(h / (target * 1.3)), 2);
          if (h < target * 0.8) c += 4 * Math.pow(Math.log(h / (target * 0.8)), 2);
          if (count > 1 && h * minRatio < minTile) c += 10; // no slivers
        }
        if (cost[start] + c < cost[end]) {
          cost[end] = cost[start] + c;
          from[end] = start;
        }
      }
    }

    var rows = [];
    for (var e = n; e > 0; e = from[e]) {
      var s = from[e];
      var total = 0;
      for (var i = s; i < e; i++) total += ratios[i];
      var height = (width - gap * (e - s - 1)) / total;
      var justified = !(e === n && height > target * 1.3);
      rows.unshift({ start: s, end: e, height: justified ? height : target, justified: justified });
    }
    return rows;
  }

  /** Width descriptor of the file an <img> is showing ("…-1200.avif" → 1200). */
  function candidateWidth(img) {
    var match = /-(\d+)\.(?:avif|webp|jpe?g|png)(?:[?#]|$)/i.exec(img.currentSrc || '');
    return match ? Number(match[1]) : 0;
  }

  function setSizes(picture, width) {
    var value = Math.ceil(width) + 'px';
    var nodes = picture.querySelectorAll('source, img');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('sizes') !== value) nodes[i].setAttribute('sizes', value);
    }
  }

  /**
   * Keep each thumbnail sharp without ever downloading it twice. A lazy image
   * that hasn't picked a file yet (off screen: no currentSrc) gets its exact
   * width. Everything else keeps the estimate it started with: eager images
   * may already have been fetched by the browser's preload scanner, and
   * changing `sizes` mid-download makes browsers fetch the image again. Once
   * loaded, an image is upgraded only if it is genuinely too small (e.g.
   * after switching to L).
   */
  var pendingWidth = typeof WeakMap === 'function' ? new WeakMap() : null;

  function updateSizes(picture, width) {
    var img = picture && picture.querySelector('img');
    if (!img) return;
    if (!img.currentSrc && img.loading === 'lazy') return setSizes(picture, width);
    if (!(img.complete && img.naturalWidth)) {
      if (!pendingWidth) return;
      if (!pendingWidth.has(img)) {
        img.addEventListener('load', function () {
          var w = pendingWidth.get(img);
          pendingWidth['delete'](img);
          updateSizes(picture, w);
        }, { once: true });
      }
      pendingWidth.set(img, width);
      return;
    }
    var have = candidateWidth(img);
    if (have && have >= width * (window.devicePixelRatio || 1) * 0.98) return;
    setSizes(picture, width);
  }

  /** Lay out the gallery at size 's' | 'm' | 'l'. Returns the width used. */
  function layout(gallery, size) {
    // Exact (fractional) width minus 1px of slack for sub-pixel rounding;
    // the last tile of each justified row grows to absorb it.
    var width = gallery.getBoundingClientRect().width - 1;
    if (width <= 0) return 0;
    var tiles = gallery.querySelectorAll('.tile');
    var ratios = [];
    for (var i = 0; i < tiles.length; i++) {
      ratios.push(parseFloat(tiles[i].style.getPropertyValue('--ar')) || 1.5);
    }
    var gap = parseFloat(getComputedStyle(gallery).columnGap) || 0;
    var target = baseRowHeight(width) * sizeFactor(size, width);
    var rows = partition(ratios, width, gap, target, width < 600 ? 64 : 80);

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var k = row.start; k < row.end; k++) {
        var tile = tiles[k];
        // Floor to 1/100 px so a row can never overflow and wrap early.
        var w = Math.floor(ratios[k] * row.height * 100) / 100;
        tile.style.setProperty('--w', w + 'px');
        tile.style.setProperty('--h', Math.round(row.height * 100) / 100 + 'px');
        tile.classList.toggle('is-row-end', row.justified && k === row.end - 1);
        updateSizes(tile.querySelector('picture'), w);
      }
    }
    gallery.classList.add('is-justified');
    return width;
  }

  /** Fade thumbnails in as they arrive (only those not already decoded). */
  function fadeIn(gallery) {
    var imgs = gallery.querySelectorAll('.tile img');
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        if (img.complete && img.naturalWidth) return;
        img.classList.add('is-loading');
        var done = function () { img.classList.remove('is-loading'); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      })(imgs[i]);
    }
  }

  window.PhotoLayout = { layout: layout, partition: partition };

  var gallery = document.getElementById('gallery');
  if (gallery) {
    fadeIn(gallery);
    layout(gallery, document.documentElement.getAttribute('data-size') || 'm');
  }
})();
