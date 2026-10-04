// Dev check: viewer behaviour, as pass/fail assertions.
// Serve the repo first: npx http-server -p 8123 -c-1 -s .
//   node tools/dev/viewer-check.mjs [baseUrl]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:8123/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
};
const errors = [];
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // (Downloads a test aborts on purpose are not page errors.)
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { ctx, page };
}
const state = (page) => page.evaluate(() => {
  const d = document.querySelector('dialog.viewer');
  const f = document.querySelector('.viewer-frame').getBoundingClientRect();
  const close = document.querySelector('[data-action="close"]').getBoundingClientRect();
  return {
    open: d.open, hash: location.hash, idx: document.querySelector('.viewer-index').textContent,
    frame: { x: f.x, y: f.y, w: f.width, h: f.height }, vw: innerWidth, vh: innerHeight,
    closeVisible: close.right <= innerWidth && close.left >= 0 && close.width > 0,
    active: document.activeElement === d ? 'dialog' : (document.activeElement.closest('.tile')?.id || document.activeElement.tagName),
    scrollY: Math.round(scrollY), cls: d.className,
  };
});
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const inView = (page, id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, id);

// 1. Open, navigate, close paths land on the last photo viewed.
for (const how of ['Escape', 'close button', 'click outside', 'Back']) {
  const { ctx, page } = await newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.click('#photo-ridgelines .tile-link');
  await settle(page);
  await page.keyboard.press('End');
  await settle(page, 200);
  if (how === 'Escape') await page.keyboard.press('Escape');
  if (how === 'close button') await page.click('[data-action="close"]');
  if (how === 'click outside') await page.mouse.click(640, 40 + 8); // above the photo, below the bar? use stage edge
  if (how === 'Back') await page.goBack();
  await settle(page, 700);
  const s = await state(page);
  if (how === 'click outside' && s.open) { // the click may have landed on the bar; try the stage gap at the side
    await page.mouse.click(4, 400); await settle(page, 700);
  }
  const s2 = await state(page);
  check(`close via ${how}: closed, hash cleared, last photo in view and focused`,
    !s2.open && s2.hash === '' && (await inView(page, 'photo-salt-flat')) && s2.active === 'photo-salt-flat', JSON.stringify({ scrollY: s2.scrollY, active: s2.active }));
  await ctx.close();
}

// 2. Resize / rotate while open keeps the photo inside the screen.
for (const [from, to] of [[[844, 390], [390, 844]], [[1440, 900], [900, 900]], [[820, 1180], [1180, 820]]]) {
  const { ctx, page } = await newPage({ viewport: { width: from[0], height: from[1] }, hasTouch: from[0] < 1000, isMobile: from[0] < 1000 });
  await page.goto(base + '#photo-panorama', { waitUntil: 'networkidle' });
  await settle(page);
  await page.setViewportSize({ width: to[0], height: to[1] });
  await settle(page, 400);
  const s = await state(page);
  const inside = s.frame.x >= -0.5 && s.frame.x + s.frame.w <= s.vw + 0.5 && s.frame.y >= -0.5 && s.frame.y + s.frame.h <= s.vh + 0.5;
  check(`resize ${from.join('x')} → ${to.join('x')}: photo inside screen, Close visible`, inside && s.closeVisible, JSON.stringify(s.frame));
  await ctx.close();
}

// 3. Landscape phone: photo uses the height; immersive enlarges or keeps it, and hides controls from focus.
{
  const { ctx, page } = await newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(base + '#photo-ridgelines', { waitUntil: 'networkidle' });
  await settle(page);
  const s = await state(page);
  const share = (s.frame.w * s.frame.h) / (s.vw * s.vh);
  check('landscape phone 3:2 photo fills the height', s.frame.h >= s.vh - 2, `${Math.round(s.frame.w)}x${Math.round(s.frame.h)}, ${Math.round(share * 100)}% of screen`);
  await page.tap('.viewer-frame');
  await settle(page, 900); // a tap waits 260ms (could be a double-tap), then fades
  const s2 = await state(page);
  const vis = await page.evaluate(() => getComputedStyle(document.querySelector('.viewer-top')).visibility);
  check('tap → immersive: controls hidden (visibility)', s2.cls.includes('is-immersive') && vis === 'hidden');
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(base + '#photo-panorama', { waitUntil: 'networkidle' });
  await settle(page);
  const p1 = await state(page);
  await page.tap('.viewer-frame'); await settle(page, 900);
  const p2 = await state(page);
  check('landscape phone panorama grows in immersive', p2.frame.w > p1.frame.w, `${Math.round(p1.frame.w)} → ${Math.round(p2.frame.w)}`);
  await ctx.close();
}

