/* ==========================================================================
   Portfolio: viewer.js
   Full-screen photo viewer. Loaded with `defer`, so it runs after page.js
   (inlined after the gallery) has set up window.Portfolio.

   - Opens from a thumbnail (zooms out of it, and back into it on close).
   - Shows a sharp copy sized to the screen, with the thumbnail as an instant
     preview, and preloads the neighbours.
   - Keyboard: ←/→, Home/End, I (details), Z (zoom), Esc.
     Mouse: click the photo to zoom, the side strips to move, beside the
     photo to close.
     Touch: tap to show/hide the controls, double-tap or pinch to zoom,
     swipe sideways (the next photo slides in alongside), swipe down to close.
   - Every photo has a link (#photo-<name>); Back closes the viewer.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;

  var ICONS = {
    prev: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    info: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75v.01"/></svg>',
    zoom: '<svg class="icon icon-zoom-in" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M10.5 7.5v6M7.5 10.5h6"/></svg>' +
      '<svg class="icon icon-zoom-out" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M7.5 10.5h6"/></svg>',
  };

  var EXIF_FIELDS = [
    ['camera', 'Camera'],
    ['lens', 'Lens'],
    ['focal', 'Focal length'],
    ['aperture', 'Aperture'],
    ['shutter', 'Shutter'],
    ['iso', 'ISO'],
  ];

  var COMPACT_HEIGHT = 500; // below this (landscape phones) controls float over the photo
  var EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  /** Largest width offered by a srcset ("a-480.jpg 480w, a-1600.jpg 1600w" → 1600). */
  function largestWidth(srcset) {
    var max = 0;
    (srcset || '').split(',').forEach(function (c) {
      var w = parseInt(c.trim().split(/\s+/)[1], 10);
      if (w > max) max = w;
    });
    return max;
  }

  function init(galleryApi, store) {
    var dataNode = document.getElementById('gallery-data');
    if (!galleryApi || !dataNode || typeof HTMLDialogElement !== 'function') return;

    var photos;
    try { photos = JSON.parse(dataNode.textContent); } catch (e) { return; }
    var tiles = galleryApi.tiles;
    if (!photos.length || photos.length !== tiles.length) return;

    var total = photos.length;
    var digits = Math.max(2, String(total).length);
    var pad = function (n) { return String(n).padStart(digits, '0'); };

    /* ------------------------------------------------------------ markup */
    // Close comes first in the Tab order; CSS places it top right.
    var dialog = el('dialog', 'viewer');
    dialog.tabIndex = -1;
    dialog.innerHTML =
      '<div class="viewer-top">' +
        '<div class="viewer-tools">' +
          '<button type="button" class="viewer-btn" data-action="close" aria-label="Close viewer" title="Close (Esc)">' + ICONS.close + '</button>' +
          '<button type="button" class="viewer-btn" data-action="info" aria-pressed="true" aria-controls="viewer-info" aria-label="Details" title="Details (I)">' + ICONS.info + '</button>' +
          '<button type="button" class="viewer-btn" data-action="zoom" aria-pressed="false" aria-label="Zoom to full resolution" title="Zoom (Z)">' + ICONS.zoom + '</button>' +
        '</div>' +
        '<p class="viewer-count">' +
          '<button type="button" class="viewer-btn" data-action="prev" aria-label="Previous photo">' + ICONS.prev + '</button>' +
          '<span class="viewer-pos"><strong class="viewer-index">01</strong><span class="sep" aria-hidden="true">/</span><span class="visually-hidden"> of </span><span class="viewer-total">' + pad(total) + '</span></span>' +
          '<button type="button" class="viewer-btn" data-action="next" aria-label="Next photo">' + ICONS.next + '</button>' +
        '</p>' +
      '</div>' +
      '<div class="viewer-stage">' +
        '<div class="viewer-frame"><img class="viewer-preview" alt="" aria-hidden="true"></div>' +
        '<div class="viewer-peek" aria-hidden="true" hidden><img alt=""></div>' +
        '<button type="button" class="viewer-side prev" data-action="prev" aria-label="Previous photo" title="Previous (←)">' + ICONS.prev + '</button>' +
        '<button type="button" class="viewer-side next" data-action="next" aria-label="Next photo" title="Next (→)">' + ICONS.next + '</button>' +
      '</div>' +
      '<div class="viewer-info" id="viewer-info" role="region" aria-label="About this photo">' +
        '<div class="viewer-text">' +
          '<h2 class="viewer-title"></h2>' +
          '<p class="viewer-meta"></p>' +
          '<p class="viewer-caption"></p>' +
        '</div>' +
        '<dl class="viewer-exif"></dl>' +
      '</div>' +
      '<p class="visually-hidden" aria-live="polite" aria-atomic="true"></p>';
    document.body.appendChild(dialog);

    var q = function (sel) { return dialog.querySelector(sel); };
    var top = q('.viewer-top');
    var stage = q('.viewer-stage');
    var frame = q('.viewer-frame');
    var preview = q('.viewer-preview');
    var info = q('.viewer-info');
    var indexEl = q('.viewer-index');
    var titleEl = q('.viewer-title');
    var metaEl = q('.viewer-meta');
    var captionEl = q('.viewer-caption');
    var exifEl = q('.viewer-exif');
    var statusEl = q('[aria-live]');
    var infoButton = q('[data-action="info"]');
    var toolsGroup = q('.viewer-tools');
    var countGroup = q('.viewer-count');
    var zoomButton = q('[data-action="zoom"]');
    // An invisible copy of the details panel, used to measure every photo's
    // details without touching the visible one.
    var measure = info.cloneNode(true);
    measure.removeAttribute('id');
    measure.removeAttribute('role');
    measure.removeAttribute('aria-label');
    measure.setAttribute('aria-hidden', 'true');
    measure.classList.add('viewer-measure');
    dialog.appendChild(measure);

    var current = -1;
    var full = null;          // the sharp <picture> for the current photo
    var fit = null;           // the photo's fitted rect inside the dialog
    var loadToken = 0;
    var slowTimer = 0;
    var fullTimer = 0;
    var lastShow = 0;
    var preloaded = {};       // photos whose sharp file is (likely) cached
    var pushedState = false;  // did opening add a history entry?
    var closing = false;
    var closeAnim = null;
    var closeFrame = 0;
    var zoom = null;          // { s, x, y } while zoomed
    var infoReserve = { width: 0, height: 0 };

    /* ----------------------------------------------------------- helpers */
    function tilePicture(i) { return tiles[i].querySelector('picture'); }

    function sources(i) {
      var picture = tilePicture(i);
      var source = picture && picture.querySelector('source[type="image/avif"]');
      var img = picture && picture.querySelector('img');
      return {
        avif: source ? source.getAttribute('srcset') : '',
        jpeg: img ? img.getAttribute('srcset') : '',
        src: img ? img.getAttribute('src') : '',
        alt: img ? img.getAttribute('alt') : '',
        thumb: img && img.complete && img.naturalWidth ? img.currentSrc || img.src : '',
      };
    }

    function infoVisible() { return !dialog.classList.contains('is-info-hidden'); }
    function dpr() { return window.devicePixelRatio || 1; }

    /** Height to reserve for the details panel: the tallest of all photos at
     *  this width, so the photo doesn't change size from one to the next. */
    function reserveForInfo(width) {
      if (infoReserve.width === width) return infoReserve.height;
      var max = 0;
      for (var i = 0; i < total; i++) {
        renderInfo(photos[i], measure);
        max = Math.max(max, Math.ceil(measure.getBoundingClientRect().height)); // not rounded down
      }
      infoReserve = { width: width, height: max };
      return max;
    }

    /** Space around the photo: controls, side arrows and safe areas. */
    function insets() {
      var W = dialog.clientWidth;
      var H = dialog.clientHeight;
      var compact = H <= COMPACT_HEIGHT;
      dialog.classList.toggle('is-compact', compact);
      var cs = getComputedStyle(stage);
      var safe = {
        t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
        b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0,
      };
      var side = parseFloat(getComputedStyle(dialog).getPropertyValue('--side')) || 0;
      var immersive = dialog.classList.contains('is-immersive');
      if (compact) {
        // Short landscape screens: the controls float over the photo and the
        // details become a column on the right (most photos are limited by
        // the height here, so the column costs them nothing).
        var column = infoVisible() && !immersive ? info.offsetWidth : 0;
        // (The column already pads itself for the right-hand safe area.)
        return { W: W, H: H, t: safe.t, b: safe.b, l: side + safe.l, r: side + (column ? column : safe.r) };
      }
      var t = immersive ? safe.t : top.offsetHeight;
      var b = t; // no details: the photo is centred on the screen
      if (!immersive && infoVisible()) {
        // The details get the room their tallest entry needs, but at most
        // about a quarter of the screen, unless the photo wouldn't use that
        // space anyway (a landscape photo on a phone is limited by width).
        b = reserveForInfo(W);
        var cap = Math.round(H * 0.26);
        if (b > cap && current >= 0) {
          var p = photos[current];
          var photoH = Math.min(W - side * 2 - safe.l - safe.r, p.width) * p.height / p.width;
          b = Math.max(cap, Math.min(b, H - t - photoH));
        }
      }
      dialog.style.setProperty('--info-max', b + 'px');
      return { W: W, H: H, t: t, b: b, l: side + safe.l, r: side + safe.r };
    }

    /** Fitted rect for photo i (whole pixels; height follows width exactly). */
    function fitFor(i, box) {
      var p = photos[i];
      var ratio = p.width / p.height;
      var availW = Math.max(1, box.W - box.l - box.r);
      var availH = Math.max(1, box.H - box.t - box.b);
      var w, h;
      if (availH * ratio <= Math.min(availW, p.width)) {
        h = Math.floor(Math.min(availH, p.height));
        w = Math.min(Math.round(h * ratio), Math.floor(availW));
      } else {
        w = Math.floor(Math.min(availW, p.width));
        h = Math.min(Math.round(w / ratio), Math.floor(availH));
      }
      // A photo within a few pixels of the edges goes all the way, rather
      // than leaving thin slivers of background.
      if (availW - w > 0 && availW - w <= 8 && w < p.width) w = Math.floor(availW);
      if (availH - h > 0 && availH - h <= 8 && h < p.height) h = Math.floor(availH);
      return {
        x: Math.round(box.l + (availW - w) / 2),
        y: Math.round(box.t + (availH - h) / 2),
        w: Math.max(1, w),
        h: Math.max(1, h),
      };
    }

    function placeFrame(rect) {
      fit = rect;
      frame.style.left = rect.x + 'px';
      frame.style.top = rect.y + 'px';
      frame.style.width = rect.w + 'px';
      frame.style.height = rect.h + 'px';
      // Side arrows: full-height strips beside the photo area.
      dialog.style.setProperty('--strip-top', insets.cache.t + 'px');
      dialog.style.setProperty('--strip-bottom', insets.cache.b + 'px');
    }
    insets.cache = { t: 0, b: 0 };

    /** Display width the sharp image is chosen for (zoom and pinch included). */
    function wantedWidth() {
      if (!fit) return 0;
      return Math.ceil(fit.w * (zoom ? Math.max(1, zoom.s) : 1));
    }

    /** Point the sharp image at a width; only ever asks for more pixels. */
    function setFullSizes(width) {
      if (!full) return;
      each(full.querySelectorAll('source, img'), function (node) {
        var now = parseInt(node.getAttribute('sizes'), 10) || 0;
        if (width > now) node.setAttribute('sizes', width + 'px');
      });
    }

    /** Where the photo is on screen (zoomed: where it is zooming to). */
    function photoRect() {
      if (!fit) return null;
      var x = zoom ? zoom.x : fit.x;
      var y = zoom ? zoom.y : fit.y;
      var s = zoom ? zoom.s : 1;
      return { left: x, top: y, right: x + fit.w * s, bottom: y + fit.h * s };
    }

    /** Controls get a dark backing only where they float over the photo
     *  (the counter and the buttons each on their own; a sliver of overlap at
     *  a photo's edge doesn't count). */
    function updateOverlap() {
      var r = photoRect();
      [toolsGroup, countGroup].forEach(function (el) {
        var b = el.getBoundingClientRect();
        var over = !!r && b.width > 0 &&
          Math.min(b.right, r.right) - Math.max(b.left, r.left) > 12 &&
          Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 12;
        el.classList.toggle('is-over-photo', over);
      });
    }

    /** A details panel that overflows can scroll (with a fade) and take focus. */
    function updateInfoScroll() {
      var scrollable = info.scrollHeight > info.clientHeight + 1;
      info.classList.toggle('is-scrollable', scrollable);
      if (scrollable) info.tabIndex = 0;
      else info.removeAttribute('tabindex');
    }

    function refit(animate) {
      if (current < 0) return;
      var before = frame.getBoundingClientRect();
      var box = insets();
      insets.cache = box;
      placeFrame(fitFor(current, box));
      setFullSizes(wantedWidth());
      updateZoomButton();
      updateOverlap();
      updateInfoScroll();
      if (animate && !zoom && !reducedMotion() && frame.animate && before.width) {
        var after = frame.getBoundingClientRect();
        frame.animate([
          { transformOrigin: '0 0', transform: 'translate(' + (before.left - after.left) + 'px,' + (before.top - after.top) + 'px) scale(' + before.width / after.width + ',' + before.height / after.height + ')' },
          { transformOrigin: '0 0', transform: 'none' },
        ], { duration: 260, easing: EASE });
      }
    }

    function renderInfo(photo, target) {
      var root = target || info;
      var titleEl = root.querySelector('.viewer-title');
      var metaEl = root.querySelector('.viewer-meta');
      var captionEl = root.querySelector('.viewer-caption');
      var exifEl = root.querySelector('.viewer-exif');
      titleEl.textContent = photo.title || '';
      metaEl.textContent = '';
      [photo.location, photo.date].filter(Boolean).forEach(function (part, n) {
        if (n) metaEl.appendChild(el('span', 'meta-sep', ' · '));
        var span = el('span', 'meta-part');
        span.textContent = part;
        metaEl.appendChild(span);
      });
      captionEl.textContent = photo.caption && photo.caption !== photo.title ? photo.caption : '';
      exifEl.textContent = '';
      var exif = photo.exif || {};
      EXIF_FIELDS.forEach(function (field) {
        var value = exif[field[0]];
        if (!value) return;
        if (field[0] === 'focal' && exif.focal35) value += ' (' + exif.focal35 + ' eq.)';
        if (field[0] === 'iso') value = value.replace(/^ISO\s*/i, '');
        var group = el('div', 'exif-' + field[0]);
        var dt = el('dt');
        var dd = el('dd');
        dt.textContent = field[1];
        dd.textContent = value;
        group.appendChild(dt);
        group.appendChild(dd);
        exifEl.appendChild(group);
      });
    }

    function preload(i) {
      if (i < 0 || i >= total || !fit) return;
      var s = sources(i);
      var img = new Image();
      img.decoding = 'async';
      img.sizes = fitFor(i, insets.cache).w + 'px';
      // An <img> can't take <source>s, so pick the format the page is using.
      var usingAvif = /\.avif(?:[?#]|$)/.test((tiles[current].querySelector('img') || {}).currentSrc || '');
      img.srcset = usingAvif && s.avif ? s.avif : s.jpeg;
      preloaded[i] = true;
    }

    /* -------------------------------------------------------------- show */
    function show(i, opening) {
      i = Math.max(0, Math.min(total - 1, i));
      var now = Date.now();
      // Flicking through quickly: wait a moment before fetching each sharp
      // file (the thumbnail preview covers the gap), unless it's preloaded.
      var wait = !opening && !preloaded[i] && now - lastShow < 400;
      lastShow = now;
      endZoom(false);
      current = i;
      var photo = photos[i];
      var s = sources(i);
      var token = ++loadToken;

      indexEl.textContent = pad(i + 1);
      each(dialog.querySelectorAll('[data-action="prev"]'), function (b) { b.setAttribute('aria-disabled', String(i === 0)); });
      each(dialog.querySelectorAll('[data-action="next"]'), function (b) { b.setAttribute('aria-disabled', String(i === total - 1)); });
      renderInfo(photo);
      var position = 'Photo ' + (i + 1) + ' of ' + total;
      dialog.setAttribute('aria-label', photo.title ? photo.title + ', ' + position.toLowerCase() : position);
      // On open the dialog's own name is announced; announce changes after that.
      statusEl.textContent = opening ? '' : position + (photo.title ? ': ' + photo.title : '');

      frame.getAnimations && frame.getAnimations().forEach(function (a) { a.cancel(); });
      hidePeek();
      frame.style.transform = '';
      frame.style.opacity = '';
      frame.style.setProperty('--tint', photo.tint || 'transparent');
      frame.classList.remove('is-loaded', 'is-slow');
      if (full) { full.remove(); full = null; } // before refit, which resizes `full`
      fullFailed = false;
      refit(false);

      // Instant preview from the thumbnail already on screen, if loaded.
      if (s.thumb) { preview.src = s.thumb; preview.hidden = false; }
      else {
        preview.removeAttribute('src');
        preview.hidden = true;
        // e.g. opened from a shared link before the thumbnail loaded: use it
        // as soon as it arrives, if the sharp file hasn't beaten it.
        var tileImg = tilePicture(i).querySelector('img');
        tileImg.addEventListener('load', function () {
          if (token !== loadToken || !full || !full.classList.contains('is-loading')) return;
          preview.src = tileImg.currentSrc || tileImg.src;
          preview.hidden = false;
        }, { once: true });
      }

      full = el('picture', 'viewer-full is-loading');
      var source = el('source');
      source.type = 'image/avif';
      var img = el('img');
      img.alt = s.alt || photo.title || '';
      img.decoding = 'async';
      if ('fetchPriority' in img) img.fetchPriority = 'high';
      if (s.avif) full.appendChild(source);
      full.appendChild(img);

      clearTimeout(fullTimer);
      // Every attribute is set before the picture joins the page; otherwise
      // the browser briefly assumes full screen width and fetches too big.
      var picture = full;
      var load = function () {
        if (token !== loadToken) return;
        var sizes = wantedWidth() + 'px';
        img.sizes = sizes;
        img.srcset = s.jpeg;
        img.src = s.src;
        source.sizes = sizes;
        source.srcset = s.avif;
        frame.appendChild(picture);
      };
      if (wait) fullTimer = setTimeout(load, 200);
      else load();

      clearTimeout(slowTimer);
      slowTimer = setTimeout(function () {
        if (token === loadToken) frame.classList.add('is-slow');
      }, 450);

      var reveal = function () {
        if (token !== loadToken) return;
        clearTimeout(slowTimer);
        frame.classList.remove('is-slow');
        frame.classList.add('is-loaded');
        full.classList.remove('is-loading');
        // Preload the neighbours once this photo has been looked at for a
        // moment (not while flicking past it).
        setTimeout(function () {
          if (token !== loadToken) return;
          preload(i + 1);
          preload(i - 1);
        }, 300);
      };
      img.addEventListener('load', function () {
        if (img.decode) img.decode().then(reveal, reveal);
        else reveal();
      }, { once: true });
      // A file that fails: try the JPEG once (if the AVIF failed), otherwise
      // keep the preview rather than show a broken image.
      img.addEventListener('error', function onError() {
        if (token !== loadToken) return;
        if (source.parentNode) {
          source.remove();
          img.addEventListener('error', onError, { once: true });
          return;
        }
        clearTimeout(slowTimer);
        frame.classList.remove('is-slow');
        if (full === picture) { full.remove(); full = null; fullFailed = true; updateZoomButton(); }
      }, { once: true });
    }

    function hashFor(i) { return '#' + tiles[i].id; }

    function indexFromHash() {
      var id = '';
      try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return -1; }
      if (!id) return -1;
      for (var i = 0; i < tiles.length; i++) if (tiles[i].id === id) return i;
      return -1;
    }

    /* -------------------------------------------- open, navigate, close */

    /** On-screen rect of a tile's image, or null if it isn't visible. */
    function thumbRect(i) {
      var picture = tilePicture(i);
      if (!picture) return null;
      var r = picture.getBoundingClientRect();
      if (!r.width || r.bottom <= 0 || r.top >= window.innerHeight) return null;
      return r;
    }

    function zoomBetween(from, to) {
      return 'translate(' + (from.left - to.left) + 'px, ' + (from.top - to.top) + 'px) ' +
        'scale(' + from.width / to.width + ', ' + from.height / to.height + ')';
    }

    function focusDialog() {
      if (dialog.open && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    }

    function open(i, options) {
      options = options || {};
      if (!dialog.open) {
        // The page loses its scrollbar gutter while the viewer is open (so
        // the viewer can use the whole window); hold the gallery's width so
        // nothing behind it re-flows.
        galleryApi.gallery.style.width = galleryApi.gallery.getBoundingClientRect().width + 'px';
        root.classList.add('viewer-open');
        dialog.classList.remove('is-immersive', 'is-closing', 'is-zoomed');
        dialog.showModal();
        // Focus the viewer itself: arrows work at once, and no focus ring
        // sits on a button. Close is the first Tab stop.
        dialog.focus({ preventScroll: true });
        show(i, true);
        if (options.zoom && !reducedMotion() && frame.animate) {
          var from = thumbRect(i);
          var to = frame.getBoundingClientRect();
          if (from && to.width) {
            var source = tilePicture(i);
            source.style.visibility = 'hidden'; // no second copy under the zooming photo
            var grow = frame.animate([
              { transformOrigin: '0 0', transform: zoomBetween(from, to) },
              { transformOrigin: '0 0', transform: 'none' },
            ], { duration: 320, easing: EASE });
            grow.onfinish = grow.oncancel = function () { source.style.visibility = ''; };
          }
        }
      } else {
        show(i);
      }
      if (options.push) {
        // We scroll the page ourselves on close; don't let the browser
        // restore the old position over it.
        try { history.scrollRestoration = 'manual'; } catch (e) { /* old browsers */ }
        history.pushState({ viewer: true }, '', hashFor(i));
        pushedState = true;
      }
    }

    function go(delta) {
      var next = current + delta;
      if (!delta || closing || current < 0 || next < 0 || next >= total) return false;
      show(next);
      history.replaceState(history.state, '', hashFor(next));
      return true;
    }

    /** Reset everything once the dialog has closed; focus the photo's tile. */
    function cleanup(i) {
      galleryApi.gallery.style.width = '';
      dialog.classList.remove('is-closing', 'is-zoomed', 'is-pulling', 'is-dismissing', 'is-instant');
      dialog.style.removeProperty('--fade');
      hidePeek();
      root.classList.remove('viewer-open');
      frame.getAnimations && frame.getAnimations().forEach(function (a) { a.cancel(); });
      frame.style.transform = '';
      frame.style.opacity = '';
      closing = false;
      closeAnim = null;
      zoom = null;
      clearTimeout(slowTimer);
      clearTimeout(fullTimer);
      loadToken++;
      if (full) { full.remove(); full = null; }
      current = -1;
      fit = null;
      try { history.scrollRestoration = 'auto'; } catch (e) { /* old browsers */ }
      if (tiles[i]) tilePicture(i).style.visibility = '';
      var link = tiles[i] && tiles[i].querySelector('.tile-link');
      if (link) link.focus({ preventScroll: true });
    }

    /** Stop a close that is under way (e.g. Back then Forward quickly). */
    function abortClose() {
      if (!closing) return;
      cancelAnimationFrame(closeFrame);
      if (closeAnim) {
        closeAnim.onfinish = closeAnim.oncancel = null;
        closeAnim.cancel();
      }
      tiles.forEach(function (t, k) { tilePicture(k).style.visibility = ''; });
      closeAnim = null;
      closing = false;
      dialog.classList.remove('is-closing');
    }

    /** Close the dialog UI (history is handled by the caller). */
    function teardown(options) {
      if (!dialog.open || closing) return;
      options = options || {};
      closing = true;
      var i = current;
      endZoom(false);
      // Wait a frame: after Back, the browser may still restore a scroll
      // position; ours must come last.
      closeFrame = requestAnimationFrame(function () {
        var tile = tiles[i];
        if (tile) {
          var r = tile.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight) tile.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
        var finish = function () {
          if (dialog.open) dialog.close();
          cleanup(i);
        };
        var to = options.animate !== false && !reducedMotion() && frame.animate ? thumbRect(i) : null;
        var from = frame.getBoundingClientRect();
        if (!to || !from.width) { finish(); return; }
        dialog.classList.add('is-closing');
        tilePicture(i).style.visibility = 'hidden';
        closeAnim = frame.animate([
          { transformOrigin: '0 0', transform: getComputedStyle(frame).transform === 'none' ? 'none' : getComputedStyle(frame).transform },
          { transformOrigin: '0 0', transform: zoomBetween(to, from) },
        ], { duration: 260, easing: EASE, fill: 'forwards' });
        closeAnim.onfinish = finish;
        closeAnim.oncancel = finish;
      });
    }

    function close(options) {
      if (!dialog.open || closing) return;
      if (pushedState && history.state && history.state.viewer) {
        teardownOptions = options;
        history.back(); // popstate tears the viewer down
      } else {
        history.replaceState(null, '', location.pathname + location.search);
        teardown(options);
      }
      pushedState = false;
    }
    var teardownOptions = null;

    // Safety net: if the browser closes the dialog by itself (Chrome can on a
    // repeated Esc), tidy up and drop the photo from the URL.
    dialog.addEventListener('close', function () {
      if (current < 0 || closing) return;
      var i = current;
      cleanup(i);
      if (indexFromHash() >= 0) {
        if (pushedState && history.state && history.state.viewer) history.back();
        else history.replaceState(null, '', location.pathname + location.search);
      }
      pushedState = false;
    });

    window.addEventListener('popstate', function () {
      var i = indexFromHash();
      if (i >= 0) {
        if (closing) { abortClose(); show(i); }
        else if (dialog.open) show(i);
        else {
          open(i);
          // Reopened by Forward: this history entry is one we added, so
          // closing should step back over it again.
          pushedState = !!(history.state && history.state.viewer);
          if (pushedState) try { history.scrollRestoration = 'manual'; } catch (e) { /* old browsers */ }
        }
        requestAnimationFrame(focusDialog);
      } else if (dialog.open) {
        pushedState = false;
        var options = teardownOptions;
        teardownOptions = null;
        teardown(options || {});
      }
    });

    /* -------------------------------------------------------------- zoom */

    /** Scale that shows the sharpest file at one image pixel per screen pixel. */
    function zoomScale() {
      if (current < 0 || !fit) return 1;
      var s = sources(current);
      var widest = Math.min(largestWidth(s.avif || s.jpeg), photos[current].width);
      return widest / (fit.w * dpr());
    }

    // Nothing to zoom into once the full-size file has failed to load.
    function canZoom() { return !fullFailed && zoomScale() > 1.15; }
    var fullFailed = false;

    function updateZoomButton() {
      var ok = current >= 0 && canZoom();
      dialog.classList.toggle('can-zoom', ok);
      // Only offered when there is more detail to see than the screen shows.
      zoomButton.hidden = !ok && !zoom;
      zoomButton.setAttribute('aria-pressed', String(!!zoom));
      zoomButton.setAttribute('aria-label', zoom ? 'Zoom out' : 'Zoom to full resolution');
      zoomButton.title = zoom ? 'Zoom out (Z)' : 'Zoom (Z)';
    }

    function clampPan(x, y, s) {
      var W = dialog.clientWidth;
      var H = dialog.clientHeight;
      var zw = fit.w * s;
      var zh = fit.h * s;
      return {
        x: zw > W ? Math.min(0, Math.max(W - zw, x)) : (W - zw) / 2,
        y: zh > H ? Math.min(0, Math.max(H - zh, y)) : (H - zh) / 2,
      };
    }

    function applyZoom(animate) {
      var transform = 'translate(' + (zoom.x - fit.x) + 'px, ' + (zoom.y - fit.y) + 'px) scale(' + zoom.s + ')';
      frame.style.transition = animate && !reducedMotion() ? 'transform 0.3s ' + EASE : 'none';
      frame.style.transform = transform;
      updateOverlap();
    }

    /** Zoom in around (px, py): to full resolution, or to `scale` if given
     *  (touch double-tap zooms even when there's little extra detail). */
    function startZoom(px, py, scale) {
      if (zoom || current < 0 || (!scale && !canZoom())) return;
      var s = scale || zoomScale();
      if (frame.getAnimations) frame.getAnimations().forEach(function (a) { a.cancel(); });
      zoom = { s: s, x: fit.x, y: fit.y };
      if (px == null) { px = fit.x + fit.w / 2; py = fit.y + fit.h / 2; }
      // Start centred on the point that was clicked.
      var c = clampPan(dialog.clientWidth / 2 - (px - fit.x) * s, dialog.clientHeight / 2 - (py - fit.y) * s, s);
      zoom.x = c.x;
      zoom.y = c.y;
      dialog.classList.add('is-zoomed');
      setFullSizes(wantedWidth());
      applyZoom(true);
      updateZoomButton();
      updateOverlap();
      announceZoom();
    }

    function announceZoom() {
      statusEl.textContent = zoom
        ? 'Zoomed in. Drag or use the arrow keys to look around; press Z or Esc to zoom out.'
        : 'Zoomed out.';
    }

    function endZoom(animate) {
      if (!zoom) return;
      zoom = null;
      dialog.classList.remove('is-zoomed');
      frame.style.transition = animate && !reducedMotion() ? 'transform 0.3s ' + EASE : 'none';
      frame.style.transform = '';
      updateZoomButton();
      updateOverlap();
      if (animate) announceZoom();
    }

    function toggleZoom(px, py) {
      if (zoom) endZoom(true);
      else startZoom(px, py);
    }

    function panBy(dx, dy) {
      if (!zoom) return;
      var p = clampPan(zoom.x + dx, zoom.y + dy, zoom.s);
      zoom.x = p.x;
      zoom.y = p.y;
      applyZoom(false);
    }

    // Mouse: drag a zoomed photo to look around (a click without dragging
    // zooms out); the wheel or a trackpad pans too.
    var mouseDrag = null;
    var mouseMoved = false;
    var mouseDown = null; // any mouse press: a press that moves isn't a click
    stage.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      mouseDown = { x: event.clientX, y: event.clientY, id: event.pointerId };
      mouseMoved = false;
      if (!zoom) return;
      mouseDrag = { x: event.clientX, y: event.clientY, zx: zoom.x, zy: zoom.y, id: event.pointerId };
      try { stage.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      dialog.classList.add('is-grabbing');
      event.preventDefault();
    });
    stage.addEventListener('pointermove', function (event) {
      if (mouseDown && event.pointerId === mouseDown.id &&
          Math.abs(event.clientX - mouseDown.x) + Math.abs(event.clientY - mouseDown.y) > 4) mouseMoved = true;
      if (!mouseDrag || event.pointerId !== mouseDrag.id || !zoom) return;
      var dx = event.clientX - mouseDrag.x;
      var dy = event.clientY - mouseDrag.y;
      var p = clampPan(mouseDrag.zx + dx, mouseDrag.zy + dy, zoom.s);
      zoom.x = p.x;
      zoom.y = p.y;
      applyZoom(false);
    });
    function endMouseDrag(event) {
      if (mouseDown && event.pointerId === mouseDown.id) mouseDown = null;
      if (!mouseDrag || event.pointerId !== mouseDrag.id) return;
      mouseDrag = null;
      dialog.classList.remove('is-grabbing');
    }
    stage.addEventListener('pointerup', endMouseDrag);
    stage.addEventListener('pointercancel', endMouseDrag);
    dialog.addEventListener('wheel', function (event) {
      if (!zoom || pinch) return;
      event.preventDefault();
      var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dialog.clientHeight : 1;
      panBy(-event.deltaX * unit, -event.deltaY * unit);
    }, { passive: false });

    /* ------------------------------------------------- details & controls */
    function setInfo(visible, animate) {
      dialog.classList.toggle('is-info-hidden', !visible);
      infoButton.setAttribute('aria-pressed', String(visible));
      store.set('viewer-info', visible ? null : 'off');
      if (current >= 0) refit(animate);
    }
    function toggleInfo() { setInfo(!infoVisible(), true); }
    // I / the Details button: while zoomed (details out of sight) it first
    // zooms back out, like Esc; the next press shows or hides the details.
    function detailsKey() {
      if (zoom) endZoom(true);
      else toggleInfo();
    }
    setInfo(store.get('viewer-info') !== 'off', false);

    function setImmersive(on) {
      if (dialog.classList.contains('is-immersive') === on) return;
      dialog.classList.toggle('is-immersive', on);
      if (on && dialog.contains(document.activeElement) && document.activeElement !== dialog) dialog.focus({ preventScroll: true });
      if (!zoom) refit(true);
    }

    /* ------------------------------------------------------------ events */
    galleryApi.gallery.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('.tile-link');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open(tiles.indexOf(link.closest('.tile')), { push: true, zoom: true });
    });

    dialog.addEventListener('click', function (event) {
      if (suppressClick) return;
      var action = event.target.closest && event.target.closest('[data-action]');
      if (action) {
        if (action.getAttribute('aria-disabled') === 'true') return;
        var name = action.getAttribute('data-action');
        if (name === 'prev') go(-1);
        else if (name === 'next') go(1);
        else if (name === 'close') close();
        else if (name === 'info') detailsKey();
        else if (name === 'zoom') toggleZoom();
        return;
      }
      if (event.pointerType === 'touch' || lastPointerType === 'touch') return; // touch: handled by the gestures below
      if (mouseMoved) { mouseMoved = false; return; } // the end of a drag, not a click
      if (frame.contains(event.target)) toggleZoom(event.clientX, event.clientY);
      else if (zoom) endZoom(true);
      else if (event.target === stage) close(); // the empty area around the photo
    });

    // Esc while zoomed zooms out. Caught on keydown, before the dialog's own
    // Esc handling: browsers don't always send a cancelable "cancel" event
    // for repeated presses, and the dialog would close instead.
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !dialog.open || !zoom || closing) return;
      event.preventDefault();
      event.stopPropagation();
      endZoom(true);
    }, true);

    dialog.addEventListener('cancel', function (event) {
      event.preventDefault(); // Esc: zoom out first, then close through history
      if (zoom) endZoom(true);
      else close();
    });

    document.addEventListener('keydown', function (event) {
      if (!dialog.open || closing || event.altKey || event.ctrlKey || event.metaKey) return;
      var step = 0.15;
      switch (event.key) {
        case 'ArrowLeft': if (zoom) panBy(dialog.clientWidth * step, 0); else go(-1); break;
        case 'ArrowRight': if (zoom) panBy(-dialog.clientWidth * step, 0); else go(1); break;
        case 'ArrowUp': if (zoom) panBy(0, dialog.clientHeight * step); else return; break;
        case 'ArrowDown': if (zoom) panBy(0, -dialog.clientHeight * step); else return; break;
        case 'Home': if (!zoom) go(-current); break;
        case 'End': if (!zoom) go(total - 1 - current); break;
        case 'i':
        case 'I': detailsKey(); break;
        case 'z':
        case 'Z': toggleZoom(); break;
        default: return;
      }
      event.preventDefault();
    });

    // Keep the photo fitted when the window or phone orientation changes.
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () {
        if (!dialog.open || closing) return;
        endZoom(false);
        refit(false); // (the details are re-measured only when the width changes)
      }).observe(dialog);
    }


    /* ------------------------------------------------------------- touch */
    // Gestures anywhere in the viewer except on its buttons:
    //   tap: show / hide the controls (a tap never closes the viewer)
    //   double-tap or pinch: zoom around your fingers; drag to pan when zoomed
    //   swipe sideways: next / previous, with the neighbour sliding in alongside
    //   swipe down: close (the background fades as you pull)
    var touches = {};   // fingers on the screen: pointerId -> { x, y }
    var drag = null;    // one-finger gesture
    var pinch = null;   // two-finger gesture
    var suppressClick = false;
    var lastPointerType = '';
    var tapTimer = 0;
    var lastTap = null;
    var peek = q('.viewer-peek');
    var peekImg = peek.querySelector('img');
    var peekIndex = -1;
    var GAP = 24; // between the photo and its sliding neighbour

    function fingers() { return Object.keys(touches); }
    function suppressNextClick() {
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 350);
    }
    function onControl(target) { return !!(target.closest && target.closest('button, a, [data-action]')); }
    function onPhoto(x, y) {
      var r = frame.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    /* ---- the neighbour that slides in during a sideways swipe */
    function preparePeek(dir) {
      var n = current + dir;
      if (n < 0 || n >= total) { hidePeek(); return; }
      if (peekIndex === n) return;
      peekIndex = n;
      var r = fitFor(n, insets.cache);
      var src = sources(n).thumb;
      peek.style.left = r.x + 'px';
      peek.style.top = r.y + 'px';
      peek.style.width = r.w + 'px';
      peek.style.height = r.h + 'px';
      peek.style.setProperty('--tint', photos[n].tint || 'transparent');
      if (src) peekImg.src = src; else peekImg.removeAttribute('src');
      peekImg.hidden = !src;
      peek.hidden = false;
    }
    function movePeek(dx) {
      var dir = dx < 0 ? 1 : -1;
      preparePeek(dir);
      if (peek.hidden) return;
      peek.style.transform = 'translateX(' + (dx + dir * (dialog.clientWidth + GAP)) + 'px)';
    }
    function hidePeek() {
      if (peek.getAnimations) peek.getAnimations().forEach(function (a) { a.cancel(); });
      peek.hidden = true;
      peek.style.transform = '';
      peekIndex = -1;
    }

    /** After a swipe: slide the photo out and its neighbour into place. */
    function slide(dir, fromX) {
      frame.style.transform = '';
      if (reducedMotion() || !frame.animate) { hidePeek(); go(dir); return; }
      var timing = { duration: 220, easing: 'cubic-bezier(0.25, 0.6, 0.3, 1)', fill: 'forwards' };
      var out = frame.animate([
        { transform: 'translateX(' + fromX + 'px)' },
        { transform: 'translateX(' + (-dir * (dialog.clientWidth + GAP)) + 'px)' },
      ], timing);
      if (!peek.hidden) peek.animate([{ transform: peek.style.transform }, { transform: 'none' }], timing);
      out.onfinish = function () {
        out.cancel();
        go(dir); // the frame now shows the same preview exactly where the neighbour is
        hidePeek();
      };
    }

    /** A swipe that didn't go far enough: everything springs back. */
    function settle(fromX) {
      frame.style.transform = '';
      if (reducedMotion() || !frame.animate) { hidePeek(); return; }
      var timing = { duration: 220, easing: EASE };
      frame.animate([{ transform: fromX }, { transform: 'none' }], timing);
      if (!peek.hidden) {
        var back = peek.animate([{ transform: peek.style.transform }, {
          transform: 'translateX(' + (peekIndex > current ? 1 : -1) * (dialog.clientWidth + GAP) + 'px)',
        }], timing);
        back.onfinish = hidePeek;
      }
    }

    /** Swipe down past the threshold: carry on downwards and close. */
    function dismiss(dy) {
      dialog.classList.add('is-dismissing');
      frame.style.transform = '';
      if (reducedMotion() || !frame.animate) { close({ animate: false }); return; }
      var away = frame.animate([
        { transform: 'translateY(' + dy + 'px)', opacity: 1 },
        { transform: 'translateY(' + (dy + 220) + 'px)', opacity: 0 },
      ], { duration: 200, easing: 'cubic-bezier(0.3, 0.5, 0.4, 1)', fill: 'forwards' });
      away.onfinish = function () { close({ animate: false }); };
    }

    /* ---- pinch */
    function points() {
      var ids = fingers();
      return [touches[ids[0]], touches[ids[1]]];
    }
    function maxPinch() { return Math.max(zoomScale(), 2); }

    function startPinch() {
      clearTimeout(tapTimer);
      lastTap = null;
      if (drag && drag.axis && drag.axis !== 'pan') { frame.style.transform = ''; hidePeek(); }
      drag = null;
      if (!zoom) {
        if (frame.getAnimations) frame.getAnimations().forEach(function (a) { a.cancel(); });
        zoom = { s: 1, x: fit.x, y: fit.y };
        dialog.classList.add('is-zoomed');
        updateZoomButton();
      }
      var p = points();
      pinch = {
        d: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) || 1,
        mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2,
        s: zoom.s, x: zoom.x, y: zoom.y,
      };
    }

    function movePinch() {
      var p = points();
      var d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      var mx = (p[0].x + p[1].x) / 2;
      var my = (p[0].y + p[1].y) / 2;
      var s = Math.min(maxPinch() * 1.25, Math.max(0.6, pinch.s * d / pinch.d));
      // The point of the photo that was between the fingers stays there.
      zoom.s = s;
      zoom.x = mx - (pinch.mx - pinch.x) * (s / pinch.s);
      zoom.y = my - (pinch.my - pinch.y) * (s / pinch.s);
      pinch.lastX = mx;
      pinch.lastY = my;
      applyZoom(false);
    }

    function endPinch() {
      var mid = pinch && pinch.lastX != null ? { x: pinch.lastX, y: pinch.lastY } : null;
      pinch = null;
      suppressNextClick();
      if (zoom.s < 1.05) { endZoom(true); return; }
      var max = maxPinch();
      if (zoom.s > max) {
        // Pinched past the limit: spring back around the point between the
        // fingers, so what was under them stays there.
        if (mid) {
          zoom.x = mid.x - (mid.x - zoom.x) * (max / zoom.s);
          zoom.y = mid.y - (mid.y - zoom.y) * (max / zoom.s);
        }
        zoom.s = max;
      }
      var c = clampPan(zoom.x, zoom.y, zoom.s);
      zoom.x = c.x;
      zoom.y = c.y;
      applyZoom(true);
      setFullSizes(wantedWidth());
      announceZoom();
      // A finger still down carries on as a pan.
      var ids = fingers();
      if (ids.length === 1) {
        var t = touches[ids[0]];
        drag = { x: t.x, y: t.y, t: Date.now(), axis: 'pan', id: +ids[0], zx: zoom.x, zy: zoom.y };
      }
    }

    /* ---- pointer events */
    dialog.addEventListener('pointerdown', function (event) {
      lastPointerType = event.pointerType;
      if (event.pointerType !== 'touch' || closing || onControl(event.target)) return;
      touches[event.pointerId] = { x: event.clientX, y: event.clientY };
      if (fingers().length === 2) { startPinch(); return; }
      if (fingers().length > 2) return;
      drag = {
        x: event.clientX, y: event.clientY, t: Date.now(), axis: null, id: event.pointerId,
        zx: zoom && zoom.x, zy: zoom && zoom.y,
      };
    });

    dialog.addEventListener('pointermove', function (event) {
      if (!(event.pointerId in touches)) return;
      touches[event.pointerId] = { x: event.clientX, y: event.clientY };
      if (pinch) { movePinch(); return; }
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (!drag.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        drag.axis = zoom ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'x' : dy > 0 ? 'down' : 'none';
        clearTimeout(tapTimer);
        frame.classList.add('is-dragging');
        if (drag.axis === 'down') dialog.classList.add('is-pulling');
      }
      if (drag.axis === 'pan') {
        var p = clampPan(drag.zx + dx, drag.zy + dy, zoom.s);
        zoom.x = p.x;
        zoom.y = p.y;
        applyZoom(false);
      } else if (drag.axis === 'x') {
        var atEdge = (dx > 0 && current === 0) || (dx < 0 && current === total - 1);
        var x = atEdge ? dx * 0.25 : dx;
        frame.style.transform = 'translateX(' + x + 'px)';
        if (!atEdge) movePeek(dx); else hidePeek();
      } else if (drag.axis === 'down') {
        var down = Math.max(0, dy);
        frame.style.transform = 'translateY(' + down + 'px)';
        dialog.style.setProperty('--fade', String(Math.max(0.2, 1 - down / 360)));
      }
    });

    function endTouch(event, cancelled) {
      if (!(event.pointerId in touches)) return;
      delete touches[event.pointerId];
      if (pinch) { if (fingers().length < 2) endPinch(); return; }
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      var dt = Math.max(1, Date.now() - drag.t);
      var axis = drag.axis;
      drag = null;
      frame.classList.remove('is-dragging');

      if (!axis) {
        if (cancelled) return;
        suppressNextClick();
        var now = Date.now();
        var x = event.clientX;
        var y = event.clientY;
        if (lastTap && now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
          // Double-tap: zoom (the first tap's action never happened).
          clearTimeout(tapTimer);
          lastTap = null;
          if (zoom) endZoom(true);
          else if (onPhoto(x, y)) startZoom(x, y, maxPinch());
          return;
        }
        lastTap = { t: now, x: x, y: y };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(function () {
          lastTap = null;
          setImmersive(!dialog.classList.contains('is-immersive'));
        }, 300);
        return;
      }
      suppressNextClick();
      if (axis === 'pan' || axis === 'none') return;
      var dragged = frame.style.transform;
      var fast = Math.abs(axis === 'x' ? dx : dy) / dt > 0.45;
      if (axis === 'x') {
        var dir = dx < 0 ? 1 : -1;
        if (!cancelled && (Math.abs(dx) > 60 || fast) && current + dir >= 0 && current + dir < total) slide(dir, dx);
        else settle(dragged);
      } else if (!cancelled && dy > 0 && (dy > 110 || fast)) {
        dismiss(dy);
      } else {
        dialog.classList.remove('is-pulling');
        dialog.style.removeProperty('--fade');
        settle(dragged);
      }
    }

    dialog.addEventListener('pointerup', function (e) { endTouch(e, false); });
    dialog.addEventListener('pointercancel', function (e) { endTouch(e, true); });

    /* ------------------------------------------------- deep link on load */
    var initial = indexFromHash();
    if (initial >= 0) {
      // Opened from a shared link: the viewer appears at once over the
      // cover (no fade in, which would show the gallery through it).
      dialog.classList.add('is-instant');
      open(initial);
      root.classList.remove('deep-link');
      // The browser's jump to #photo-… can take focus away; give it back.
      requestAnimationFrame(focusDialog);
      window.addEventListener('load', focusDialog, { once: true });
    } else {
      root.classList.remove('deep-link'); // a stale link: show the gallery
    }
  }

  var page = window.Portfolio;
  if (page && page.gallery) init({ gallery: page.gallery, tiles: page.tiles }, page.store);
})();
