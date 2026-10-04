// Simulates gallery rows using the real partition() from assets/js/page.js
// (run from the repo root after a build).
//   node tools/dev/row-sim.mjs            rows at a few common widths
//   node tools/dev/row-sim.mjs --sweep    last-row quality from 360 to 2600px
import fs from 'node:fs';
const file = process.argv.find((a) => a.endsWith('.js')) ?? 'assets/js/page.js';
const src = fs.readFileSync(file, 'utf8');
const fn = src.slice(src.indexOf('  function partition('), src.indexOf('  /* ---- choosing thumbnail files */'));
const ROW = Function(`return ${/var ROW = (\{[^}]*\})/.exec(src)[1]}`)();
const partition = Function('MAX_PER_ROW', `${fn}; return partition;`)(12);
const html = fs.readFileSync('index.html', 'utf8');
const ratios = JSON.parse(html.match(/id="gallery-data">([^<]*)</)[1]).map((p) => p.width / p.height);
const base = (w) => Math.max(ROW.min, Math.min(ROW.max, ROW.base + ROW.vw * w));

function rows(vw, s, vh = 900) {
  const gutter = Math.max(Math.min(48, Math.max(16, vw * 0.032)), (vw - 2200) / 2);
  const W = vw - 2 * gutter - 1;
  const gap = Math.min(12, Math.max(6, vw * 0.0075));
  const phone = vw <= 599;
  const f = s === 'S' ? (phone ? 0.45 : 0.6) : s === 'L' ? 1.75 : 1;
  let target = base(W) * f;
  if (s !== 'S') target = Math.min(target, (vh - 40) * 0.9);
  const r = partition(ratios, W, gap, target, (phone ? 64 : 80) * Math.min(1, f + 0.25));
  const last = r.at(-1);
  const sum = ratios.slice(last.start, last.end).reduce((a, b) => a + b, 0);
  const fill = Math.min(1, (sum * last.height + gap * (last.end - last.start - 1)) / W);
  const prev = r.length > 1 ? r.at(-2).height : last.height;
  return { r, target, last, fill, tall: last.height > prev * 1.1, single: last.end - last.start === 1 && ratios.length > 1 };
}

if (process.argv.includes('--sweep')) {
  for (const s of ['S', 'M', 'L']) {
    let singles = 0, tall = 0, n = 0, fillSum = 0;
    for (let vw = 360; vw <= 2600; vw += 20) {
      const x = rows(vw, s);
      n++; fillSum += x.fill; if (x.single) singles++; if (x.tall) tall++;
    }
    console.log(`${s}: lone last photo ${singles}/${n}, last row taller than the one above ${tall}/${n}, mean last-row fill ${(fillSum / n).toFixed(2)}`);
  }
} else {
  for (const vw of [390, 820, 1280, 1440, 1920, 2560]) {
    for (const s of ['S', 'M', 'L']) {
      const x = rows(vw, s);
      const hs = x.r.map((r) => Math.round(r.height));
      console.log(`${String(vw).padStart(4)} ${s}  target ${Math.round(x.target)}  ${x.r.map((r, i) => `${r.end - r.start}@${hs[i]}${r.justified ? '' : 'r'}`).join(' ')}   last fill ${x.fill.toFixed(2)}`);
    }
  }
}