// 4. Deep link focus, history race, tint hairline, zoom.
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '#photo-fog-ridge', { waitUntil: 'networkidle' });
  await settle(page);
  let s = await state(page);
  check('deep link: viewer open with focus inside it', s.open && s.active === 'dialog', s.active);
  const ratioOk = await page.evaluate(() => { const f = document.querySelector('.viewer-frame').getBoundingClientRect(); const d = JSON.parse(document.getElementById('gallery-data').textContent).find((p) => p.id === 'fog-ridge'); return Math.abs(f.width / f.height - d.width / d.height) * f.height < 1; });
  check('frame matches the photo ratio to the pixel (no tint hairline)', ratioOk);
  await page.keyboard.press('Tab');
  const firstTab = await page.evaluate(() => document.activeElement.getAttribute('data-action'));
  check('first Tab stop is Close', firstTab === 'close', firstTab);
  // zoom
  await page.keyboard.press('z'); await settle(page, 600);
  s = await state(page);
  const zoomed = await page.evaluate(() => { const t = getComputedStyle(document.querySelector('.viewer-frame')).transform; const img = document.querySelector('.viewer-full img'); return { t, sizes: img.sizes, src: img.currentSrc.split('/').pop() }; });
  check('Z zooms in and requests the sharpest file', s.cls.includes('is-zoomed') && zoomed.t !== 'none' && /-(2400|3200|1600)\./.test(zoomed.src), JSON.stringify(zoomed));
  await page.keyboard.press('ArrowDown'); await settle(page, 100);
  const panned = await page.evaluate(() => getComputedStyle(document.querySelector('.viewer-frame')).transform);
  check('arrow keys pan while zoomed', panned !== zoomed.t);
  await page.keyboard.press('Escape'); await settle(page, 500);
  s = await state(page);
  check('Esc zooms out first (viewer stays open)', s.open && !s.cls.includes('is-zoomed'));
  // click on photo zooms, click again zooms out
  await page.mouse.click(s.frame.x + s.frame.w / 2, s.frame.y + s.frame.h / 2); await settle(page, 500);
  const z1 = (await state(page)).cls.includes('is-zoomed');
  await page.mouse.click(700, 450); await settle(page, 500);
  const z2 = (await state(page)).cls.includes('is-zoomed');
  check('click photo zooms in, click again zooms out', z1 && !z2);
  // Esc zooms out every time, not only the first (browsers can skip the
  // dialog's cancel event on repeated Esc presses).
  let escOk = true;
  for (let round = 0; round < 3; round++) {
    if (round === 1) { await page.mouse.click(s.frame.x + s.frame.w / 2, s.frame.y + s.frame.h / 2); }
    else await page.keyboard.press('z');
    await settle(page, 450);
    await page.keyboard.press('Escape'); await settle(page, 450);
    const r = await state(page);
    if (!r.open || r.cls.includes('is-zoomed')) escOk = false;
  }
  check('Esc zooms out on every zoom (3 rounds, key and click), viewer stays open', escOk);
  // A mouse drag on the photo is not a click: it doesn't zoom in.
  await page.mouse.move(s.frame.x + s.frame.w / 2, s.frame.y + s.frame.h / 2);
  await page.mouse.down();
  await page.mouse.move(s.frame.x + s.frame.w / 2 + 60, s.frame.y + s.frame.h / 2 + 10, { steps: 6 });
  await page.mouse.up(); await settle(page, 400);
  check('a mouse drag on the unzoomed photo doesn\'t zoom in', !(await state(page)).cls.includes('is-zoomed'));
  await page.keyboard.press('Escape'); await settle(page, 600);
  check('Esc closes', !(await state(page)).open);
  // history race: open, Back, Forward immediately
  await page.click('#photo-dunes .tile-link'); await settle(page);
  await page.goBack();
  await page.goForward();
  await settle(page, 800);
  s = await state(page);
  check('Back then Forward quickly: viewer open on the photo in the URL', s.open && s.hash === '#photo-dunes' && s.idx === '04', JSON.stringify({ open: s.open, hash: s.hash, idx: s.idx }));
  await page.keyboard.press('Escape'); await settle(page, 700);
  s = await state(page);
  check('…and closes cleanly afterwards', !s.open && s.hash === '');
  await ctx.close();
}

