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

function run(script, ...args) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', script), ...args], {
    env: { ...process.env, PHOTOG_ROOT: root }, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
}
const build = (...args) => run('build.mjs', ...args);
const details = () => JSON.parse(readFileSync(path.join(root, 'photos', 'details.json'), 'utf8'));
const setDetails = (value) => writeFileSync(path.join(root, 'photos', 'details.json'), JSON.stringify(value, null, 2));
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
  // Everything under assets/ except the generated images.
  cpSync(path.join(REPO, 'assets'), path.join(root, 'assets'), {
    recursive: true, filter: (src) => !src.startsWith(path.join(REPO, 'assets', 'gallery')),
  });
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
  const galleryOf = (h) => /<!-- build:gallery -->[\s\S]*<!-- \/build:gallery -->/.exec(h)[0];
  const hold = path.join(root, 'hold');
  mkdirSync(hold);
  const originals = readdirSync(path.join(root, 'photos')).filter((f) => f.endsWith('.jpg'));
  for (const f of originals) {
    cpSync(path.join(root, 'photos', f), path.join(hold, f));
    rmSync(path.join(root, 'photos', f));
  }
  const site = path.join(root, 'site.json');
  const siteText = readFileSync(site, 'utf8');
  const detailsText = readFileSync(path.join(root, 'photos', 'details.json'), 'utf8');
  try {
    // 1. No originals at all (a fresh copy elsewhere): the text is updated,
    //    the gallery kept exactly as it is.
    const before = html();
    writeFileSync(site, siteText.replace(/"name": "[^"]*"/, '"name": "Text Only"'));
    let r = build();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /gallery of 2 photos was kept/);
    assert.match(html(), /Text Only/);
    assert.equal(galleryOf(html()), galleryOf(before));
    assert.equal(run('check-site.mjs').code, 0);

    // 2. details.json edited there: can't be applied; the publish check says so.
    const d = details();
    d.red.title = 'Needs the originals';
    setDetails(d);
    r = build();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /details\.json has changed/);
    assert.doesNotMatch(html(), /Needs the originals/);
    r = run('check-site.mjs');
    assert.equal(r.code, 1);
    assert.match(r.out, /photos\/details\.json changed/);
    writeFileSync(path.join(root, 'photos', 'details.json'), detailsText);

    // 3. Something hidden in photos/, or no record of the gallery: refused.
    const now = html();
    writeFileSync(path.join(root, 'photos', '_draft.jpg'), readFileSync(path.join(hold, originals[0])));
    r = build();
    assert.equal(r.code, 1);
    assert.match(r.out, /Nothing was changed/);
    rmSync(path.join(root, 'photos', '_draft.jpg'));
    const manifest = path.join(root, 'assets', 'gallery', 'gallery.json');
    const kept = readFileSync(manifest);
    rmSync(manifest);
    r = build();
    assert.equal(r.code, 1);
    assert.match(r.out, /Nothing was changed/);
    assert.equal(html(), now);
    writeFileSync(manifest, kept);
  } finally {
    writeFileSync(site, siteText);
    writeFileSync(path.join(root, 'photos', 'details.json'), detailsText);
    for (const f of readdirSync(hold)) cpSync(path.join(hold, f), path.join(root, 'photos', f));
    rmSync(hold, { recursive: true, force: true });
  }
  assert.equal(build().code, 0);
});

test('a rebuild with nothing changed encodes nothing and leaves index.html alone', () => {
  const before = html();
  const r = build();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 encoded/);
  assert.equal(html(), before);
});

/** A large photo (bigger than the largest published size, so the build
 *  shrinks it while decoding) with detail in it. */
async function bigJpeg() {
  const w = 4400;
  const h = 2900;
  const stripes = Array.from({ length: 40 }, (_, i) => `<rect x="${i * 110}" y="0" width="55" height="${h}" fill="hsl(${i * 9},60%,50%)"/>`).join('');
  return sharp({ create: { width: w, height: h, channels: 3, background: '#556' } })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}">${stripes}<circle cx="${w / 2}" cy="${h / 2}" r="${h / 3}" fill="#fff"/></svg>`) }])
    .jpeg({ quality: 90 }).toBuffer();
}

