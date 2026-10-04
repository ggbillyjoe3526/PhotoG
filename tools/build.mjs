#!/usr/bin/env node
/**
 * Photo build for the portfolio.  Run `npm run build -- --help` for options.
 *
 *  site.json               your name, bio and contact details
 *  photos/                 your originals (never published, git-ignored)
 *  photos/details.json     optional per-photo text overrides (tracked)
 *  assets/gallery/         generated AVIF + JPEG sizes (published)
 *  assets/js/layout.js     gallery row layout, inlined after the gallery
 *  index.html              the <!-- build:… --> regions are rewritten
 *
 * Safety rules:
 *  - Nothing is written to index.html, and nothing is deleted, unless every
 *    photo processed successfully.
 *  - An empty photos/ folder never empties a published gallery (unless
 *    --allow-empty is passed).
 *  - Only files this build generated (name-hash-width.avif|jpg) are ever
 *    deleted from assets/gallery/.
 *  - Generated images carry no location, camera serial or editing metadata:
 *    only Artist / Copyright and an sRGB colour profile.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import exifr from 'exifr';
import sharp from 'sharp';

/* ------------------------------------------------------------------ config */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'photos');
const OUT_DIR = path.join(ROOT, 'assets', 'gallery');
const OUT_URL = 'assets/gallery';
const HTML_FILE = path.join(ROOT, 'index.html');
const SITE_FILE = path.join(ROOT, 'site.json');
const LAYOUT_FILE = path.join(ROOT, 'assets', 'js', 'layout.js');
const DETAILS_FILE = path.join(SRC_DIR, 'details.json');
const CACHE_FILE = path.join(SRC_DIR, '.build-cache.json');

/** Image encoding. Changing anything here re-encodes every photo and gives
 *  the files new names, so browsers never keep serving old versions. */
const ENCODE = {
  widths: [480, 800, 1200, 1600, 2400, 3200],
  maxLongEdge: 3200, // px; also caps tall portraits
  jpeg: { quality: 82, mozjpeg: true },
  avif: { quality: 58, effort: 4 },
  revision: 2,
};

/** Markup only (no re-encode). */
const MARKUP = {
  eager: 4, // first N photos load immediately, the rest lazily
};

/** Target gallery row height, as CSS. Mirrors baseRowHeight() in
 *  assets/js/layout.js and --row-h in style.css. */
const ROW_CSS = 'clamp(220px, calc(200px + 9vw), 440px)';
const REGIONS = ['meta', 'brand', 'stats', 'gallery', 'about', 'contact', 'footer'];

const INPUT_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff']);
const UNSUPPORTED_EXT = new Set([
  '.heic', '.heif', '.dng', '.nef', '.nrw', '.cr2', '.cr3', '.crw', '.arw', '.srf', '.sr2', '.raf', '.orf',
  '.rw2', '.pef', '.srw', '.x3f', '.3fr', '.fff', '.iiq', '.erf', '.mef', '.mos', '.psd', '.psb', '.gif', '.bmp',
]);
const OVERRIDE_KEYS = ['title', 'caption', 'alt', 'location', 'date', 'camera', 'lens', 'exif'];
const GENERATED_FILE = /^[a-z0-9-]+-[0-9a-f]{8}-\d+\.(?:avif|jpg)(?:\.tmp)?$/;

const ARGS = new Set(process.argv.slice(2));
const FORCE = ARGS.has('--force');
const ALLOW_EMPTY = ARGS.has('--allow-empty');
const ENCODE_KEY = hash(JSON.stringify(ENCODE), 8);

const HELP = `
Build the gallery from the photos in photos/.

  npm run build                      process new or changed photos
  npm run build -- --force           re-encode every photo
  npm run build -- --allow-empty     allow publishing an empty gallery

Order:      photos appear in file-name order; prefix names with 01-, 02-…
Hide:       start a file name with "_" (e.g. _draft-sunset.jpg)
Text:       titles/captions/locations come from your photo's metadata, or
            from photos/details.json (see the "_help" entry in that file)
Your info:  name, bio, email and links come from site.json
Formats:    .jpg .jpeg .png .webp .avif .tif .tiff (export RAW/HEIC first)
`;

/* ------------------------------------------------------------------ helpers */

