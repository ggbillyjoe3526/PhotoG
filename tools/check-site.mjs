#!/usr/bin/env node
/**
 * Checks the built website before it is published:
 *  - every file index.html refers to under assets/ exists;
 *  - index.html was built from the current site.json, photos/details.json
 *    and assets/js/page.js (e.g. not edited on github.com without a rebuild).
 *   node tools/check-site.mjs        (run by the GitHub Pages workflow)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FINGERPRINT_FILES, FINGERPRINT_MARK, sourceFingerprint } from './build.mjs';

const ROOT = process.env.PHOTOG_ROOT ? path.resolve(process.env.PHOTOG_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const problems = [];

const read = (f) => { try { return readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
const built = FINGERPRINT_MARK.exec(html)?.[1];
const now = sourceFingerprint(FINGERPRINT_FILES.map(read));
if (!built) problems.push('index.html has no build fingerprint. Run `npm run build` and commit the result.');
else if (built !== now) {
  problems.push(
    `index.html is out of date: ${FINGERPRINT_FILES.join(', ')} changed since it was built.\n` +
    '  Run `npm run build` on your computer, then commit and push index.html (and assets/, photos/details.json).',
  );
}

const refs = new Set();
for (const m of html.matchAll(/(?:src|href|srcset)="([^"]+)"/g)) {
  for (const part of m[1].split(',')) {
    const url = part.trim().split(/\s+/)[0];
    if (url.startsWith('assets/')) refs.add(url);
  }
}
const missing = [...refs].filter((ref) => !existsSync(path.join(ROOT, ref)));
const tiles = (html.match(/<li class="tile"/g) ?? []).length;
if (missing.length) {
  problems.push(
    `index.html refers to ${missing.length} missing file(s):\n    ${missing.slice(0, 20).join('\n    ')}\n` +
    '  Run `npm run build` and commit assets/gallery/ together with index.html.',
  );
}
if (problems.length) {
  console.error(`Not published:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`OK: ${refs.size} files referenced, all present; ${tiles} photos in the gallery.`);
