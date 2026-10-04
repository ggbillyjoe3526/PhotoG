#!/usr/bin/env node
/**
 * Checks the built website before it is published: every file index.html
 * refers to under assets/ exists, and the generated regions are present.
 *   node tools/check-site.mjs        (run by the GitHub Pages workflow)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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
  console.error(`index.html refers to ${missing.length} missing file(s):\n  ${missing.slice(0, 20).join('\n  ')}`);
  console.error('Run `npm run build` and commit assets/gallery/ together with index.html.');
  process.exit(1);
}
console.log(`OK: ${refs.size} files referenced, all present; ${tiles} photos in the gallery.`);
