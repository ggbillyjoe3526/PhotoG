// Dev check: screenshots of the main states, plus console errors and layout shift.
// Serve the repo first: npx http-server -p 8123 -c-1 -s .
//   node tools/dev/screenshots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
const [base = 'http://127.0.0.1:8123/', out = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const log = [];
const scrollAll = async (p) => {
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } scrollTo(0, 0); });
  await p.waitForLoadState('networkidle');
};
async function shot(name, { width, height, scheme = 'light', full = false, mobile = false, js = true, size, action } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, javaScriptEnabled: js });
  if (size) await ctx.addInitScript((s) => localStorage.setItem('gallery-size', s), size);
  await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${name}: ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`${name}: pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  if (full) await scrollAll(page);
  if (action) await action(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  if (js) log.push(`${name}: CLS ${(await page.evaluate(() => window.__cls)).toFixed(4)}`);
  await ctx.close();
}
await shot('d1440-light', { width: 1440, height: 900 });
await shot('d1440-dark', { width: 1440, height: 900, scheme: 'dark' });
await shot('d1440-S', { width: 1440, height: 900, size: 's' });
await shot('d1440-L', { width: 1440, height: 900, size: 'l' });
await shot('d1440-full', { width: 1440, height: 900, full: true });
await shot('d1280-light', { width: 1280, height: 800 });
await shot('w2560', { width: 2560, height: 1440 });
await shot('t820-light', { width: 820, height: 1180, mobile: true });
await shot('p390-dark-full', { width: 390, height: 844, scheme: 'dark', mobile: true, full: true });
await shot('p390-light', { width: 390, height: 844, mobile: true });
await shot('p390-S', { width: 390, height: 844, mobile: true, size: 's' });
await shot('p390-L', { width: 390, height: 844, mobile: true, size: 'l' });
await shot('nojs-1280', { width: 1280, height: 800, js: false });
await shot('nojs-390', { width: 390, height: 844, mobile: true, js: false });
await shot('viewer-1440-dark', { width: 1440, height: 900, scheme: 'dark', action: async (p) => { await p.click('.tile-link >> nth=0'); await p.waitForTimeout(900); } });
await shot('viewer-390', { width: 390, height: 844, mobile: true, action: async (p) => { await p.click('.tile-link >> nth=2'); await p.waitForTimeout(900); } });
await browser.close();
console.log(log.join('\n'));
