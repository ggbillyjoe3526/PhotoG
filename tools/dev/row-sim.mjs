// Simulates gallery rows for several widths and S/M/L (run from the repo root).
import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8');
const data = JSON.parse(html.match(/id="gallery-data">([^<]*)</)[1]);
const ratios = data.map(p => p.width/p.height);
const F = { s: 0.6, m: 1, l: 1.75 };
function base(W) { return Math.max(220, Math.min(440, 200 + 0.09 * W)); }
function partition(ratios, width, gap, target, minTile) {
  const n = ratios.length, cost = Array(n+1).fill(Infinity), from = Array(n+1); cost[0]=0;
  for (let end=1; end<=n; end++) { let sum=0, minAr=Infinity;
    for (let start=end-1; start>=0 && end-start<=12; start--) { sum+=ratios[start]; minAr=Math.min(minAr, ratios[start]); const count=end-start; const h=(width-gap*(count-1))/sum;
      if (h < target*0.4 && count>1) break;
      let c = 0;
      if (!(end===n && h > target*1.3)) {
        const d=Math.log(h/target); c=d*d*(h>target?1.5:1);
        if (h>target*1.3) { const e=Math.log(h/(target*1.3)); c+=4*e*e; }
        if (h<target*0.8) { const e=Math.log(h/(target*0.8)); c+=4*e*e; }
        if (count>1 && h*minAr < minTile) c += 10;
      }
      if (cost[start]+c<cost[end]) { cost[end]=cost[start]+c; from[end]=start; } } }
  const rows=[]; for (let e=n; e>0; e=from[e]) { const s=from[e]; let t=0; for(let i=s;i<e;i++) t+=ratios[i]; let h=(width-gap*(e-s-1))/t; const j=!(e===n && h>target*1.3); rows.unshift(`${e-s}@${Math.round(j?h:target)}${j?'':'r'}`); } return rows;
}
for (const [W,gap,vh] of [[357,6,844],[767,8,1180],[1185,10,800],[1333,11,900],[1810,12,1080],[2200,12,1300]]) {
  for (const s of ['s','m','l']) { const t = base(W)*(W<600 && s==='s' ? 0.45 : F[s]); console.log(String(W).padStart(4), s, 'target', Math.round(t), partition(ratios, W, gap, t, W<600?64:80).join(' ')); }
}
