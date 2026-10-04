/* ==========================================================================
   Portfolio — main.js
   No dependencies. Progressive enhancement: without this file the page still
   works (CSS grid layout; thumbnails link straight to the full-size image).

   1. Theme      light / dark, follows the system until the visitor chooses
   2. Gallery    justified rows (no cropping), thumbnail size control
   3. Viewer     full-screen photo viewer with camera data, keyboard, swipe,
                 shareable links (#photo-<name>)
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

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

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
      metas.forEach(function (meta, i) {
        meta.setAttribute('content', explicit ? bg : original[i]);
      });
      if (button) {
        button.setAttribute('data-current', theme);
        button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      }
    }

    if (button) {
      button.addEventListener('click', function () {
        var next = current() === 'dark' ? 'light' : 'dark';
        // Choosing the system's own theme means "follow the system" again.
        if (next === systemTheme()) follow();
        else {
          root.setAttribute('data-theme', next);
          store.set('theme', next);
        }
        sync();
      });
      button.classList.add('is-ready'); // shown only once it works
    }

    function onSystemChange() {
      // If the system now matches the visitor's choice, go back to following it.
      if (root.getAttribute('data-theme') === systemTheme()) follow();
      sync();
    }
    if (system.addEventListener) system.addEventListener('change', onSystemChange);
    else if (system.addListener) system.addListener(onSystemChange);
    sync();
  }

  /* -------------------------------------------------------------- gallery */

  // Row layout lives in assets/js/layout.js, which the build inlines right
  // after the gallery so rows are sized before the first paint. Here we only
  // re-run it on resize and wire up the S/M/L control.

  function initGallery() {
    var gallery = document.getElementById('gallery');
    if (!gallery) return null;
    var tiles = Array.prototype.slice.call(gallery.querySelectorAll('.tile'));
    var api = { gallery: gallery, tiles: tiles };
    var engine = window.PhotoLayout;
    if (!engine) return api; // CSS-only rows still work

    var size = root.getAttribute('data-size') || 'm';
    var lastWidth = gallery.getBoundingClientRect().width;
    var frame = 0;

    function relayout() {
      lastWidth = gallery.getBoundingClientRect().width;
      engine.layout(gallery, size);
    }

    function onResize() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        if (Math.abs(gallery.getBoundingClientRect().width - lastWidth) >= 0.5) relayout();
      });
    }
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(gallery);
    else window.addEventListener('resize', onResize);
    if (!gallery.classList.contains('is-justified')) relayout();

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
        var dist = dx * dx + dy * dy;
        if (dist < bestDist) { best = tiles[i]; bestDist = dist; }
      }
      return best;
    }

    // Thumbnail size control (S / M / L).
    var control = document.querySelector('.size-control');
    if (control) {
      var buttons = Array.prototype.slice.call(control.querySelectorAll('button[data-size]'));
      var syncButtons = function () {
        buttons.forEach(function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-size') === size));
        });
      };
      buttons.forEach(function (button) {
        button.addEventListener('click', function () {
          var next = button.getAttribute('data-size');
          if (next === size) return;
          // Keep the photo in the middle of the screen where it is, unless
          // the top of the gallery is in view (then the page stays put).
          var anchor = gallery.getBoundingClientRect().top < 0 ? centreTile() : null;
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

    return api;
  }

  /* --------------------------------------------------------------- viewer */

  var ICONS = {
    prev: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    info: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75v.01"/></svg>',
  };

  var EXIF_FIELDS = [
    ['camera', 'Camera'],
    ['lens', 'Lens'],
    ['focal', 'Focal length'],
    ['aperture', 'Aperture'],
    ['shutter', 'Shutter'],
    ['iso', 'ISO'],
  ];

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function initViewer(galleryApi) {
    var dataNode = document.getElementById('gallery-data');
    if (!galleryApi || !dataNode || typeof HTMLDialogElement !== 'function') return;

    var photos;
    try { photos = JSON.parse(dataNode.textContent); } catch (e) { return; }
    var tiles = galleryApi.tiles;
    if (!photos.length || photos.length !== tiles.length) return;

    var total = photos.length;
    var digits = Math.max(2, String(total).length);
    var pad = function (n) { return String(n).padStart(digits, '0'); };

    /* ---- markup */
    var dialog = el('dialog', 'viewer');
    dialog.innerHTML =
      '<div class="viewer-top">' +
        '<p class="viewer-count">' +
          '<button type="button" class="viewer-btn" data-action="prev" aria-label="Previous photo">' + ICONS.prev + '</button>' +
          '<strong class="viewer-index">01</strong><span class="sep">/</span><span class="viewer-total">' + pad(total) + '</span>' +
          '<button type="button" class="viewer-btn" data-action="next" aria-label="Next photo">' + ICONS.next + '</button>' +
        '</p>' +
        '<div class="viewer-tools">' +
          '<button type="button" class="viewer-btn" data-action="info" aria-pressed="true" aria-label="Photo details" title="Details (I)">' + ICONS.info + '</button>' +
          '<button type="button" class="viewer-btn" data-action="close" aria-label="Close viewer" title="Close (Esc)" autofocus>' + ICONS.close + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="viewer-stage">' +
        '<button type="button" class="viewer-btn viewer-side prev" data-action="prev" aria-label="Previous photo" title="Previous (←)">' + ICONS.prev + '</button>' +
        '<div class="viewer-frame"><img class="viewer-preview" alt="" aria-hidden="true"></div>' +
        '<button type="button" class="viewer-btn viewer-side next" data-action="next" aria-label="Next photo" title="Next (→)">' + ICONS.next + '</button>' +
      '</div>' +
      '<div class="viewer-info" id="viewer-info">' +
        '<div class="viewer-text">' +
          '<h2 class="viewer-title" id="viewer-title"></h2>' +
          '<p class="viewer-meta"></p>' +
          '<p class="viewer-caption"></p>' +
        '</div>' +
        '<dl class="viewer-exif"></dl>' +
      '</div>' +
      '<p class="visually-hidden" aria-live="polite" aria-atomic="true"></p>';
    document.body.appendChild(dialog);

    var q = function (sel) { return dialog.querySelector(sel); };
    var stage = q('.viewer-stage');
    var frame = q('.viewer-frame');
    var preview = q('.viewer-preview');
    var indexEl = q('.viewer-index');
    var titleEl = q('.viewer-title');
    var metaEl = q('.viewer-meta');
    var captionEl = q('.viewer-caption');
    var exifEl = q('.viewer-exif');
    var statusEl = q('[aria-live]');
    var infoButton = q('[data-action="info"]');
    infoButton.setAttribute('aria-controls', 'viewer-info');

    var current = -1;
    var full = null;          // current <picture>
    var loadToken = 0;
    var slowTimer = 0;
    var pushedState = false;  // did we add a history entry on open?

    /* ---- helpers */
    function tilePicture(i) { return tiles[i].querySelector('picture'); }

    function sourceSets(i) {
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

    var avifSupported = null;
    function supportsAvif() {
      if (avifSupported !== null) return avifSupported;
      for (var i = 0; i < tiles.length; i++) {
        var img = tiles[i].querySelector('img');
        if (img && img.currentSrc) {
          avifSupported = /\.avif(\?|$)/.test(img.currentSrc);
          return avifSupported;
        }
      }
      return false;
    }

    function fitFrame() {
      if (current < 0) return { w: 0, h: 0 };
      var photo = photos[current];
      var style = getComputedStyle(stage);
      var padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      var availW = stage.clientWidth - padX;
      var availH = stage.clientHeight;
      var ratio = photo.width / photo.height;
      var w = Math.min(availW, availH * ratio, photo.width);
      var h = w / ratio;
      w = Math.max(1, Math.floor(w));
      h = Math.max(1, Math.floor(h));
      frame.style.setProperty('--fw', w + 'px');
      frame.style.setProperty('--fh', h + 'px');
      return { w: w, h: h };
    }

    function sizesFor(width) { return Math.ceil(width) + 'px'; }

    function preload(i) {
      if (i < 0 || i >= total) return;
      var sets = sourceSets(i);
      var photo = photos[i];
      var style = getComputedStyle(stage);
      var availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      var w = Math.min(availW, stage.clientHeight * (photo.width / photo.height), photo.width);
      var img = new Image();
      img.decoding = 'async';
      img.sizes = sizesFor(w);
      img.srcset = supportsAvif() && sets.avif ? sets.avif : sets.jpeg;
    }

    function renderInfo(photo) {
      titleEl.textContent = photo.title || '';
      metaEl.textContent = [photo.location, photo.date].filter(Boolean).join(' · ');
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

    function show(i) {
      i = Math.max(0, Math.min(total - 1, i));
      current = i;
      var photo = photos[i];
      var sets = sourceSets(i);
      var token = ++loadToken;

      indexEl.textContent = pad(i + 1);
      // aria-disabled (not disabled) so a focused button keeps focus at the ends.
      Array.prototype.forEach.call(dialog.querySelectorAll('[data-action="prev"]'), function (b) {
        b.setAttribute('aria-disabled', String(i === 0));
      });
      Array.prototype.forEach.call(dialog.querySelectorAll('[data-action="next"]'), function (b) {
        b.setAttribute('aria-disabled', String(i === total - 1));
      });
      renderInfo(photo);
      var position = 'Photo ' + (i + 1) + ' of ' + total;
      dialog.setAttribute('aria-label', photo.title ? photo.title + ', ' + position.toLowerCase() : position);
      statusEl.textContent = position + (photo.title ? ': ' + photo.title : '');

      frame.style.setProperty('--tint', photo.tint || 'transparent');
      frame.style.transform = '';
      frame.style.opacity = '';
      var size = fitFrame();

      // Instant preview from the thumbnail already on screen, if loaded.
      if (sets.thumb) {
        preview.src = sets.thumb;
        preview.hidden = false;
      } else {
        preview.removeAttribute('src');
        preview.hidden = true;
      }

      if (full) full.remove();
      full = el('picture', 'viewer-full is-loading');
      var source = el('source');
      source.type = 'image/avif';
      source.sizes = sizesFor(size.w);
      source.srcset = sets.avif;
      var img = el('img');
      img.alt = sets.alt || photo.title || '';
      img.decoding = 'async';
      img.sizes = sizesFor(size.w);
      img.srcset = sets.jpeg;
      img.src = sets.src;
      if (sets.avif) full.appendChild(source);
      full.appendChild(img);
      frame.appendChild(full);

      clearTimeout(slowTimer);
      frame.classList.remove('is-slow');
      slowTimer = setTimeout(function () {
        if (token === loadToken) frame.classList.add('is-slow');
      }, 450);

      var reveal = function () {
        if (token !== loadToken) return;
        clearTimeout(slowTimer);
        frame.classList.remove('is-slow');
        full.classList.remove('is-loading');
      };
      img.addEventListener('load', function () {
        if (img.decode) img.decode().then(reveal, reveal);
        else reveal();
      }, { once: true });
      img.addEventListener('error', reveal, { once: true });

      preload(i + 1);
      preload(i - 1);
    }

    function hashFor(i) { return '#' + tiles[i].id; }

    function indexFromHash() {
      var id = decodeURIComponent(location.hash.slice(1));
      if (!id) return -1;
      for (var i = 0; i < tiles.length; i++) if (tiles[i].id === id) return i;
      return -1;
    }

    /* ---- zoom between the thumbnail and the full view */
    var ZOOM = { duration: 320, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
    var closing = false;
    var animateNextClose = true;

    /** Visible on-screen rect of a tile's image, or null. */
    function thumbRect(i) {
      var picture = tilePicture(i);
      if (!picture) return null;
      var r = picture.getBoundingClientRect();
      if (!r.width || r.bottom <= 0 || r.top >= window.innerHeight) return null;
      return r;
    }

    function zoomKeyframe(from, to) {
      return 'translate(' + (from.left - to.left) + 'px, ' + (from.top - to.top) + 'px) ' +
        'scale(' + from.width / to.width + ', ' + from.height / to.height + ')';
    }

    function zoomIn(i) {
      if (prefersReducedMotion() || !frame.animate) return;
      var from = thumbRect(i);
      var to = frame.getBoundingClientRect();
      if (!from || !to.width) return;
      frame.animate([
        { transformOrigin: '0 0', transform: zoomKeyframe(from, to) },
        { transformOrigin: '0 0', transform: 'none' },
      ], ZOOM);
    }

    function open(i, options) {
      options = options || {};
      var opening = !dialog.open;
      if (opening) {
        root.classList.add('viewer-open');
        dialog.classList.remove('is-immersive', 'is-closing');
        dialog.showModal();
      }
      show(i);
      if (opening && options.zoom) zoomIn(i);
      if (options.push) {
        history.pushState({ viewer: true }, '', hashFor(i));
        pushedState = true;
      }
    }

    function go(delta) {
      var next = current + delta;
      if (closing || next < 0 || next >= total || next === current) return;
      show(next);
      history.replaceState(history.state, '', hashFor(next));
    }

    /** Reset state once the dialog has closed; focus the photo's tile. */
    function cleanup(i) {
      dialog.classList.remove('is-closing');
      root.classList.remove('viewer-open');
      if (frame.getAnimations) frame.getAnimations().forEach(function (a) { a.cancel(); });
      closing = false;
      clearTimeout(slowTimer);
      loadToken++;
      if (full) { full.remove(); full = null; }
      current = -1;
      var link = tiles[i] && tiles[i].querySelector('.tile-link');
      if (link) link.focus({ preventScroll: true });
    }

    // Safety net: if the browser closes the dialog by itself (Chrome can do
    // this on a repeated Esc without a cancelable event), tidy up and drop the
    // photo from the URL.
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

    /** Close the dialog UI (history is handled by the caller). */
    function teardown() {
      if (!dialog.open || closing) return;
      var i = current;
      var tile = tiles[i];
      var animate = animateNextClose && !prefersReducedMotion() && !!frame.animate;
      animateNextClose = true;

      // Bring the photo's tile on screen behind the viewer first, so the
      // zoom lands on it and focus returns to the right place.
      if (tile) {
        var rect = tile.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          tile.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      }

      var finish = function () {
        if (dialog.open) dialog.close();
        cleanup(i);
      };

      var to = animate ? thumbRect(i) : null;
      var from = frame.getBoundingClientRect();
      if (!to || !from.width) { finish(); return; }

      closing = true;
      dialog.classList.add('is-closing');
      var anim = frame.animate([
        { transformOrigin: '0 0', transform: 'none' },
        { transformOrigin: '0 0', transform: zoomKeyframe(to, from) },
      ], { duration: 260, easing: ZOOM.easing, fill: 'forwards' });
      anim.onfinish = finish;
      anim.oncancel = finish;
    }

    function close(options) {
      if (!dialog.open || closing) return;
      animateNextClose = !(options && options.animate === false);
      if (pushedState && history.state && history.state.viewer) {
        history.back(); // popstate tears the viewer down
      } else {
        teardown();
        history.replaceState(null, '', location.pathname + location.search);
      }
      pushedState = false;
    }

    /* ---- events */
    galleryApi.gallery.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('.tile-link');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open(tiles.indexOf(link.closest('.tile')), { push: true, zoom: true });
    });

    dialog.addEventListener('click', function (event) {
      var action = event.target.closest && event.target.closest('[data-action]');
      if (action) {
        var name = action.getAttribute('data-action');
        if (name === 'prev') go(-1);
        else if (name === 'next') go(1);
        else if (name === 'close') close();
        else if (name === 'info') toggleInfo();
        return;
      }
      // A click on the empty area around the photo closes the viewer.
      if (event.target === stage && !suppressClick) close();
    });

    dialog.addEventListener('cancel', function (event) {
      event.preventDefault(); // route Esc through history
      close();
    });

    document.addEventListener('keydown', function (event) {
      if (!dialog.open || closing || event.altKey || event.ctrlKey || event.metaKey) return;
      switch (event.key) {
        case 'ArrowLeft': go(-1); break;
        case 'ArrowRight': go(1); break;
        case 'Home': go(-current); break;
        case 'End': go(total - 1 - current); break;
        case 'i':
        case 'I': toggleInfo(); break;
        default: return;
      }
      event.preventDefault();
    });

    window.addEventListener('popstate', function () {
      var i = indexFromHash();
      if (i >= 0) {
        if (dialog.open) show(i);
        else { open(i); pushedState = false; }
      } else if (dialog.open) {
        pushedState = false;
        teardown();
      }
    });

    /* ---- details panel */
    function setInfo(visible) {
      dialog.classList.toggle('is-info-hidden', !visible);
      infoButton.setAttribute('aria-pressed', String(visible));
      store.set('viewer-info', visible ? null : 'off');
      if (current >= 0) refit();
    }
    function toggleInfo() { setInfo(dialog.classList.contains('is-info-hidden')); }
    setInfo(store.get('viewer-info') !== 'off');

    /* ---- resize: keep the photo fitted and the right file selected */
    function refit() {
      var size = fitFrame();
      if (full) {
        Array.prototype.forEach.call(full.querySelectorAll('source, img'), function (node) {
          node.sizes = sizesFor(size.w);
        });
      }
    }
    if ('ResizeObserver' in window) new ResizeObserver(function () { if (dialog.open) refit(); }).observe(stage);
    else window.addEventListener('resize', function () { if (dialog.open) refit(); });

    /* ---- touch: swipe left/right to navigate, down to close, tap for immersive */
    var drag = null;
    var suppressClick = false;

    stage.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      if (window.visualViewport && window.visualViewport.scale > 1.01) return; // let pinch-zoomed users pan
      drag = { x: event.clientX, y: event.clientY, t: Date.now(), axis: null, id: event.pointerId };
    });

    stage.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (!drag.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        frame.classList.add('is-dragging');
        try { stage.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      }
      if (drag.axis === 'x') {
        var atEdge = (dx > 0 && current === 0) || (dx < 0 && current === total - 1);
        frame.style.transform = 'translateX(' + (atEdge ? dx * 0.25 : dx) + 'px)';
      } else if (dy > 0) {
        frame.style.transform = 'translateY(' + dy + 'px)';
        frame.style.opacity = String(Math.max(0.35, 1 - dy / 400));
      }
    });

    function endDrag(event, cancelled) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      var dt = Math.max(1, Date.now() - drag.t);
      var axis = drag.axis;
      drag = null;
      frame.classList.remove('is-dragging');

      if (!axis) {
        // A tap. On the photo it toggles the controls; elsewhere it closes.
        if (!cancelled && (event.target === frame || frame.contains(event.target))) {
          dialog.classList.toggle('is-immersive');
          suppressClick = true;
          setTimeout(function () { suppressClick = false; }, 400);
        }
        return;
      }
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 400);
      frame.style.transform = '';
      frame.style.opacity = '';
      if (cancelled) return;
      var fast = Math.abs(axis === 'x' ? dx : dy) / dt > 0.45;
      if (axis === 'x' && (Math.abs(dx) > 60 || fast)) go(dx < 0 ? 1 : -1);
      else if (axis === 'y' && dy > 0 && (dy > 110 || fast)) close({ animate: false });
    }

    stage.addEventListener('pointerup', function (e) { endDrag(e, false); });
    stage.addEventListener('pointercancel', function (e) { endDrag(e, true); });

    /* ---- deep link on load */
    var initial = indexFromHash();
    if (initial >= 0) open(initial);
  }

  /* ----------------------------------------------------------------- misc */

  function initYear() {
    var year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  initTheme();
  var gallery = initGallery();
  initViewer(gallery);
  initYear();
})();
