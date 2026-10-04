// Dev check: switching S/M/L keeps the photo at the centre of the screen in place.
// Serve the repo on :8123 first.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const centre = () => { const cx = innerWidth / 2, cy = innerHeight / 2; let best, d = 1e9; for (const t of document.querySelectorAll('.tile')) { const r = t.getBoundingClientRect(); const dx = Math.max(r.left - cx, 0, cx - r.right), dy = Math.max(r.top - cy, 0, cy - r.bottom); if (dx * dx + dy * dy < d) { d = dx * dx + dy * dy; best = t; } } return best.id; };
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
  await page.evaluate(() => scrollTo({ top: 1400, behavior: 'instant' }));
  const res = [];
  for (const s of ['s', 'l', 'm', 'l', 's']) {
    const id = await page.evaluate(centre);
    const before = await page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), id);
    await page.evaluate((s) => document.querySelector(`.size-control [data-size="${s}"]`).click(), s);
    await page.waitForTimeout(80);
    const after = await page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), id);
    res.push(`${s}: ${id.slice(6)} ${before}->${after}`);
  }
  console.log(w, res.join(' | '));
  await page.close();
}
await browser.close();
