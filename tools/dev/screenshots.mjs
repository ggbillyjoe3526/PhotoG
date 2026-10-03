// Dev check. Serve the repo first: npx http-server -p 8123 -c-1 -s .
// Needs Playwright (global install) and Chromium at /opt/pw-browsers/chromium.
// Usage: node tools/dev/screenshots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
const [base = 'http://127.0.0.1:8123/', out = '.'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
async function shot(name, { width, height, scheme = 'light', full = false, mobile = false, action } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${name}: ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`${name}: requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  if (action) await action(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  await ctx.close();
}
await shot('desktop-light', { width: 1440, height: 900 });
await shot('desktop-dark', { width: 1440, height: 900, scheme: 'dark' });
await shot('desktop-light-full', { width: 1440, height: 900, full: true, action: async (p) => { await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); }); await p.waitForLoadState('networkidle'); } });
await shot('phone-dark-full', { width: 390, height: 844, scheme: 'dark', mobile: true, full: true, action: async (p) => { await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); }); await p.waitForLoadState('networkidle'); } });
await shot('viewer-desktop-dark', { width: 1440, height: 900, scheme: 'dark', action: async (p) => { await p.click('.tile-link >> nth=0'); await p.waitForTimeout(1200); } });
await shot('viewer-desktop-light-portrait', { width: 1440, height: 900, action: async (p) => { await p.click('.tile-link >> nth=1'); await p.waitForTimeout(1200); } });
await shot('viewer-phone-light', { width: 390, height: 844, mobile: true, action: async (p) => { await p.click('.tile-link >> nth=2'); await p.waitForTimeout(1200); } });
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console errors / failed requests');
