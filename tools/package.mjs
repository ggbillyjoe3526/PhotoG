#!/usr/bin/env node
/**
 * Copy just the website (index.html + assets/) into dist/, for hosts where
 * you choose a folder to publish (Netlify, Cloudflare Pages, any web host).
 * Also writes dist/_headers for hosts that read it: generated images are
 * cached for good (their names change whenever they change), fonts for a
 * week. `npm run package` first runs tools/check-site.mjs, so a page that
 * wasn't rebuilt after an edit is never published.
 *   npm run package
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
await cp(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), {
  recursive: true,
  // Not the build's leftovers, nor its record of the gallery (not needed online).
  filter: (src) => !/\.tmp(-\d+)?$/.test(src) && !src.endsWith(path.join('gallery', 'gallery.json')),
});
await writeFile(path.join(DIST, '_headers'), [
  '/assets/gallery/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  // The stylesheet and viewer script are linked with ?v=<content hash>.
  '/assets/css/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/assets/js/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/assets/fonts/*',
  '  Cache-Control: public, max-age=604800', // a week: font names don't change
  '',
].join('\n'));
console.log('Website copied to dist/ (index.html, assets/). Publish that folder.');
