// Integration tests: run the real build against a throwaway copy of the site.
//   npm test   (takes a few seconds; uses small generated photos)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root;

function build(...args) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'build.mjs'), ...args], {
    env: { ...process.env, PHOTOG_ROOT: root }, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}
const html = () => readFileSync(path.join(root, 'index.html'), 'utf8');
const tiles = () => (html().match(/<li class="tile"/g) ?? []).length;
const photo = (name, buffer) => writeFileSync(path.join(root, 'photos', name), buffer);

async function jpeg(w, h, rgb) {
  return sharp({ create: { width: w, height: h, channels: 3, background: rgb } })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${h / 3}" fill="#fff"/></svg>`) }])
    .jpeg({ quality: 90 }).toBuffer();
}

before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'photog-test-'));
  for (const f of ['index.html', 'site.json']) cpSync(path.join(REPO, f), path.join(root, f));
  mkdirSync(path.join(root, 'assets', 'js'), { recursive: true });
  cpSync(path.join(REPO, 'assets', 'js', 'page.js'), path.join(root, 'assets', 'js', 'page.js'));
  mkdirSync(path.join(root, 'photos'));
  // Start from an empty gallery.
  writeFileSync(path.join(root, 'index.html'), html().replace(/(<!-- build:gallery -->)[\s\S]*?(<!-- \/build:gallery -->)/, '$1$2'));
  photo('01-red.jpg', await jpeg(600, 400, '#a33'));
  photo('02-blue.jpg', await jpeg(400, 600, '#33a'));
});
after(() => rmSync(root, { recursive: true, force: true }));

test('builds a gallery', () => {
  const r = build();
  assert.equal(r.code, 0, r.out);
  assert.equal(tiles(), 2);
  assert.ok(readdirSync(path.join(root, 'assets', 'gallery')).some((f) => /^red-[0-9a-f]{8}-320\.avif$/.test(f)));
  assert.ok(existsSync(path.join(root, 'photos', 'details.json')));
});

test('clashing names stop the build and change nothing', () => {
  const before = html();
  cpSync(path.join(root, 'photos', '01-red.jpg'), path.join(root, 'photos', '07-red.jpg'));
  const r = build();
  rmSync(path.join(root, 'photos', '07-red.jpg'));
  assert.equal(r.code, 1);
  assert.match(r.out, /same name/);
  assert.equal(html(), before);
});

test('a damaged JPEG stops the build; published images are kept', async () => {
  const before = html();
  const good = readdirSync(path.join(root, 'assets', 'gallery'));
  const damaged = Buffer.from(await jpeg(600, 400, '#3a3'));
  for (let i = Math.floor(damaged.length * 0.6); i < Math.floor(damaged.length * 0.6) + 300; i++) damaged[i] = (damaged[i] * 7 + 13) & 255;
  photo('03-green.jpg', damaged);
  rmSync(path.join(root, 'photos', '02-blue.jpg')); // would normally prune its images
  const r = build();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /damaged|incomplete/);
  assert.equal(html(), before);
  for (const f of good) assert.ok(existsSync(path.join(root, 'assets', 'gallery', f)), `${f} was deleted`);
  rmSync(path.join(root, 'photos', '03-green.jpg'));
  photo('02-blue.jpg', await jpeg(400, 600, '#33a'));
});

test('an empty photos folder never empties a published gallery', () => {
  const before = html();
  const hold = path.join(root, 'hold');
  mkdirSync(hold);
  for (const f of readdirSync(path.join(root, 'photos')).filter((f) => f.endsWith('.jpg'))) {
    cpSync(path.join(root, 'photos', f), path.join(hold, f));
    rmSync(path.join(root, 'photos', f));
  }
  const r = build();
  assert.equal(r.code, 1);
  assert.match(r.out, /Nothing was changed/);
  assert.equal(html(), before);
  for (const f of readdirSync(hold)) cpSync(path.join(hold, f), path.join(root, 'photos', f));
});

test('a rebuild with nothing changed encodes nothing and leaves index.html alone', () => {
  const before = html();
  const r = build();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 encoded/);
  assert.equal(html(), before);
});
