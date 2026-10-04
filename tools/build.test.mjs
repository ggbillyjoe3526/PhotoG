// Unit tests for the build's parsing and formatting:  npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';

import {
  decodeEntities, describe, describeJsonError, eagerSizes, escapeHtml, explainError, formatCamera, formatDate, formatShutter,
  isHiddenFile, nameInfo, normaliseTyped, num, pageFunction, pageSetting, rowCss, scriptJson, sourceFingerprint, text, widthLadder,
} from './build.mjs';

const PAGE_JS = readFileSync(new URL('../assets/js/page.js', import.meta.url), 'utf8');
const STYLE = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');

test('nameInfo strips order numbers and dates, keeps real numbers', () => {
  assert.equal(nameInfo('03-horizon.jpg').slug, 'horizon');
  assert.equal(nameInfo('7_fog-line.jpg').title, 'Fog line');
  assert.equal(nameInfo('01 Harbour.jpg').slug, 'harbour');
  assert.equal(nameInfo('100 Days.jpg').slug, '100-days');
  assert.equal(nameInfo('2024-06-21_morning.jpg').slug, 'morning');
  assert.equal(nameInfo('01-2024-06-21-morning.jpg').slug, 'morning');
  assert.equal(nameInfo('Café du Monde.jpg').slug, 'cafe-du-monde');
  assert.equal(nameInfo('Smørrebrød.jpg').slug, 'smorrebrod');
  assert.equal(nameInfo('富士山.jpg').slug, '富士山');
  assert.equal(nameInfo('富士山.jpg').fileSlug, 'photo');
});

test('camera file names make no title and are never hidden', () => {
  assert.equal(nameInfo('DSC_1234.jpg').title, '');
  assert.equal(nameInfo('IMG_0042.jpg').title, '');
  assert.equal(isHiddenFile('_DSC1234.jpg'), false);
  assert.equal(isHiddenFile('_MG_1234.jpg'), false);
  assert.equal(isHiddenFile('_IGP0042.jpg'), false);
  assert.equal(isHiddenFile('_1000123.jpg'), false);
  assert.equal(isHiddenFile('_draft-sunset.jpg'), true);
  assert.equal(isHiddenFile('sunset.jpg'), false);
  // Cameras write upper case: these are the owner's own names, so hidden.
  assert.equal(isHiddenFile('_old2024.jpg'), true);
  assert.equal(isHiddenFile('_bw_2024.jpg'), true);
  assert.equal(nameInfo('R0001234.JPG').title, '');
});

test('XMP text is decoded once', () => {
  assert.equal(decodeEntities('Light &amp; Shadow'), 'Light & Shadow');
  assert.equal(text({ value: 'Low tide &#x2014; the &quot;Sillon&quot;&#xA;beach' }), 'Low tide — the "Sillon" beach');
  assert.equal(text([{ value: '' }, { value: 'Second' }]), 'Second');
});

test('camera names are tidied', () => {
  assert.equal(formatCamera('NIKON CORPORATION', 'NIKON Z 8'), 'Nikon Z 8');
  assert.equal(formatCamera('Canon', 'Canon EOS R5'), 'Canon EOS R5');
  assert.equal(formatCamera('SONY', 'ILCE-7RM5'), 'Sony A7R V');
  assert.equal(formatCamera('FUJIFILM', 'X-T5'), 'Fujifilm X-T5');
  assert.equal(formatCamera('', ''), '');
});

test('exposure values', () => {
  assert.equal(formatShutter(1 / 320), '1/320s');
  assert.equal(formatShutter(2), '2s');
  assert.equal(formatShutter(0.3), '0.3s');
  assert.equal(num('56/10'), 5.6);
  assert.equal(num([100]), 100);
});

test('dates at each privacy level', () => {
  const d = new Date(2024, 9, 12, 18, 41);
  assert.equal(formatDate(d, 'day'), '2024-10-12');
  assert.equal(formatDate(d, 'month'), 'October 2024');
  assert.equal(formatDate(d, 'year'), '2024');
  assert.equal(formatDate(d, 'none'), '');
  assert.equal(formatDate('2019-07-14T18:30:00+02:00', 'day'), '2019-07-14');
});

