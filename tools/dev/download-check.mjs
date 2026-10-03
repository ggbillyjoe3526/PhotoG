// Dev check. Serve the repo first: npx http-server -p 8123 -c-1 -s .
// Needs Playwright (global install) and Chromium at /opt/pw-browsers/chromium.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [w, h, dpr, mobile] of [[1280, 800, 1, false], [1440, 900, 2, false], [390, 844, 3, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', r => { if (r.url().includes('/assets/gallery/')) reqs.push(r.url().split('/').pop()); });
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().split('/').pop()));
  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } });
  await page.waitForLoadState('networkidle');
  const by = {};
  for (const f of reqs) { const k = f.replace(/-[0-9a-f]{8}-\d+\.\w+$/, ''); (by[k] ||= []).push(f.match(/-(\d+)\.(\w+)$/).slice(1).join('.')); }
  const dup = Object.entries(by).filter(([, v]) => v.length > 1);
  const bytes = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('/assets/gallery/')).reduce((a, r) => a + r.transferSize, 0));
  console.log(`${w}x${h}@${dpr}: ${reqs.length} requests, ${Math.round(bytes / 1024)} KB, failed=${failed.length}, duplicates:`, JSON.stringify(dup));
  await ctx.close();
}
await browser.close();