// 5. Fast browsing (on a realistic 20 Mbps connection) doesn't fetch every
//    sharp file. Distinct files are counted: the dev server sends no-store,
//    so a preload and its later use show up as two requests.
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.click('#photo-ridgelines .tile-link'); await settle(page, 800);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  const files = new Set();
  page.on('request', (r) => { if (/-(1200|1600|2400|3200)\.(avif|jpg)$/.test(r.url())) files.add(r.url().split('/').pop()); });
  for (let i = 0; i < 10; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
  await settle(page, 1500);
  check('10 rapid presses fetch only a few sharp files', files.size <= 4, `${files.size}: ${[...files].join(' ')}`);
  await ctx.close();
}

// 6. Touch: swipe, swipe down to close, double-tap zoom.
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.tap('#photo-ridgelines .tile-link'); await settle(page);
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x0, y0, x1, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(320, 420, 60, 425); await settle(page, 600);
  check('swipe left → next photo', (await state(page)).idx === '02');
  await swipe(60, 420, 320, 425); await settle(page, 600);
  check('swipe right → previous photo', (await state(page)).idx === '01');
  const f = (await state(page)).frame;
  const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  await tap(f.x + f.w / 2, f.y + f.h / 2); await page.waitForTimeout(80); await tap(f.x + f.w / 2, f.y + f.h / 2);
  await settle(page, 600);
  let s = await state(page);
  check('double-tap zooms (and leaves controls as they were)', s.cls.includes('is-zoomed') && !s.cls.includes('is-immersive'), s.cls);
  await tap(f.x + f.w / 2, f.y + f.h / 2); await page.waitForTimeout(80); await tap(f.x + f.w / 2, f.y + f.h / 2);
  await settle(page, 600);
  await swipe(200, 300, 205, 650); await settle(page, 900);
  s = await state(page);
  check('swipe down closes', !s.open && s.hash === '');
  await ctx.close();
}

