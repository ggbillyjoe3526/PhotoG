#!/usr/bin/env node
/**
 * Copy just the website (index.html + assets/) into dist/, for hosts where
 * you choose a folder to publish (Netlify, Cloudflare Pages, any web host).
 * Also writes dist/_headers so hosts that read it cache images and fonts
 * for a long time (their file names change whenever they change).
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
  filter: (src) => !/\.tmp(-\d+)?$/.test(src),
});
await writeFile(path.join(DIST, '_headers'), [
  '/assets/gallery/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/assets/fonts/*',
  '  Cache-Control: public, max-age=604800', // a week: font names don't change
  '',
].join('\n'));
console.log('Website copied to dist/ (index.html, assets/). Publish that folder.');