const META = {
  title: 'Ridgelines', description: 'Five ridges.', Sublocation: '12 Hidden Lane', City: 'Cortina', Country: 'Italy',
  Make: 'FUJIFILM', Model: 'X-T5', LensModel: 'XF70-300mm', FocalLength: 210, FocalLengthIn35mmFormat: 315,
  FNumber: 8, ExposureTime: 1 / 320, ISO: 160, DateTimeOriginal: new Date(2024, 9, 12),
};

test('describe: privacy defaults leave out the street and the day', () => {
  const d = describe(META, {}, { title: '' });
  assert.equal(d.location, 'Cortina, Italy');
  assert.equal(d.date, 'October 2024');
  assert.equal(d.exif.focal35, '315mm');
  assert.equal(describe(META, {}, { title: '' }, { location: 'full', date: 'day' }).location, '12 Hidden Lane, Cortina, Italy');
});

test('describe: typed text wins, "-" hides, exif:false keeps typed camera data', () => {
  const d = describe(META, { title: 'Ridges', location: '-', iso: '-', camera: 'Hasselblad 500C/M' });
  assert.equal(d.title, 'Ridges');
  assert.equal(d.location, '');
  assert.equal(d.exif.iso, undefined);
  assert.equal(d.exif.camera, 'Hasselblad 500C/M');
  const film = describe(META, { exif: false, camera: 'Leica M6', lens: 'Summicron 35', aperture: 'f/5.6' });
  assert.deepEqual(film.exif, { camera: 'Leica M6', lens: 'Summicron 35', aperture: 'f/5.6' });
});

test('describe: alt text falls back to caption, then title', () => {
  assert.equal(describe(META).alt, 'Five ridges.');
  assert.equal(describe({ title: 'Only a title' }).altSource, 'title');
  assert.equal(describe(META, { alt: 'Purple ridges at dusk' }).altSource, 'alt');
});

test('width ladder never upscales and caps the long edge', () => {
  assert.deepEqual(widthLadder(500, 300), [320, 500]);
  assert.equal(widthLadder(6000, 9000).at(-1), Math.round(6000 * 3200 / 9000));
  assert.ok(!widthLadder(1610, 1000).includes(1600));
});

test('escaping for HTML and inline JSON', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.ok(!scriptJson({ s: '</script><!--' }).includes('</script'));
});

test('row height CSS comes from page.js', () => {
  assert.equal(rowCss('var ROW = { min: 220, base: 200, vw: 0.09, max: 440 };'), 'min(clamp(220px, calc(200px + 9vw), 440px), 85vh)');
  assert.throws(() => rowCss('nothing here'));
});