// 7. Touch details: taps never close, side arrows work by touch, pinch,
//    the neighbour slides in, pulling down fades the background.
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(base + '#photo-ridgelines', { waitUntil: 'networkidle' });
  await settle(page, 600);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y) => { await touch('touchStart', [{ x, y }]); await touch('touchEnd', []); };
  // tap the empty area above the photo twice: hides then shows controls, never closes
  await tap(195, 150); await settle(page, 900);
  let s = await state(page);
  const hidden = s.cls.includes('is-immersive');
  await tap(195, 150); await settle(page, 900);
  s = await state(page);
  check('touch: tapping outside the photo toggles the controls and never closes', s.open && hidden && !s.cls.includes('is-immersive'), s.cls);
  // pinch out, then back in
  const f = s.frame; const cx = f.x + f.w / 2; const cy = f.y + f.h / 2;
  await touch('touchStart', [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: cx - 30 - i * 12, y: cy, id: 1 }, { x: cx + 30 + i * 12, y: cy, id: 2 }]);
  await touch('touchEnd', []); await settle(page, 500);
  s = await state(page);
  const scaleOut = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.viewer-frame')).transform).a);
  check('touch: pinch out zooms in (controls stay normal size)', s.cls.includes('is-zoomed') && scaleOut > 1.5, `scale ${scaleOut.toFixed(2)}`);
  await touch('touchStart', [{ x: cx - 130, y: cy, id: 1 }, { x: cx + 130, y: cy, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: cx - 130 + i * 14, y: cy, id: 1 }, { x: cx + 130 - i * 14, y: cy, id: 2 }]);
  await touch('touchEnd', []); await settle(page, 600);
  check('touch: pinch in zooms back out', !(await state(page)).cls.includes('is-zoomed'));
  // mid-swipe: the neighbour is visible beside the photo
  await touch('touchStart', [{ x: 300, y: 420 }]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: 300 - i * 25, y: 422 }]);
  const peek = await page.evaluate(() => { const p = document.querySelector('.viewer-peek'); const r = p.getBoundingClientRect(); return { hidden: p.hidden, left: Math.round(r.left), w: Math.round(r.width) }; });
  await touch('touchEnd', []); await settle(page, 700);
  check('touch: during a swipe the next photo slides in alongside', !peek.hidden && peek.left < 390 && peek.w > 0, JSON.stringify(peek));
  check('touch: the swipe lands on the next photo', (await state(page)).idx === '02');
  // pull down part-way: background fades; release early: springs back
  await touch('touchStart', [{ x: 200, y: 300 }]);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: 200, y: 300 + i * 16 }]); await page.waitForTimeout(70); } // slowly: not a flick
  const fade = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.viewer'), '::before').opacity));
  await touch('touchEnd', []); await settle(page, 600);
  s = await state(page);
  check('touch: pulling down fades the background; a short pull springs back', fade < 0.95 && s.open && !s.cls.includes('is-pulling'), `opacity ${fade}`);
  await ctx.close();
}
{
  // Touchscreen laptop: fine pointer (side arrows shown) plus touch.
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await page.goto(base + '#photo-dunes', { waitUntil: 'networkidle' });
  await settle(page, 500);
  // Emulation reports a coarse pointer here, so show the arrows as a
  // touchscreen laptop (fine pointer + touch) would.
  await page.addStyleTag({ content: '.viewer { --side: 84px !important; } .viewer-side { display: grid !important; }' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.setViewportSize({ width: 1439, height: 900 }); await settle(page, 300);
  await page.tap('.viewer-side.next'); await settle(page, 500);
  check('touch tap on a side arrow moves to the next photo', (await state(page)).idx === '05');
  // I while zoomed zooms out first (like Esc) and leaves the details setting alone
  await page.keyboard.press('z'); await settle(page, 400);
  const before = await page.evaluate(() => document.querySelector('.viewer').classList.contains('is-info-hidden'));
  await page.keyboard.press('i'); await settle(page, 400);
  const after = await page.evaluate(() => ({ hidden: document.querySelector('.viewer').classList.contains('is-info-hidden'), zoomed: document.querySelector('.viewer').classList.contains('is-zoomed') }));
  check('I while zoomed zooms out and leaves the details as they were', before === after.hidden && !after.zoomed, JSON.stringify(after));
  await ctx.close();
}
{
  // Forward reopens the viewer; closing then steps back (no dead entry).
  const { ctx, page } = await newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.click('#photo-pines .tile-link'); await settle(page);
  await page.goBack(); await settle(page, 700);
  await page.goForward(); await settle(page, 700);
  await page.keyboard.press('Escape'); await settle(page, 800);
  const st = await page.evaluate(() => ({ open: document.querySelector('dialog').open, state: history.state, hash: location.hash }));
  check('closing after Forward leaves no extra history entry', !st.open && !st.state && st.hash === '', JSON.stringify(st));
  await ctx.close();
}

// 8. Attempt-3 findings: phone details fit, zoomed taps don't jump, mouse
//    drag pans, a failed image keeps the preview, swipe+key race.
for (const [w, h] of [[390, 664], [390, 844]]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  let clipped = 0;
  for (const id of ['ridgelines', 'fog-ridge', 'panorama', 'concrete']) {
    await page.goto(base + '#photo-' + id, { waitUntil: 'networkidle' });
    await settle(page, 400);
    clipped += await page.evaluate(() => { const i = document.querySelector('.viewer-info'); return i.scrollHeight > i.clientHeight + 1 && !i.classList.contains('is-scrollable') ? 1 : 0; });
  }
  const over = await page.evaluate(() => { const i = document.querySelector('.viewer-info'); return i.scrollHeight - i.clientHeight; });
  check(`phone ${w}x${h}: camera data never silently cut off`, clipped === 0, `overflow ${over}px`);
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(base + '#photo-ridgelines', { waitUntil: 'networkidle' });
  await settle(page, 500);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  await tap(300, 200); await page.waitForTimeout(80); await tap(300, 200);
  await settle(page, 600);
  const t1 = await page.evaluate(() => getComputedStyle(document.querySelector('.viewer-frame')).transform);
  await tap(300, 200); await settle(page, 600);
  const t2 = await page.evaluate(() => getComputedStyle(document.querySelector('.viewer-frame')).transform);
  check('touch: tapping a zoomed photo toggles controls without moving it', t1 !== 'none' && t1 === t2, `${t1} → ${t2}`);
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '#photo-dunes', { waitUntil: 'networkidle' });
  await settle(page, 500);
  await page.keyboard.press('z'); await settle(page, 500);
  const t0 = await page.evaluate(() => getComputedStyle(document.querySelector('.viewer-frame')).transform);
  await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(600, 380, { steps: 6 }); await page.mouse.up();
  await settle(page, 300);
  const st = await page.evaluate(() => ({ zoomed: document.querySelector('.viewer').classList.contains('is-zoomed'), t: getComputedStyle(document.querySelector('.viewer-frame')).transform }));
  check('mouse: dragging a zoomed photo pans it (and stays zoomed)', st.zoomed && st.t !== t0);
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.route(/aurora-[0-9a-f]+-(1000|1200|1600|2000|2400)\.(avif|jpg)$/, (r) => r.abort());
  await page.click('#photo-aurora .tile-link'); await settle(page, 1200);
  const st = await page.evaluate(() => ({ full: !!document.querySelector('.viewer-full'), preview: !document.querySelector('.viewer-preview').hidden, slow: document.querySelector('.viewer-frame').classList.contains('is-slow') }));
  check('a photo that fails to load keeps its preview (no broken image)', !st.full && st.preview && !st.slow, JSON.stringify(st));
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await page.goto(base + '#photo-ridgelines', { waitUntil: 'networkidle' });
  await settle(page, 500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 800, y: 400 }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 800 - i * 40, y: 402 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.keyboard.press('ArrowRight');
  await settle(page, 700);
  const peek = await page.evaluate(() => document.querySelector('.viewer-peek').hidden);
  check('a key pressed during a swipe leaves no stray photo on screen', peek);
  await ctx.close();
}

// 9. Reduced motion: opens and closes without animations.
{
  const { ctx, page } = await newPage({ reducedMotion: 'reduce' });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.click('#photo-pines .tile-link'); await settle(page, 200);
  const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().duration > 1).length);
  check('reduced motion: no running animations on open', anims === 0, String(anims));
  await page.keyboard.press('Escape'); await settle(page, 300);
  check('reduced motion: closes', !(await state(page)).open);
  await ctx.close();
}

