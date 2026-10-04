// Dev check: which gallery images each device downloads.
// Flags wasted downloads (a photo fetched again at the same or a smaller
// size, or an aborted request) and thumbnails whose file is narrower than
// their display size (soft). A small file followed by a larger one is an
// upgrade (e.g. a saved "L" preference) and is only reported.
// Serve the repo first: npx http-server -p 8123 -c-1 -s .
// Needs Playwright (global install) and Chromium at /opt/pw-browsers/chromium.
//   node tools/dev/download-check.mjs [baseUrl] [--throttle]
import { chromium } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8123/';
const throttle = process.argv.includes('--throttle');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let problems = 0;
for (const [w, h, dpr, mobile, size] of [
  [1280, 800, 1, false, 'm'], [1440, 900, 2, false, 'm'], [1920, 1080, 1, false, 'l'],
  [820, 1180, 2, true, 'm'], [390, 844, 3, true, 'm'], [390, 844, 3, true, 's'],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  if (size !== 'm') await ctx.addInitScript((s) => localStorage.setItem('gallery-size', s), size);
  const page = await ctx.newPage();
  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  }
  const reqs = [];
  const failed = [];
  page.on('request', (r) => { if (r.url().includes('/assets/gallery/')) reqs.push(r.url().split('/').pop()); });
  page.on('requestfailed', (r) => failed.push(r.url().split('/').pop() + ' ' + r.failure()?.errorText));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
  });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const by = {};
  for (const f of reqs) { const k = f.replace(/-[0-9a-f]{8}-\d+\.\w+$/, ''); (by[k] ||= []).push(f.match(/-(\d+)\.(\w+)$/).slice(1).join('.')); }
  const width = (x) => +x.split('.')[0];
  const dup = Object.entries(by).filter(([, v]) => v.some((x, i) => i > 0 && width(x) <= width(v[i - 1])));
  const upgrades = Object.entries(by).filter(([, v]) => v.length > 1);
  const soft = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((t) => {
    const img = t.querySelector('img');
    const need = t.querySelector('picture').getBoundingClientRect().width * devicePixelRatio;
    const have = +((img.currentSrc.match(/-(\d+)\.\w+$/) || [])[1] || 0);
    const largest = Math.max(...img.srcset.split(',').map((c) => parseInt(c.trim().split(' ')[1], 10)));
    return have && have < need * 0.98 && have < largest ? `${t.id.slice(6)} ${have}<${Math.round(need)}` : null;
  }).filter(Boolean));
  const bytes = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/assets/gallery/')).reduce((a, r) => a + r.transferSize, 0));
  const bad = dup.length + failed.length + soft.length;
  problems += bad;
  console.log(`${bad ? '✗' : '✓'} ${w}x${h}@${dpr} ${size.toUpperCase()}${throttle ? ' (20 Mbps)' : ''}: ${reqs.length} requests, ${Math.round(bytes / 1024)} KB` +
    (dup.length ? `\n    wasted (same or smaller file fetched again): ${JSON.stringify(dup)}` : '') +
    (upgrades.length ? `\n    upgrades (ok): ${JSON.stringify(upgrades.filter(([k]) => !dup.some(([d]) => d === k)))}` : '') +
    (failed.length ? `\n    failed: ${failed.join(', ')}` : '') +
    (soft.length ? `\n    soft (file narrower than display): ${soft.join(', ')}` : ''));
  await ctx.close();
}
await browser.close();
process.exitCode = problems ? 1 : 0;
