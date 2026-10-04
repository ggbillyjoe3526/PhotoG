// Simulates gallery rows for several widths and S/M/L using the real
// partition() from assets/js/page.js (run from the repo root after a build).
import fs from 'node:fs';
const src = fs.readFileSync('assets/js/page.js', 'utf8');
const fn = src.slice(src.indexOf('  function partition('), src.indexOf('  /* ---- choosing thumbnail files */'));
const ROW = Function(`return ${/var ROW = (\{[^}]*\})/.exec(src)[1]}`)();
const partition = Function('MAX_PER_ROW', `${fn}; return partition;`)(12);
const html = fs.readFileSync('index.html', 'utf8');
const ratios = JSON.parse(html.match(/id="gallery-data">([^<]*)</)[1]).map((p) => p.width / p.height);
const base = (w) => Math.max(ROW.min, Math.min(ROW.max, ROW.base + ROW.vw * w));
for (const [vw, gap] of [[390, 6], [820, 8], [1280, 10], [1440, 11], [1920, 12]]) {
  const W = vw - 2 * Math.min(48, Math.max(16, vw * 0.032)) - 1;
  const isPhone = vw < 600;
  for (const [s, f] of [['S', isPhone ? 0.45 : 0.6], ['M', 1], ['L', 1.75]]) {
    const minTile = (isPhone ? 64 : 80) * Math.min(1, f + 0.25);
    const rows = partition(ratios, W, gap, base(W) * f, minTile);
    const hs = rows.map((r) => Math.round(r.height));
    console.log(`${String(vw).padStart(4)} ${s}  target ${Math.round(base(W) * f)}  ${rows.map((r, i) => `${r.end - r.start}@${hs[i]}${r.justified ? '' : 'r'}`).join(' ')}   spread ${Math.min(...hs)}-${Math.max(...hs)}`);
  }
}
