// Dev check of viewer behaviour (keyboard, history, deep links, swipe).
// Serve the repo on :8123 first; screenshots go to $OUT (default ./shots).
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const log = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', e => log.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') log.push('CONSOLE ' + m.text()); });
const st = () => page.evaluate(() => ({ open: document.querySelector('dialog.viewer')?.open, hash: location.hash, idx: document.querySelector('.viewer-index')?.textContent, title: document.querySelector('.viewer-title')?.textContent, focus: document.activeElement.className + '|' + (document.activeElement.closest('.tile')?.id || ''), htmlCls: document.documentElement.className, scrollY: Math.round(scrollY) }));
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await page.keyboard.press('Tab'); // skip link
await page.focus('#photo-dunes .tile-link');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
log.push(['open via Enter', await st()]);
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
log.push(['after 2x right', await st()]);
await page.keyboard.press('End'); await page.waitForTimeout(200);
log.push(['End', await st()]);
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
log.push(['right at end', await st()]);
await page.keyboard.press('i'); await page.waitForTimeout(200);
log.push(['info hidden?', await page.evaluate(() => document.querySelector('.viewer').classList.contains('is-info-hidden'))]);
await page.keyboard.press('i');
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
log.push(['after Esc', await st()]);
// back button behavior
await page.click('#photo-ridgelines .tile-link'); await page.waitForTimeout(300);
log.push(['click open', await st()]);
await page.goBack(); await page.waitForTimeout(400);
log.push(['after Back', await st()]);
await page.goForward(); await page.waitForTimeout(400);
log.push(['after Forward', await st()]);
await page.click('.viewer-tools [data-action="close"]'); await page.waitForTimeout(400);
log.push(['after close btn', await st()]);
// deep link
await page.goto('http://127.0.0.1:8123/#photo-aurora', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
log.push(['deep link', await st()]);
await page.screenshot({ path: (process.env.OUT || 'shots') + '/deeplink.png' });
await page.mouse.click(640, 400); // click on image area
await page.waitForTimeout(200);
log.push(['click on image', await st()]);
await page.mouse.click(30, 400); // stage background left edge (padding)
await page.waitForTimeout(400);
log.push(['click bg', await st()]);
// check what got downloaded for the viewer image
const res = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('aurora')).map(r => r.name.split('/').pop() + ' ' + r.transferSize));
log.push(['aurora resources', res]);
await ctx.close();

// Mobile swipe
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const mp = await m.newPage();
mp.on('pageerror', e => log.push('M PAGEERROR ' + e.message));
await mp.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await mp.tap('#photo-ridgelines .tile-link'); await mp.waitForTimeout(400);
const swipe = async (x0, y0, x1, y1) => {
  const cdp = await m.newCDPSession(mp);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const mst = () => mp.evaluate(() => ({ open: document.querySelector('dialog.viewer')?.open, idx: document.querySelector('.viewer-index')?.textContent, imm: document.querySelector('.viewer').classList.contains('is-immersive') }));
await swipe(300, 420, 80, 425); await mp.waitForTimeout(400);
log.push(['swipe left', await mst()]);
await swipe(80, 420, 300, 425); await mp.waitForTimeout(400);
log.push(['swipe right', await mst()]);
await mp.tap('.viewer-frame'); await mp.waitForTimeout(300);
log.push(['tap image', await mst()]);
await mp.screenshot({ path: (process.env.OUT || 'shots') + '/m-immersive.png' });
await mp.tap('.viewer-frame'); await mp.waitForTimeout(300);
await swipe(200, 300, 205, 600); await mp.waitForTimeout(500);
log.push(['swipe down', await mst()]);
await browser.close();
console.log(log.map(l => JSON.stringify(l)).join('\n'));