function hash(input, length = 16) {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON that is safe to embed inside a <script> element. */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** XMP (and some IPTC) text arrives XML-escaped: "Light &amp; Shadow". */
function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** exifr returns text as a string, {value, lang}, or an array of those. */
function text(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return text(value.find((v) => text(v)) ?? '');
  if (typeof value === 'object') return text(value.value ?? '');
  return decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
}

/** Generic strings some cameras write into ImageDescription. */
const JUNK_TEXT = /^(olympus digital camera|sony dsc|default|digital camera|camera|image|picture|untitled|description)$/i;

function firstText(...values) {
  for (const v of values) {
    const t = text(v);
    if (t && !JUNK_TEXT.test(t)) return t;
  }
  return '';
}

/** In details.json, "-" or false hides a field even if the file has it. */
function isHidden(value) {
  return value === false || value === '-';
}

/** "56/10" → 5.6, [100] → 100, "1/125" → 0.008 */
function num(value) {
  if (Array.isArray(value)) return num(value[0]);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const frac = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
    if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN;
    return parseFloat(value);
  }
  return NaN;
}

function round(value, digits = 1) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

const TRANSLIT = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', þ: 'th', Þ: 'TH', ð: 'd' };

/** File stem → { stem, slug (unicode, for links), fileSlug (ascii, for file names), title } */
function nameInfo(fileName) {
  let stem = path.parse(fileName).name.trim();
  const date = /^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[T\s_-]?\d{2}[-.:]?\d{2}(?:[-.:]?\d{2})?)?[\s._-]+(?=\D)/.exec(stem);
  if (date) stem = stem.slice(date[0].length);
  else stem = stem.replace(/^\d{1,3}[\s._-]+(?=\S)/, ''); // order prefix: 01-, 2_, 003.

  const folded = stem.replace(/[øØæÆœŒßłŁđĐþÞð]/g, (c) => TRANSLIT[c]).normalize('NFKD').replace(/\p{M}+/gu, '');
  const slug = folded.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'photo';
  const fileSlug = slug.replace(/[^a-z0-9-]+/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo';

  // Camera default names make poor titles.
  const cameraDefault = /^(_?dsc[fn]?|_?dsf|_?mg|img|imgp|pxl|mvimg|gopr|dji|p\d{3}|r\d{3}|_?[a-z]\d{3})[\s._-]*\d{3,}/i.test(stem);
  const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const title = cameraDefault || !/\p{L}/u.test(words) ? '' : words.charAt(0).toUpperCase() + words.slice(1);
  return { stem, slug, fileSlug, title };
}

const MAKES = {
  'nikon corporation': 'Nikon', nikon: 'Nikon', fujifilm: 'Fujifilm', 'fuji photo film co., ltd.': 'Fujifilm',
  sony: 'Sony', canon: 'Canon', 'leica camera ag': 'Leica', leica: 'Leica', 'olympus imaging corp.': 'Olympus',
  'olympus corporation': 'Olympus', 'om digital solutions': 'OM System', panasonic: 'Panasonic',
  'ricoh imaging company, ltd.': 'Ricoh', ricoh: 'Ricoh', pentax: 'Pentax', 'pentax corporation': 'Pentax',
  hasselblad: 'Hasselblad', 'phase one': 'Phase One', apple: 'Apple', google: 'Google', samsung: 'Samsung',
  sigma: 'Sigma', dji: 'DJI', gopro: 'GoPro', 'eastman kodak company': 'Kodak', minolta: 'Minolta',
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function formatCamera(make, model) {
  make = text(make);
  model = text(model);
  if (!make && !model) return '';
  const niceMake = MAKES[make.toLowerCase()] ??
    (make && make === make.toUpperCase() ? make.charAt(0) + make.slice(1).toLowerCase() : make);
  // Drop a repeated brand from the model ("Canon Canon EOS R5", "NIKON Z 8").
  for (const word of [make, make.split(/[\s,]+/)[0], niceMake].filter(Boolean)) {
    if (model.toLowerCase().startsWith(word.toLowerCase() + ' ')) {
      model = model.slice(word.length).trim();
      break;
    }
  }
  // Sony writes internal codes (ILCE-7RM5); show the marketed name (A7R V).
  const sony = /^ILCE-(\d+)([A-Z]*?)(?:M(\d+))?$/.exec(model);
  if (niceMake === 'Sony' && sony) {
    model = `A${sony[1]}${sony[2]}${sony[3] ? ' ' + (ROMAN[+sony[3]] ?? sony[3]) : ''}`;
  }
  return [niceMake, model].filter(Boolean).join(' ');
}

function formatLens(lens) {
  const t = text(lens);
  if (!t || /^-+$/.test(t) || /^0(\.0)?\s?mm/i.test(t) || /f\/0(\.0)?$/i.test(t)) return '';
  return t;
}

function formatShutter(t) {
  if (!(t > 0)) return '';
  if (t >= 1) return `${round(t)}s`;
  const recip = 1 / t;
  const n = Math.round(recip);
  if (Math.abs(recip - n) / n < 0.04) return `1/${n}s`;
  return `${round(t, 2)}s`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return '';
    // exifr builds dates from the camera's local wall-clock time.
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const t = text(value);
  const iso = /^(\d{4})[-:](\d{2})[-:](\d{2})/.exec(t); // 2019-07-14T18:30+02:00, 2019:07:14 18:30:00
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return t;
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** JSON.parse that tolerates trailing commas (with a warning) and says where errors are. */
async function readJson(file, fallback, warnings) {
  if (!existsSync(file)) return fallback;
  const raw = await readFile(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    try {
      const value = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1'));
      const rewritten = file === DETAILS_FILE ? ' (and removed)' : '';
      warnings.push(`${path.relative(ROOT, file)} has trailing commas; they were ignored${rewritten}.`);
      return value;
    } catch {
      throw new Error(`${path.relative(ROOT, file)} is not valid JSON: ${err.message}`);
    }
  }
}

/** Write via a temp file + rename, so an interrupted build never leaves a half-written file. */
async function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, content);
  await rename(tmp, file);
}