// 10. Short landscape phones: the details column starts below the floating
//     buttons, scrolls when it must, and nothing runs off sideways.
{
  const bad = [];
  for (const [w, h] of [[568, 320], [640, 360], [667, 375], [740, 360], [844, 390]]) {
    for (const scheme of ['light']) {
      const { ctx, page } = await newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme });
      await page.goto(base + '#photo-ridgelines', { waitUntil: 'networkidle' });
      await settle(page, 400);
      for (let k = 0; k < 17; k++) {
        const r = await page.evaluate(() => {
          const info = document.querySelector('.viewer-info');
          const title = document.querySelector('.viewer-title').getBoundingClientRect();
          const tools = document.querySelector('.viewer-tools').getBoundingClientRect();
          return {
            idx: document.querySelector('.viewer-index').textContent,
            compact: document.querySelector('.viewer').classList.contains('is-compact'),
            titleTop: Math.round(title.top + info.scrollTop), toolsBottom: Math.round(tools.bottom),
            wide: info.scrollWidth - info.clientWidth,
          };
        });
        if (r.compact && (r.titleTop < r.toolsBottom || r.wide > 1)) bad.push(`${w}x${h} #${r.idx}: title ${r.titleTop} vs buttons ${r.toolsBottom}, sideways ${r.wide}px`);
        await page.keyboard.press('ArrowRight'); await settle(page, 120);
      }
      await ctx.close();
    }
  }
  check('landscape phones: details column below the buttons, nothing cut off sideways (5 sizes x 17 photos)', !bad.length, bad.slice(0, 4).join('; '));
}

// 11. Dark backings only where the controls are really over the photo: open
//     a tile from the very top of the screen (the open animation passes
//     under the bar) and check once it has settled.
{
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => { const t = document.getElementById('photo-dunes'); scrollBy(0, t.getBoundingClientRect().top - 20); });
  await settle(page, 200);
  await page.click('#photo-dunes .tile-link'); await settle(page, 700);
  const over = await page.evaluate(() => [...document.querySelectorAll('.is-over-photo')].map((e) => e.className));
  check('no dark backings when the photo sits clear of the controls (opened from the top edge)', over.length === 0, over.join(', '));
  await page.keyboard.press('z'); await settle(page, 500);
  const zoomedOver = await page.evaluate(() => document.querySelector('.viewer-tools').classList.contains('is-over-photo'));
  check('…and they appear when the zoomed photo is under the buttons', zoomedOver);
  await ctx.close();
}

await browser.close();
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(failures ? `\n${failures} check(s) failed` : '\nall viewer checks passed');
process.exitCode = failures ? 1 : 0;