test('library errors are explained in plain language', () => {
  assert.match(explainError(new Error('VipsJpeg: premature end of JPEG image')), /incomplete/);
  assert.match(explainError(new Error('Input buffer contains unsupported image format')), /isn't an image/);
  assert.match(explainError(new Error('VipsJpeg: Corrupt JPEG data: bad Huffman code')), /damaged/);
  assert.match(explainError(new Error('VipsJpeg: Corrupt JPEG data: premature end of data segment')), /damaged/);
  // A cut-off file reports both; it is incomplete, not damaged.
  assert.match(explainError(new Error('VipsJpeg: Corrupt JPEG data: premature end of data segment\nVipsJpeg: Premature end of JPEG file')), /incomplete/);
  assert.match(explainError(new Error('pngload_buffer: libspng read error: not enough data')), /incomplete/);
  assert.match(explainError(new Error('TIFFFetchStripThing: Bogus "StripByteCounts" field, ignoring and calculating from imagelength')), /incomplete/);
  assert.match(explainError(new Error('Input buffer contains unsupported image format'), '05-pines.tif'), /damaged or incomplete: its name says TIF/);
  assert.match(explainError(new Error('a\na\na')), /^a$/); // repeated lines once
});

test('typed camera values get units', () => {
  assert.equal(normaliseTyped('focal', '35'), '35mm');
  assert.equal(normaliseTyped('focal', '24-70'), '24–70mm');
  assert.equal(normaliseTyped('shutter', '30s'), '30s');
  assert.equal(normaliseTyped('aperture', '5.6'), 'f/5.6');
  assert.equal(normaliseTyped('aperture', 'f2'), 'f/2');
  assert.equal(normaliseTyped('shutter', '125'), '1/125s');
  assert.equal(normaliseTyped('shutter', '1/60'), '1/60s');
  assert.equal(normaliseTyped('shutter', '0.5'), '0.5s');
  assert.equal(normaliseTyped('iso', '400'), 'ISO 400');
  assert.equal(normaliseTyped('camera', 'Leica M6'), 'Leica M6');
  assert.equal(describe({}, { exif: false, shutter: '250', iso: '400' }).exif.shutter, '1/250s');
});

test('JSON errors say where and what', () => {
  const raw = '{\n  "a": "x"\n  "b": "y"\n}';
  let err;
  try { JSON.parse(raw); } catch (e) { err = e; }
  assert.match(describeJsonError(raw, err), /line 3.*missing comma at the end of line 2/);
});

test('JSON errors without a position still name the likely cause', () => {
  const noPosition = new Error('Unexpected token');
  assert.match(describeJsonError('{\n  "name": “Ana”\n}', noPosition), /curly quotes.*line 2/);
  assert.match(describeJsonError("{\n  'name': 'Ana'\n}", noPosition), /single quotes/);
  assert.match(describeJsonError('{\n  "a": [1, 2\n', new Error('Unexpected end of JSON input')), /closing \} or \] is probably missing/);
});

test('the build reads its layout settings from page.js', () => {
  assert.deepEqual(Object.keys(pageSetting(PAGE_JS, 'ROW')), ['min', 'base', 'vw', 'max']);
  assert.match(pageFunction(PAGE_JS, 'partition'), /^function partition\([\s\S]*\}$/);
  assert.throws(() => pageSetting('var X = 1;', 'LAYOUT'), /LAYOUT/);
  assert.throws(() => pageFunction('', 'partition'), /partition/);
  const photos = [{ width: 3000, height: 2000 }, { width: 2000, height: 3000 }, { width: 3000, height: 2000 }];
  const sizes = eagerSizes(photos, PAGE_JS);
  assert.equal(sizes.length, 2);
  assert.match(sizes[0], /^\(min-resolution: 2\.5dppx\) and \(max-width: 420px\) \d+px, /);
  assert.match(sizes[0], /, \d+px$/);
});

test('page.js LAYOUT matches style.css', () => {
  const L = pageSetting(PAGE_JS, 'LAYOUT');
  const pct = (v) => `${+(v * 100).toFixed(3)}vw`;
  assert.ok(STYLE.includes(`--gutter: clamp(${L.gutter[0]}px, ${pct(L.gutter[1])}, ${L.gutter[2]}px);`), '--gutter differs');
  assert.ok(STYLE.includes(`--gap: clamp(${L.gap[0]}px, ${pct(L.gap[1])}, ${L.gap[2]}px);`), '--gap differs');
  assert.ok(STYLE.includes(`(100vw - ${L.page}px) / 2`), 'page width differs');
  const breakpoints = new Set([...STYLE.matchAll(/max-width: (\d+)px\)/g)].map((m) => +m[1]).filter((w) => w < 700));
  assert.deepEqual([...breakpoints], [L.phone], 'phone breakpoint differs');
});

test('the source fingerprint ignores line endings and a byte-order mark', () => {
  const a = sourceFingerprint(['{\n  "name": "A"\n}\n', '{}', 'var x;']);
  assert.equal(sourceFingerprint(['\uFEFF{\r\n  "name": "A"\r\n}\r\n', '{}', 'var x;']), a);
  assert.notEqual(sourceFingerprint(['{\n  "name": "B"\n}\n', '{}', 'var x;']), a);
  assert.match(a, /^[0-9a-f]{12}$/);
});