async function writeIfChanged(file, content) {
  const current = existsSync(file) ? await readFile(file, 'utf8') : null;
  if (current === content) return false;
  await writeAtomic(file, content);
  return true;
}

async function fileOk(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------- metadata */

async function readMetadata(buffer, fileName, warnings) {
  try {
    return (await exifr.parse(buffer, {
      tiff: true, exif: true, xmp: true, iptc: true, gps: false, icc: false,
      interop: false, ihdr: false, jfif: false, mergeOutput: true,
    })) ?? {};
  } catch (err) {
    warnings.push(`${fileName}: could not read metadata (${err.message}); using the file name only.`);
    return {};
  }
}

function describe(meta, override, names) {
  const o = override ?? {};
  const field = (key, ...fallbacks) => (isHidden(o[key]) ? '' : firstText(o[key], ...fallbacks));

  const title = isHidden(o.title) ? '' : firstText(o.title, meta.title, meta.ObjectName, meta.XPTitle, meta.Headline) || names.title;
  const caption = field('caption', meta.description, meta.Caption, meta['Caption-Abstract'], meta.ImageDescription, meta.XPComment);
  const location = isHidden(o.location)
    ? ''
    : firstText(o.location) ||
      [
        firstText(meta.Sublocation, meta.Location),
        firstText(meta.City),
        firstText(meta.State, meta['Province-State']),
        firstText(meta.Country, meta['Country-PrimaryLocationName']),
      ].filter((part, i, all) => part && all.indexOf(part) === i).join(', ');
  const date = isHidden(o.date) ? '' : firstText(o.date) || formatDate(meta.DateTimeOriginal ?? meta.CreateDate ?? meta.DateCreated);

  // Alt text is never hidden: a linked image needs a text alternative.
  const altOwn = isHidden(o.alt) ? firstText(meta.AltTextAccessibility) : firstText(o.alt, meta.AltTextAccessibility);
  const alt = altOwn || caption || title;
  const altSource = altOwn ? 'alt' : caption ? 'caption' : title ? 'title' : 'none';

  let exif = {};
  if (o.exif !== false) {
    const focalLength = num(meta.FocalLength);
    const f35 = num(meta.FocalLengthIn35mmFormat);
    const aperture = num(meta.FNumber);
    const iso = num(meta.ISO ?? meta.ISOSpeedRatings ?? meta.PhotographicSensitivity);
    exif = {
      camera: field('camera', formatCamera(meta.Make, meta.Model)),
      lens: field('lens', formatLens(meta.LensModel ?? meta.Lens)),
      focal: focalLength > 0 ? `${round(focalLength, 0)}mm` : '',
      focal35: f35 > 0 && focalLength > 0 && Math.abs(f35 - focalLength) / f35 > 0.05 ? `${round(f35, 0)}mm` : '',
      aperture: aperture > 0 ? `f/${round(aperture)}` : '',
      shutter: formatShutter(num(meta.ExposureTime)),
      iso: iso > 0 ? `ISO ${round(iso, 0)}` : '',
    };
    for (const key of Object.keys(exif)) if (!exif[key]) delete exif[key];
  }

  return {
    title, caption, location, date, alt, altSource, exif,
    rights: { artist: text(meta.Artist ?? meta.creator), copyright: text(meta.Copyright ?? meta.rights) },
  };
}

/* ------------------------------------------------------------- encoding */

function orientedSize(metadata) {
  const swap = (metadata.orientation ?? 1) >= 5;
  return swap ? { width: metadata.height, height: metadata.width } : { width: metadata.width, height: metadata.height };
}

/** Widths to generate: the ladder below the (capped) original, skipping steps
 *  within 15% of it, plus the capped original itself. Never upscales. */
function widthLadder(width, height) {
  const scale = Math.min(1, ENCODE.maxLongEdge / Math.max(width, height));
  const top = Math.round(width * scale);
  return [...ENCODE.widths.filter((w) => w < top * 0.85), top];
}

function rightsXmp({ artist, copyright }) {
  const esc = (s) => escapeHtml(s);
  const parts = [];
  if (artist) parts.push(`<dc:creator><rdf:Seq><rdf:li>${esc(artist)}</rdf:li></rdf:Seq></dc:creator>`);
  if (copyright) parts.push(`<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${esc(copyright)}</rdf:li></rdf:Alt></dc:rights>`);
  if (!parts.length) return '';
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' + parts.join('') +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
}

async function encode(buffer, id, rights) {
  const decoder = () => sharp(buffer, { failOn: 'truncated' });
  const { width, height } = orientedSize(await decoder().metadata());
  if (!width || !height) throw new Error('could not read the image size');
  const widths = widthLadder(width, height);

  // Decode, orient, colour-convert to sRGB and downscale ONCE; every size is
  // derived from this master. Transparency is flattened onto white.
  const master = await decoder()
    .rotate()
    .resize({ width: widths.at(-1), withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  const raw = { width: master.info.width, height: master.info.height, channels: master.info.channels };
  const fromMaster = () => sharp(master.data, { raw });

  const exifRights = {};
  if (rights.artist) exifRights.Artist = rights.artist;
  if (rights.copyright) exifRights.Copyright = rights.copyright;
  const xmp = rightsXmp(rights);

  const write = async (w, format) => {
    let pipeline = fromMaster().resize({ width: w }).withIccProfile('srgb');
    if (Object.keys(exifRights).length) pipeline = pipeline.withExif({ IFD0: exifRights });
    if (xmp) pipeline = pipeline.withXmp(xmp);
    pipeline = format === 'avif' ? pipeline.avif(ENCODE.avif) : pipeline.jpeg(ENCODE.jpeg);
    const file = path.join(OUT_DIR, `${id}-${w}.${format === 'avif' ? 'avif' : 'jpg'}`);
    await pipeline.toFile(`${file}.tmp`);
    await rename(`${file}.tmp`, file);
  };
  await Promise.all(widths.flatMap((w) => [write(w, 'avif'), write(w, 'jpeg')]));

  const { data } = await fromMaster().resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return { width, height, widths, tint: toHex(data[0], data[1], data[2]) };
}

function filesFor(id, widths) {
  return widths.flatMap((w) => [`${id}-${w}.avif`, `${id}-${w}.jpg`]);
}

async function processPhoto(entry, cache, warnings) {
  const buffer = await readFile(path.join(SRC_DIR, entry.fileName));
  const key = hash(hash(buffer) + ENCODE_KEY, 8);
  const id = `${entry.names.fileSlug}-${key}`;
  const meta = await readMetadata(buffer, entry.fileName, warnings);
  const info = describe(meta, entry.override, entry.names);

  let image = null;
  let status = 'encoded';
  const known = !FORCE && cache[key];
  if (known) {
    const want = filesFor(id, known.widths);
    const have = await Promise.all(want.map((f) => fileOk(path.join(OUT_DIR, f))));
    if (have.every(Boolean)) {
      image = known;
      status = 'unchanged';
    } else if (known.id && known.id !== id) {
      // Same picture under a new name: reuse the encodes instead of redoing them.
      const old = filesFor(known.id, known.widths);
      const ok = await Promise.all(old.map((f) => fileOk(path.join(OUT_DIR, f))));
      if (ok.every(Boolean)) {
        await Promise.all(old.map((f, i) => copyFile(path.join(OUT_DIR, f), path.join(OUT_DIR, want[i]))));
        image = known;
        status = 'renamed';
      }
    }
  }
  if (!image) image = await encode(buffer, id, info.rights);
  cache[key] = { id, width: image.width, height: image.height, widths: image.widths, tint: image.tint };

  const { rights, ...fields } = info;
  return {
    ...fields,
    id: entry.names.slug,
    file: entry.fileName,
    width: image.width,
    height: image.height,
    tint: image.tint,
    widths: image.widths,
    base: `${OUT_URL}/${id}`,
    files: filesFor(id, image.widths),
    status,
  };
}

/* -------------------------------------------------------------- rendering */

function srcset(photo, ext) {
  return photo.widths.map((w) => `${photo.base}-${w}.${ext} ${w}w`).join(', ');
}

function renderTile(photo, index, total) {
  const ar = photo.width / photo.height;
  const eager = index < MARKUP.eager;
  const number = String(index + 1).padStart(Math.max(2, String(total).length), '0');
  // A close first guess at the rendered width (aspect ratio x a typical row
  // height). layout.js, inlined after the gallery, gives every image that
  // hasn't started loading its exact width before the first paint; this
  // guess is only used by the first few (eager) photos and without JS.
  const sizes = `min(100vw, calc(${round(ar * 1.1, 3)} * ${ROW_CSS}))`;
  const largest = photo.widths.at(-1);
  const fallback = photo.widths.find((w) => w >= 800) ?? largest;
  const attrs = [
    `src="${photo.base}-${fallback}.jpg"`,
    `srcset="${srcset(photo, 'jpg')}"`,
    `sizes="${sizes}"`,
    `width="${photo.width}"`,
    `height="${photo.height}"`,
    `alt="${escapeHtml(photo.alt || `Photograph ${number}`)}"`,
    eager ? 'loading="eager"' : 'loading="lazy"',
    index === 0 ? 'fetchpriority="high"' : '',
    'decoding="async"',
  ].filter(Boolean).join(' ');

  // Screen readers hear the description (alt) as the link's name and the
  // visible caption ("03 Horizon") as its description.
  const captionId = `caption-${escapeHtml(photo.id)}`;
  const describedBy = photo.title && photo.title !== photo.alt ? ` aria-describedby="${captionId}"` : '';

  return `
        <li class="tile" id="photo-${escapeHtml(photo.id)}" style="--ar:${round(ar, 4)};--tint:${photo.tint}">
          <figure>
            <a class="tile-link" href="${photo.base}-${largest}.jpg"${describedBy}>
              <picture>
                <source type="image/avif" srcset="${srcset(photo, 'avif')}" sizes="${sizes}">
                <img ${attrs}>
              </picture>
            </a>
            <figcaption class="tile-caption" id="${captionId}"><span class="tile-no">${number}</span> <span class="tile-title">${escapeHtml(photo.title)}</span></figcaption>
          </figure>
        </li>`;
}

function renderGallery(photos, layoutJs) {
  const data = photos.map((p) => ({
    id: p.id, title: p.title, caption: p.caption, location: p.location, date: p.date,
    width: p.width, height: p.height, tint: p.tint, exif: p.exif,
  }));
  // The row layout runs inline, right here, so rows have their final size
  // before the first paint and before lazy images choose a file.
  const script = layoutJs.trim().replace(/<\/(script)/gi, '<\\/$1');
  return `
      <ol class="gallery" id="gallery">${photos.map((p, i) => renderTile(p, i, photos.length)).join('')}
      </ol>
      <script type="application/json" id="gallery-data">${scriptJson(data)}</script>
      <script>/* assets/js/layout.js (inlined by the build) */
${script}
      </script>
      `;
}

function renderStats(photos) {
  const years = photos.map((p) => /\b(1[89]\d\d|2\d{3})\b/.exec(p.date)?.[1]).filter(Boolean).map(Number);
  const count = `${photos.length} ${photos.length === 1 ? 'photograph' : 'photographs'}`;
  if (!years.length) return count;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return `${count} · ${min === max ? min : `${min}–${max}`}`;
}

/* ------------------------------------------------------------ site.json */

const DEFAULT_SITE = {
  name: 'Your Name',
  tagline: 'Photographer',
  description: '',
  url: '',
  about: { lede: '', text: [], facts: {} },
  contact: { intro: '', email: '', links: {} },
};

const PLACEHOLDER = /\bYour Name\b|example\.com|City, Country|Client One/;

/** Read site.json, check it, and normalise it. Problems become warnings. */
async function loadSite(warnings) {
  if (!existsSync(SITE_FILE)) {
    throw new Error('site.json is missing. Restore it from the repository (it holds your name, bio and contact details).');
  }
  const raw = await readJson(SITE_FILE, {}, warnings);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('site.json should contain an object like {"name": "…"}.');
  const str = (v, label) => {
    if (v == null) return '';
    if (typeof v !== 'string') {
      warnings.push(`site.json: "${label}" should be text in quotes; ignored.`);
      return '';
    }
    return v.trim();
  };
  const map = (v, label) => {
    if (v == null) return [];
    if (typeof v !== 'object' || Array.isArray(v)) {
      warnings.push(`site.json: "${label}" should be a list of "Label": "value" pairs; ignored.`);
      return [];
    }
    return Object.entries(v).map(([k, val]) => [k.trim(), str(val, `${label}.${k}`)]).filter(([k, val]) => k && val);
  };
  const about = raw.about && typeof raw.about === 'object' ? raw.about : {};
  const contact = raw.contact && typeof raw.contact === 'object' ? raw.contact : {};
  const text = typeof about.text === 'string' ? [about.text] : Array.isArray(about.text) ? about.text : [];

  const site = {
    name: str(raw.name, 'name') || DEFAULT_SITE.name,
    tagline: str(raw.tagline, 'tagline'),
    description: str(raw.description, 'description'),
    url: str(raw.url, 'url'),
    lede: str(about.lede, 'about.lede'),
    text: text.map((t, i) => str(t, `about.text[${i}]`)).filter(Boolean),
    facts: map(about.facts, 'about.facts'),
    intro: str(contact.intro, 'contact.intro'),
    email: str(contact.email, 'contact.email'),
    links: [],
  };
  if (!str(raw.name, 'name')) warnings.push('site.json: "name" is empty; showing "Your Name".');

  if (site.url) {
    try {
      const u = new URL(site.url);
      if (!/^https?:$/.test(u.protocol)) throw new Error('not http(s)');
      site.url = u.href.endsWith('/') ? u.href : `${u.href}/`;
    } catch {
      warnings.push(`site.json: "url" (${site.url}) isn't a web address like https://yourname.com/; ignored.`);
      site.url = '';
    }
  }
  if (site.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(site.email)) {
    warnings.push(`site.json: "email" (${site.email}) doesn't look like an email address; it was left out.`);
    site.email = '';
  }
  for (const [label, url] of map(contact.links, 'contact.links')) {
    try {
      const u = new URL(url);
      if (!/^(https?|mailto|tel):$/.test(u.protocol)) throw new Error('scheme');
      site.links.push([label, u.href]);
    } catch {
      warnings.push(`site.json: the link "${label}" (${url}) should start with https://; it was left out.`);
    }
  }
  if (PLACEHOLDER.test(JSON.stringify(raw))) {
    warnings.push('site.json still contains placeholder text (e.g. "Your Name", hello@example.com). Replace it with your own details.');
  }
  return site;
}

function renderMeta(site, cover) {
  const title = `${site.name} — Photography`;
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    site.description && `<meta name="description" content="${escapeHtml(site.description)}">`,
    `<meta name="author" content="${escapeHtml(site.name)}">`,
    site.url && `<link rel="canonical" href="${escapeHtml(site.url)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    site.description && `<meta property="og:description" content="${escapeHtml(site.description)}">`,
    site.url && `<meta property="og:url" content="${escapeHtml(site.url)}">`,
  ];
  if (cover) {
    const w = cover.widths.filter((x) => x <= 1600).at(-1) ?? cover.widths[0];
    const relative = `${cover.base}-${w}.jpg`;
    // og:image must be an absolute address for most link-preview crawlers.
    const url = site.url ? new URL(relative, site.url).href : relative;
    lines.push(
      `<meta property="og:image" content="${escapeHtml(url)}">`,
      `<meta property="og:image:width" content="${w}">`,
      `<meta property="og:image:height" content="${Math.round((w / cover.width) * cover.height)}">`,
      `<meta property="og:image:alt" content="${escapeHtml(cover.alt)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
    );
  }
  return `\n    ${lines.filter(Boolean).join('\n    ')}\n    `;
}

function renderBrand(site) {
  return `
        <h1 class="brand-name"><a href="./">${escapeHtml(site.name)}</a></h1>${site.tagline ? `
        <p class="brand-line">${escapeHtml(site.tagline)}</p>` : ''}
      `;
}

function renderAbout(site) {
  const parts = [];
  if (site.lede) parts.push(`<p class="lede">${escapeHtml(site.lede)}</p>`);
  for (const t of site.text) parts.push(`<p>${escapeHtml(t)}</p>`);
  if (site.facts.length) {
    parts.push(`<dl class="facts">${site.facts.map(([k, v]) => `
            <div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
          </dl>`);
  }
  return `\n          ${parts.join('\n          ')}\n        `;
}

function renderContact(site) {
  const parts = [];
  if (site.intro) parts.push(`<p class="contact-intro">${escapeHtml(site.intro)}</p>`);
  if (site.email) parts.push(`<a class="contact-email" href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a>`);
  if (site.links.length) {
    parts.push(`<ul class="contact-links">${site.links.map(([label, url]) => {
      const external = /^https?:/.test(url);
      const attrs = external ? ' rel="me noopener" target="_blank"' : '';
      const hint = external ? '<span class="visually-hidden"> (opens in a new tab)</span>' : '';
      return `
            <li><a href="${escapeHtml(url)}"${attrs}>${escapeHtml(label)}${hint}</a></li>`;
    }).join('')}
          </ul>`);
  }
  return `\n          ${parts.join('\n          ')}\n        `;
}

function renderFooter(site) {
  return `© <span data-year>${new Date().getFullYear()}</span> ${escapeHtml(site.name)}. All rights reserved.`;
}

function regionPattern(name) {
  return new RegExp(`(<!--\\s*build:${name}\\s*-->)([\\s\\S]*?)(<!--\\s*/build:${name}\\s*-->)`);
}

function readRegion(html, name) {
  const match = regionPattern(name).exec(html);
  if (!match) throw new Error(`index.html is missing the <!-- build:${name} --> … <!-- /build:${name} --> markers.`);
  return match[2];
}

function replaceRegion(html, name, content) {
  readRegion(html, name);
  return html.replace(regionPattern(name), (_, open, _old, close) => `${open}${content}${close}`);
}

/* ------------------------------------------------------------------ main */

async function main() {
  if (ARGS.has('--help') || ARGS.has('-h')) {
    console.log(HELP);
    return;
  }
  const started = Date.now();
  const warnings = [];

  let html = await readFile(HTML_FILE, 'utf8');
  for (const name of REGIONS) readRegion(html, name); // fail fast on missing markers
  const publishedCount = (readRegion(html, 'gallery').match(/class="tile"/g) ?? []).length;
  const site = await loadSite(warnings);
  const layoutJs = await readFile(LAYOUT_FILE, 'utf8');

  await mkdir(SRC_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const details = await readJson(DETAILS_FILE, {}, warnings);
  const cache = (await readJson(CACHE_FILE, {}, warnings)).photos ?? {};

  // Collect source files.
  const all = await readdir(SRC_DIR);
  const names = [];
  const unsupported = [];
  for (const f of all) {
    if (f.startsWith('.') || f.startsWith('_')) continue;
    const ext = path.extname(f).toLowerCase();
    if (INPUT_EXT.has(ext)) names.push(f);
    else if (UNSUPPORTED_EXT.has(ext)) unsupported.push(f);
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (unsupported.length) {
    warnings.push(`Skipped ${unsupported.length} file(s) in a format browsers can't show (${unsupported.slice(0, 4).join(', ')}${unsupported.length > 4 ? ', …' : ''}). Export them as JPEG or TIFF.`);
  }

  // Overrides are keyed by the photo's name without its order prefix, so
  // renaming 03-dunes.jpg to 01-dunes.jpg keeps its text. Full file names
  // (older style) are still understood.
  const used = new Map();
  const entries = names.map((fileName) => {
    const info = nameInfo(fileName);
    const n = (used.get(info.slug) ?? 0) + 1;
    used.set(info.slug, n);
    if (n > 1) {
      info.slug = `${info.slug}-${n}`;
      info.fileSlug = `${info.fileSlug}-${n}`;
    }
    const raw = details[info.slug] ?? details[fileName];
    let override;
    if (raw != null) {
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        warnings.push(`details.json: the entry for "${info.slug}" should be an object like {"title": "…"}; ignored.`);
      } else {
        override = raw;
        const unknown = Object.keys(raw).filter((k) => !OVERRIDE_KEYS.includes(k));
        if (unknown.length) warnings.push(`details.json: "${info.slug}" has unknown field(s) ${unknown.map((k) => `"${k}"`).join(', ')} (allowed: ${OVERRIDE_KEYS.join(', ')}).`);
      }
    }
    return { fileName, names: info, override };
  });

  if (!entries.length && publishedCount > 0 && !ALLOW_EMPTY) {
    throw new Error(
      `No photos found in photos/, but the published gallery has ${publishedCount}. Nothing was changed.\n` +
      '  Add your photos to photos/ and run again (or pass --allow-empty to really publish an empty gallery).',
    );
  }

  console.log(`Building ${entries.length} photo${entries.length === 1 ? '' : 's'} from photos/ …`);
  const cores = os.availableParallelism?.() ?? os.cpus().length;
  const concurrency = Math.max(1, Math.min(2, Math.floor(cores / 2)));
  const failures = [];
  let done = 0;
  const results = await mapPool(entries, concurrency, async (entry) => {
    try {
      const photo = await processPhoto(entry, cache, warnings);
      done++;
      if (photo.status !== 'unchanged') {
        console.log(`  [${String(done).padStart(String(entries.length).length)}/${entries.length}] ${photo.status.padEnd(8)} ${entry.fileName}`);
      }
      return photo;
    } catch (err) {
      done++;
      failures.push({ file: entry.fileName, message: err.message });
      return null;
    }
  });

  // Keep the cache for everything that did encode, even if something failed.
  await writeAtomic(CACHE_FILE, JSON.stringify({
    note: 'Build cache for tools/build.mjs. Safe to delete (forces a full re-encode). Not published.',
    photos: cache,
  }, null, 2) + '\n');

  if (failures.length) {
    console.error('\nThese photos could not be processed:');
    for (const f of failures) console.error(`  ✗ ${f.file}: ${f.message}`);
    console.error('\nNothing was published: index.html and assets/gallery/ are unchanged.');
    console.error('Fix or remove the files above (or rename them with a leading "_" to skip them) and run again.');
    process.exitCode = 1;
    return;
  }
  const photos = results;

  // Remove generated files that no longer belong to any photo (only ever
  // files that match this build's naming pattern).
  const keep = new Set(photos.flatMap((p) => p.files));
  let removed = 0;
  for (const f of await readdir(OUT_DIR)) {
    if (GENERATED_FILE.test(f) && !keep.has(f)) {
      await unlink(path.join(OUT_DIR, f));
      removed++;
    }
  }

  // details.json: an editable entry per photo; drop untouched entries for
  // photos that are gone; keep (and report) entries that hold your text.
  const blank = { title: '', caption: '', alt: '', location: '', date: '', camera: '', lens: '' };
  const isBlank = (v) => v && typeof v === 'object' && Object.values(v).every((x) => x === '' || x == null);
  const nextDetails = {
    _help: [
      'Optional text for each photo, keyed by its file name without the order number (01-dunes.jpg -> "dunes").',
      'Leave a field "" to use the metadata in the file. Use "-" to hide it (e.g. a sensitive location).',
      'Fields: title, caption, alt (description for screen readers), location, date, camera, lens; "exif": false hides all camera data.',
      'Set "_cover" to a photo name to choose the image used in link previews (default: the first photo).',
      'Run `npm run build` after editing.',
    ],
    _cover: typeof details._cover === 'string' ? details._cover : '',
  };
  const kept = [];
  for (const entry of entries) {
    const existing = details[entry.names.slug] ?? details[entry.fileName];
    nextDetails[entry.names.slug] = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...blank, ...existing } : { ...blank };
  }
  for (const [key, value] of Object.entries(details)) {
    if (key.startsWith('_') || key in nextDetails) continue;
    if (entries.some((e) => e.fileName === key)) continue; // migrated to the new key
    if (isBlank(value)) continue;
    nextDetails[key] = value;
    kept.push(key);
  }
  await writeIfChanged(DETAILS_FILE, JSON.stringify(nextDetails, null, 2) + '\n');

  // index.html
  const coverKey = nextDetails._cover;
  const cover = photos.find((p) => p.id === coverKey) ?? photos[0];
  if (coverKey && cover?.id !== coverKey) warnings.push(`details.json: "_cover" is "${coverKey}", but no photo has that name; using the first photo.`);
  html = replaceRegion(html, 'meta', renderMeta(site, cover));
  html = replaceRegion(html, 'brand', renderBrand(site));
  html = replaceRegion(html, 'stats', renderStats(photos));
  html = replaceRegion(html, 'gallery', renderGallery(photos, layoutJs));
  html = replaceRegion(html, 'about', renderAbout(site));
  html = replaceRegion(html, 'contact', renderContact(site));
  html = replaceRegion(html, 'footer', renderFooter(site));
  const htmlChanged = await writeIfChanged(HTML_FILE, html);

  // Summary, in gallery order.
  const digits = Math.max(2, String(photos.length).length);
  console.log('');
  photos.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(digits, '0')}  ${p.file.padEnd(28)} #photo-${p.id.padEnd(18)} ${`${p.width}×${p.height}`.padEnd(10)} ${p.status}`);
  });
  const encoded = photos.filter((p) => p.status === 'encoded').length;
  console.log(
    `\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s: ${photos.length} in the gallery ` +
    `(${encoded} encoded, ${photos.length - encoded} reused), ${removed} old file${removed === 1 ? '' : 's'} removed` +
    `${htmlChanged ? ', index.html updated' : ', index.html already up to date'}.`,
  );

  const weakAlt = photos.filter((p) => p.altSource === 'title' || p.altSource === 'none');
  if (weakAlt.length) {
    warnings.push(
      `${weakAlt.length} photo${weakAlt.length === 1 ? ' has' : 's have'} no description for screen readers ` +
      `(${weakAlt.map((p) => p.id).join(', ')}). Add "alt" (or a caption) in photos/details.json.`,
    );
  }
  if (!site.url) warnings.push('"url" in site.json is empty, so link previews (social, messaging) will show no image. Set it once the site is live.');
  if (kept.length) warnings.push(`details.json keeps text for photos that are not in photos/: ${kept.join(', ')}. Delete those entries if you no longer need them.`);
  if (!photos.length) warnings.push('The gallery is empty. Add .jpg/.png/.webp/.tif files to photos/ and run again.');
  if (warnings.length) {
    console.log('\nNotes:');
    for (const w of warnings) console.log(`  • ${w}`);
  }
}

main().catch((err) => {
  console.error(`\nBuild stopped: ${err.message}`);
  process.exitCode = 1;
});