test('a large JPEG that was cut off stops the build', async () => {
  const before = html();
  const whole = await bigJpeg();
  photo('04-big-cut.jpg', whole.subarray(0, Math.floor(whole.length * 0.6)));
  const r = build();
  rmSync(path.join(root, 'photos', '04-big-cut.jpg'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /04-big-cut\.jpg: is incomplete/);
  assert.match(r.out, /nothing was encoded/);
  assert.equal(html(), before);
});

test('a large JPEG damaged in the middle stops the build', async () => {
  const before = html();
  const damaged = Buffer.from(await bigJpeg());
  const at = Math.floor(damaged.length * 0.5);
  for (let i = at; i < at + 400; i++) damaged[i] = (damaged[i] * 7 + 13) & 255;
  photo('04-big-damaged.jpg', damaged);
  const r = build();
  rmSync(path.join(root, 'photos', '04-big-damaged.jpg'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /04-big-damaged\.jpg: is (damaged|incomplete)/);
  assert.equal(html(), before);
});

test('16-bit files with a colour profile keep their colours', async () => {
  const png16 = await sharp({ create: { width: 360, height: 240, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .toColourspace('rgb16').withIccProfile('srgb').png().toBuffer();
  assert.equal((await sharp(png16).metadata()).depth, 'ushort');
  photo('05-deep-red.png', png16);
  const r = build();
  assert.equal(r.code, 0, r.out);
  const file = readdirSync(path.join(root, 'assets', 'gallery')).find((f) => /^deep-red-[0-9a-f]{8}-360\.jpg$/.test(f));
  assert.ok(file, 'no 360w JPEG');
  const { data } = await sharp(path.join(root, 'assets', 'gallery', file)).extract({ left: 170, top: 110, width: 20, height: 20 })
    .resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  for (const [got, want] of [[data[0], 200], [data[1], 40], [data[2], 40]]) assert.ok(Math.abs(got - want) <= 4, `got ${[...data]}`);
  rmSync(path.join(root, 'photos', '05-deep-red.png'));
  assert.equal(build().code, 0);
});

test('renaming a photo reuses its images and moves its text', () => {
  const d = details();
  d.red.title = 'Red study';
  setDetails(d);
  assert.equal(build().code, 0);
  assert.match(html(), /Red study/);
  cpSync(path.join(root, 'photos', '01-red.jpg'), path.join(root, 'photos', '01-crimson.jpg'));
  rmSync(path.join(root, 'photos', '01-red.jpg'));
  const r = build();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /renamed/);
  assert.match(r.out, /0 encoded/);
  assert.match(html(), /id="photo-crimson"[\s\S]*Red study/);
  assert.equal(details().crimson.title, 'Red study');
  assert.equal(details().red, undefined);
});

test('"hide": true leaves a photo out and keeps its text', () => {
  const d = details();
  d.blue = { ...d.blue, caption: 'Kept', hide: true };
  setDetails(d);
  const r = build();
  assert.equal(r.code, 0, r.out);
  assert.equal(tiles(), 1);
  assert.match(r.out, /Hidden \("hide": true/);
  assert.equal(details().blue.caption, 'Kept');
  assert.doesNotMatch(r.out, /keeps text for photos that are not in photos/);
  d.blue.hide = false;
  setDetails(d);
  assert.equal(build().code, 0);
  assert.equal(tiles(), 2);
});

test('a damaged build cache is replaced, not fatal', () => {
  for (const content of ['null', '{ broken', '{"files": 3}']) {
    writeFileSync(path.join(root, 'photos', '.build-cache.json'), content);
    const r = build();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /build-cache\.json was damaged/);
    assert.match(r.out, /0 encoded/);
  }
});

test('the publish check notices a page that was not rebuilt', () => {
  assert.equal(build().code, 0);
  let r = run('check-site.mjs');
  assert.equal(r.code, 0, r.out);
  const site = path.join(root, 'site.json');
  const original = readFileSync(site, 'utf8');
  writeFileSync(site, original.replace(/"name": "[^"]*"/, '"name": "Someone Else"'));
  r = run('check-site.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /out of date/);
  assert.equal(build().code, 0);
  assert.equal(run('check-site.mjs').code, 0);
  writeFileSync(site, original);
  assert.equal(build().code, 0);
});

test('a harmless quirk is noted; the same quirk with damage is not let through', async () => {
  const quirk = (b) => {
    const i = b.indexOf(Buffer.from([0xff, 0xda])); // stray bytes before the image data
    return Buffer.concat([b.subarray(0, i), Buffer.from([1, 2, 3]), b.subarray(i)]);
  };
  const before = html();
  const damaged = quirk(await bigJpeg());
  const at = Math.floor(damaged.length * 0.6);
  for (let i = at; i < at + 300; i++) damaged[i] = (damaged[i] * 7 + 13) & 255;
  photo('06-quirky.jpg', damaged);
  let r = build();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /06-quirky\.jpg: is damaged/);
  assert.equal(html(), before);

  photo('06-quirky.jpg', quirk(await jpeg(900, 600, '#a83')));
  r = build();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /06-quirky\.jpg: has a harmless quirk/);
  assert.equal(tiles(), 3);
  rmSync(path.join(root, 'photos', '06-quirky.jpg'));
  assert.equal(build().code, 0);
});
