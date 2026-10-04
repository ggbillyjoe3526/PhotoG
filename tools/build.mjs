#!/usr/bin/env node
/**
 * The site build.  Run `npm run build -- --help` for options.
 *
 *  site.json               your name, bio, contact details and privacy choices
 *  photos/                 your originals (never published, git-ignored)
 *  photos/details.json     optional per-photo text (tracked in git)
 *  assets/gallery/         generated AVIF + JPEG sizes (published)
 *  assets/js/page.js       theme, gallery rows, S/M/L; inlined after the gallery
 *  index.html              the <!-- build:… --> regions are rewritten
 *
 * Safety rules:
 *  - index.html is only rewritten, and old files only deleted, when every
 *    photo processed successfully. Damaged or incomplete files stop the build.
 *  - An empty photos/ folder never empties a published gallery (unless
 *    --allow-empty is passed).
 *  - Only files this build generated (name-hash-width.avif|jpg) are ever
 *    deleted from assets/gallery/.
 *  - Generated images carry no location, camera serial or editing metadata:
 *    only Artist / Copyright and an sRGB colour profile. The page shows
 *    location and date text at the level chosen in site.json ("show").
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

// PHOTOG_ROOT lets the integration tests build a throwaway copy of the site.
const ROOT = process.env.PHOTOG_ROOT ? path.resolve(process.env.PHOTOG_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'photos');
const OUT_DIR = path.join(ROOT, 'assets', 'gallery');
const OUT_URL = 'assets/gallery';
const HTML_FILE = path.join(ROOT, 'index.html');
const SITE_FILE = path.join(ROOT, 'site.json');
const PAGE_JS_FILE = path.join(ROOT, 'assets', 'js', 'page.js');
const DETAILS_FILE = path.join(SRC_DIR, 'details.json');
const CACHE_FILE = path.join(SRC_DIR, '.build-cache.json');

/** Image encoding. Changing anything here re-encodes every photo and gives
 *  the files new names, so browsers never keep serving old versions. */
const ENCODE = {
  widths: [320, 480, 640, 800, 1000, 1200, 1600, 2000, 2400, 3200],
  maxLongEdge: 3200, // px; also caps tall portraits
  jpeg: { quality: 82, mozjpeg: true },
  avif: { quality: 58, effort: 4 },
  avifLarge: { quality: 64, effort: 4, from: 1600 }, // viewer sizes keep grain and fine detail
  density: 72,
  revision: 4,
};
const PIXEL_LIMIT = 1_000_000_000; // sharp's default (268 MP) is too small for big stitched panoramas

/** Markup only (no re-encode). */
const MARKUP = {
  // The first N photos load at once (the browser fetches them before any
  // script runs, using estimated sizes); the rest are lazy and get their
  // exact size from page.js first, which is inlined right after the gallery.
  eager: 2,
};

const REGIONS = ['meta', 'brand', 'stats', 'gallery', 'about', 'contact', 'footer'];
const INPUT_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif', '.tif', '.tiff']);
const UNSUPPORTED_EXT = new Set([
  '.heic', '.heif', '.dng', '.nef', '.nrw', '.cr2', '.cr3', '.crw', '.arw', '.srf', '.sr2', '.raf', '.orf',
  '.rw2', '.pef', '.srw', '.x3f', '.3fr', '.fff', '.iiq', '.erf', '.mef', '.mos', '.psd', '.psb', '.gif', '.bmp',
]);
const OVERRIDE_KEYS = ['title', 'caption', 'alt', 'location', 'date', 'camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'exif'];
const EXIF_KEYS = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso'];
const GENERATED_FILE = /^[a-z0-9-]+-[0-9a-f]{8}-\d+\.(?:avif|jpg)(?:\.tmp)?$/;
const KNOWN_FLAGS = new Set(['--force', '--allow-empty', '--help', '-h']);
const SHOW_DEFAULTS = { location: 'city', date: 'month' };
const SITE_KEYS = ['_help', 'name', 'title', 'tagline', 'description', 'url', 'language', 'show', 'about', 'contact', 'licensing'];
const SHOW_CHOICES = { location: ['full', 'city', 'country', 'none'], date: ['day', 'month', 'year', 'none'] };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ENCODE_KEY = hash(JSON.stringify(ENCODE), 8);

const HELP = `
Build the website from site.json and the photos in photos/.

  npm run build                 process new or changed photos
  npm run build:force           re-encode every photo
                                (or: npm run build -- --force; note the extra "--")
  npm run build -- --allow-empty   allow publishing an empty gallery

Order:      photos appear in file-name order; start names with 01-, 02-…
Hide:       start a file name with "_" (e.g. _draft-sunset.jpg). Camera names
            such as _DSC1234.jpg are not hidden.
Text:       titles, captions and locations come from your photos' metadata,
            or from photos/details.json (see "_help" at the top of that file)
Your info:  name, bio, email, links and privacy choices come from site.json
Formats:    .jpg .jpeg .png .webp .avif .tif .tiff (export RAW/HEIC first)
`;

/* ------------------------------------------------------------------ helpers */

export function hash(input, length = 16) {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON that is safe to embed inside a <script> element. */
export function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** XMP (and some IPTC) text arrives XML-escaped: "Light &amp; Shadow". */
export function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** exifr returns text as a string, {value, lang}, or an array of those. */
export function text(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return text(value.find((v) => text(v)) ?? '');
  if (typeof value === 'object') return text(value.value ?? '');
  return decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
}

/** Generic strings some cameras write into ImageDescription. */
const JUNK_TEXT = /^(olympus digital camera|sony dsc|default|digital camera|camera|image|picture|untitled|description)$/i;

export function firstText(...values) {
  for (const v of values) {
    const t = text(v);
    if (t && !JUNK_TEXT.test(t)) return t;
  }
  return '';
}

/** In details.json, "-" or false hides a field even if the file has it. */
export function isHidden(value) {
  return value === false || value === '-';
}

/** "56/10" → 5.6, [100] → 100, "1/125" → 0.008 */
export function num(value) {
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

/** Names cameras give files: DSC_1234, _DSC1234, IMG_1234, _MG_1234, _IGP0042,
 *  P1000123, PXL_… (the DCF rule is four characters then four digits). */
const CAMERA_NAME = /^(?:_?dsc[fn]?|_?dsf|_?mg_?|_?img|imgp|pxl|mvimg|gopr|dji|p\d{3}|r\d{3}|_?[a-z]\d{3})[\s._-]*\d{3,}|^[a-z0-9_]{4}\d{4}(?:[\s._-]|$)/i;

/** A leading "_" hides a photo, except on camera names such as _DSC1234. */
export function isHiddenFile(fileName) {
  return fileName.startsWith('_') && !CAMERA_NAME.test(path.parse(fileName).name);
}

const TRANSLIT = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', þ: 'th', Þ: 'TH', ð: 'd' };

/** File name → { slug (for links and details.json), fileSlug (ASCII, for file names), title } */
export function nameInfo(fileName) {
  let stem = path.parse(fileName).name.trim();
  // Order prefix: "01-", "2_", "003.", or "01 " (a space only with a leading
  // zero, so "100 Days" keeps its number). Then an optional date prefix.
  stem = stem.replace(/^(?:\d{1,3}[._-]+|0\d{0,2}\s+)(?=\S)/, '');
  stem = stem.replace(/^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[T\s_-]?\d{2}[-.:]?\d{2}(?:[-.:]?\d{2})?)?[\s._-]+(?=\D)/, '');

  const folded = stem.replace(/[øØæÆœŒßłŁđĐþÞð]/g, (c) => TRANSLIT[c]).normalize('NFKD').replace(/\p{M}+/gu, '');
  const slug = folded.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'photo';
  const fileSlug = slug.replace(/[^a-z0-9-]+/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo';

  // Camera names make poor titles.
  const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const title = CAMERA_NAME.test(stem) || !/\p{L}/u.test(words) ? '' : words.charAt(0).toUpperCase() + words.slice(1);
  return { slug, fileSlug, title };
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

export function formatCamera(make, model) {
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

export function formatLens(lens) {
  const t = text(lens);
  if (!t || /^-+$/.test(t) || /^0(\.0)?\s?mm/i.test(t) || /f\/0(\.0)?$/i.test(t)) return '';
  return t;
}

export function formatShutter(t) {
  if (!(t > 0)) return '';
  if (t >= 1) return `${round(t)}s`;
  const recip = 1 / t;
  const n = Math.round(recip);
  if (Math.abs(recip - n) / n < 0.04) return `1/${n}s`;
  return `${round(t, 2)}s`;
}

/** A capture date as { y, m, d } (camera wall-clock time), or null. */
function dateParts(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return null;
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const iso = /^(\d{4})[-:](\d{2})[-:](\d{2})/.exec(text(value)); // 2019-07-14T18:30+02:00, 2019:07:14 18:30
  return iso ? { y: +iso[1], m: +iso[2], d: +iso[3] } : null;
}

/** Typed camera values as the page shows them: "35" → "35mm", "5.6" → "f/5.6",
 *  "125" → "1/125s", "400" → "ISO 400". Anything else is kept as typed. */
export function normaliseTyped(key, value) {
  if (!value) return '';
  const n = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (key === 'focal' && n > 0) return `${round(n, 0)}mm`;
  if (key === 'aperture') return n > 0 ? `f/${round(n)}` : value.replace(/^f\s*/i, 'f/').replace(/^f\/\//, 'f/');
  if (key === 'shutter') {
    if (/^1\/\d+$/.test(value)) return `${value}s`;
    if (n >= 2 && Number.isInteger(n)) return `1/${n}s`; // photographers say "125" for 1/125
    if (n > 0) return `${n}s`;
  }
  if (key === 'iso' && n > 0) return `ISO ${round(n, 0)}`;
  return value;
}

/** Format a capture date at the chosen level: day | month | year | none. */
export function formatDate(value, level = 'day') {
  const p = dateParts(value);
  if (!p || level === 'none') return '';
  if (level === 'year') return String(p.y);
  if (level === 'month') return `${MONTHS[p.m - 1] ?? ''} ${p.y}`.trim();
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Turn library errors into something a photographer can act on. */
export function explainError(err) {
  // libvips can repeat a line many times; keep each once.
  const msg = [...new Set(String(err && err.message || err).split('\n').map((l) => l.trim()).filter(Boolean))].join(' ');
  if (/input (buffer|file) is empty|empty file/i.test(msg)) return 'is empty (0 bytes). Copy or export it again.';
  if (/ENOSPC/.test(msg)) return "couldn't be saved: the disk is full. Free some space and run again.";
  if (/EISDIR/.test(msg)) return "couldn't be saved: a folder is in the way of a file the build writes.";
  if (/EPERM|EACCES|EBUSY/.test(msg)) return "couldn't be read or saved (permission denied or the file is in use, e.g. by a sync app or antivirus). Try again.";
  if (/pixel limit|exceeds pixel/i.test(msg)) return 'is too large to process (over a billion pixels). Export a smaller version.';
  if (/unsupported image format|not a known file format|unknown format/i.test(msg)) return "isn't an image file the build can read. Export it as JPEG or TIFF.";
  if (/corrupt|bad huffman|damaged|invalid/i.test(msg)) return `is damaged and can't be read reliably. Export it again. (${msg.replace(/\s+/g, ' ').trim()})`;
  if (/premature end of (jpeg )?(image|file)|truncated|unexpected end/i.test(msg)) return 'is incomplete: the file was cut off (for example an unfinished copy or download). Copy or export it again.';
  if (/marker|vipsjpeg|tiff|png|webp|heif|premature end/i.test(msg)) return `is damaged and can't be read reliably. Export it again. (${msg.replace(/\s+/g, ' ').trim()})`;
  if (/warning treated as error/i.test(msg)) return "is damaged or incomplete and can't be read reliably. Export it again.";
  return msg;
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

/** JSON.parse that ignores a byte-order mark, tolerates trailing commas
 *  (with a note) and says where errors are. */
export async function readJson(file, fallback, notes) {
  if (!existsSync(file)) return fallback;
  const raw = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    try {
      const value = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1'));
      notes.push(`${path.relative(ROOT, file)} has trailing commas; they were ignored${file === DETAILS_FILE ? ' (and removed)' : ''}.`);
      return value;
    } catch {
      throw new Error(`${path.relative(ROOT, file)} is not valid JSON: ${describeJsonError(raw, err)}`);
    }
  }
}

/** "Unexpected token…" → where it is and what is probably wrong. */
export function describeJsonError(raw, err) {
  const msg = String(err.message || err);
  const lc = /line (\d+) column (\d+)/.exec(msg);
  const pos = /position (\d+)/.exec(msg);
  let line;
  let col;
  if (lc) { line = +lc[1]; col = +lc[2]; } else if (pos) {
    const before = raw.slice(0, +pos[1]).split('\n');
    line = before.length;
    col = before.at(-1).length + 1;
  }
  if (!line) return msg;
  const lines = raw.split('\n');
  const prev = lines.slice(0, line - 1).reverse().find((l) => l.trim());
  const here = (lines[line - 1] || '').trim();
  let hint = '';
  if (prev && /["\]}\d]\s*$/.test(prev.trim()) && /^["{[]/.test(here)) hint = ` Probably a missing comma at the end of line ${lines.lastIndexOf(prev) + 1}.`;
  else if (/[“”]/.test(here)) hint = ' Curly quotes “ ” must be straight quotes ".';
  else if (/^\s*'/.test(here) || /:\s*'/.test(here)) hint = " Text must be in double quotes \", not single quotes '.";
  return `problem at line ${line}, column ${col}.${hint}`;
}

/** Write via a temp file + rename, so an interrupted build never leaves a half-written file. */
async function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, content);
  await renameRetry(tmp, file);
}

/** rename(), retried briefly when a sync app or antivirus holds the file (Windows). */
async function renameRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (attempt >= 4 || !/EPERM|EBUSY|EACCES/.test(err.code || '')) throw err;
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
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

async function readMetadata(source, fileName, notes) {
  try {
    return (await exifr.parse(source, {
      tiff: true, exif: true, xmp: true, iptc: true, gps: false, icc: false,
      interop: false, ihdr: false, jfif: false, mergeOutput: true,
    })) ?? {};
  } catch (err) {
    notes.push(`${fileName}: could not read its metadata (${err.message}); using the file name only.`);
    return {};
  }
}

/**
 * Everything the page says about a photo. `o` is the photo's entry in
 * details.json (typed text wins; "-" hides), `show` the site's privacy
 * choices for location and date text taken from metadata.
 */
export function describe(meta, o = {}, names = { title: '' }, show = SHOW_DEFAULTS) {
  const typed = (key) => (isHidden(o[key]) ? '' : text(o[key]));
  const field = (key, ...fallbacks) => (isHidden(o[key]) ? '' : firstText(o[key], ...fallbacks));

  const title = isHidden(o.title) ? '' : firstText(o.title, meta.title, meta.ObjectName, meta.XPTitle, meta.Headline) || names.title;
  const caption = field('caption', meta.description, meta.Caption, meta['Caption-Abstract'], meta.ImageDescription, meta.XPComment);

  let location = typed('location');
  if (!location && !isHidden(o.location) && show.location !== 'none') {
    const parts = {
      sub: firstText(meta.Sublocation, meta.Location),
      city: firstText(meta.City),
      state: firstText(meta.State, meta['Province-State']),
      country: firstText(meta.Country, meta['Country-PrimaryLocationName']),
    };
    const chosen = show.location === 'full' ? [parts.sub, parts.city, parts.state, parts.country]
      : show.location === 'country' ? [parts.country]
        : [parts.city, parts.state, parts.country];
    location = chosen.filter((part, i, all) => part && all.indexOf(part) === i).join(', ');
  }

  const date = typed('date') || (isHidden(o.date) ? '' : formatDate(meta.DateTimeOriginal ?? meta.CreateDate ?? meta.DateCreated, show.date));

  // Alt text is never empty on the page: a linked image needs a text alternative.
  const altOwn = isHidden(o.alt) ? firstText(meta.AltTextAccessibility) : firstText(o.alt, meta.AltTextAccessibility);
  const alt = altOwn || caption || title;
  const altSource = altOwn ? 'alt' : caption ? 'caption' : title ? 'title' : 'none';

  // Camera data: typed values win, "-" hides one field, "exif": false ignores
  // everything the file says (useful for film scans: type camera/lens/etc.).
  const fromFile = o.exif === false ? {} : (() => {
    const focalLength = num(meta.FocalLength);
    const f35 = num(meta.FocalLengthIn35mmFormat);
    const aperture = num(meta.FNumber);
    const iso = num(meta.ISO ?? meta.ISOSpeedRatings ?? meta.PhotographicSensitivity);
    return {
      camera: formatCamera(meta.Make, meta.Model),
      lens: formatLens(meta.LensModel ?? meta.Lens),
      focal: focalLength > 0 ? `${round(focalLength, 0)}mm` : '',
      focal35: f35 > 0 && focalLength > 0 && Math.abs(f35 - focalLength) / f35 > 0.05 ? `${round(f35, 0)}mm` : '',
      aperture: aperture > 0 ? `f/${round(aperture)}` : '',
      shutter: formatShutter(num(meta.ExposureTime)),
      iso: iso > 0 ? `ISO ${round(iso, 0)}` : '',
    };
  })();
  const exif = {};
  for (const key of EXIF_KEYS) {
    if (isHidden(o[key])) continue;
    const value = normaliseTyped(key, text(o[key])) || fromFile[key] || '';
    if (value) exif[key] = value;
  }
  if (exif.focal && !text(o.focal) && fromFile.focal35) exif.focal35 = fromFile.focal35;

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
export function widthLadder(width, height) {
  const scale = Math.min(1, ENCODE.maxLongEdge / Math.max(width, height));
  const top = Math.round(width * scale);
  return [...ENCODE.widths.filter((w) => w < top * 0.85), top];
}

function rightsXmp({ artist, copyright }) {
  const parts = [];
  if (artist) parts.push(`<dc:creator><rdf:Seq><rdf:li>${escapeHtml(artist)}</rdf:li></rdf:Seq></dc:creator>`);
  if (copyright) parts.push(`<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${escapeHtml(copyright)}</rdf:li></rdf:Alt></dc:rights>`);
  if (!parts.length) return '';
  return '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' + parts.join('') +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
}

/** Decoder warnings some cameras', phones' and scanners' files trigger while
 *  the image itself is fine. Anything else means damage. */
const BENIGN_WARNINGS = [/extraneous bytes before marker/i, /invalid sos parameters for sequential jpeg/i, /unknown jfif revision/i];

/**
 * Decode, orient, colour-convert and downscale ONCE into a master. Every
 * decoder warning is collected: a harmless quirk becomes a note, anything
 * else (or more warnings than the harmless ones shown) stops the photo, so a
 * damaged file is never published half grey.
 */
async function decodeMaster(buffer, maxWidth, notes, fileName) {
  const warnings = [];
  const image = sharp(buffer, { failOn: 'none', limitInputPixels: PIXEL_LIMIT });
  image.on('warning', (message) => warnings.push(String(message)));
  const master = await image
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // transparency becomes white
    .toColourspace('srgb')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  const lines = new Set();
  let reported = 0;
  for (const w of warnings) {
    const count = /read gave (\d+) warnings?/i.exec(w);
    if (count) { reported = Math.max(reported, +count[1]); continue; }
    for (const line of w.split('\n')) if (line.trim()) lines.add(line.trim());
  }
  const damage = [...lines].filter((l) => !BENIGN_WARNINGS.some((re) => re.test(l)));
  if (damage.length) throw new Error(damage.join('\n'));
  if (reported > lines.size) throw new Error('Corrupt JPEG data: the decoder found more problems than it described');
  if (lines.size) notes.push(`${fileName}: has a harmless quirk (${[...lines][0].replace(/^VipsJpeg:\s*/, '')}); it was processed normally.`);
  return master;
}

async function encode(buffer, id, rights, notes, fileName) {
  const { width, height } = orientedSize(await sharp(buffer, { failOn: 'truncated', limitInputPixels: PIXEL_LIMIT }).metadata());
  if (!width || !height) throw new Error('could not read the image size');
  const widths = widthLadder(width, height);
  const master = await decodeMaster(buffer, widths.at(-1), notes, fileName);
  const raw = { width: master.info.width, height: master.info.height, channels: master.info.channels };
  const fromMaster = () => sharp(master.data, { raw });

  const ifd0 = {};
  if (rights.artist) ifd0.Artist = rights.artist;
  if (rights.copyright) ifd0.Copyright = rights.copyright;
  const xmp = rightsXmp(rights);

  const write = async (w, format) => {
    let pipeline = fromMaster()
      .resize({ width: w })
      .withMetadata({ density: ENCODE.density })
      .withIccProfile('srgb')
      .withExif({ IFD0: ifd0, IFD2: { ColorSpace: '1' } }); // 1 = sRGB
    if (xmp) pipeline = pipeline.withXmp(xmp);
    const { from, ...avifLarge } = ENCODE.avifLarge;
    pipeline = format === 'avif' ? pipeline.avif(w >= from ? avifLarge : ENCODE.avif) : pipeline.jpeg(ENCODE.jpeg);
    const file = path.join(OUT_DIR, `${id}-${w}.${format === 'avif' ? 'avif' : 'jpg'}`);
    await pipeline.toFile(`${file}.tmp`);
    await renameRetry(`${file}.tmp`, file);
  };
  await Promise.all(widths.flatMap((w) => [write(w, 'avif'), write(w, 'jpeg')]));
  // The tint comes from the smallest published JPEG, so every computer that
  // builds the site gets exactly the same colour.
  return { width, height, widths, tint: await tintOf(sharp(path.join(OUT_DIR, `${id}-${widths[0]}.jpg`))) };
}

/** Average colour (shown while a photo loads). */
async function tintOf(image) {
  const { data } = await image.resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return toHex(data[0], data[1], data[2]);
}

function filesFor(id, widths) {
  return widths.flatMap((w) => [`${id}-${w}.avif`, `${id}-${w}.jpg`]);
}

async function allExist(files) {
  return (await Promise.all(files.map((f) => fileOk(path.join(OUT_DIR, f))))).every(Boolean);
}

/**
 * Prepare one photo: describe it, then reuse its images if they exist
 * (unchanged, renamed, or already built on another computer), or encode them.
 */
async function processPhoto(entry, cache, notes, show) {
  const sourcePath = path.join(SRC_DIR, entry.fileName);
  const info = await stat(sourcePath);
  const seen = cache.files[entry.fileName];
  let buffer = null;
  let sourceHash;
  if (!FORCE && seen && seen.size === info.size && seen.mtimeMs === info.mtimeMs) {
    sourceHash = seen.hash; // unchanged since last time: don't re-read it
  } else {
    buffer = await readFile(sourcePath);
    sourceHash = hash(buffer);
  }
  cache.files[entry.fileName] = { size: info.size, mtimeMs: info.mtimeMs, hash: sourceHash };

  const key = hash(sourceHash + ENCODE_KEY, 8);
  const id = `${entry.names.fileSlug}-${key}`;
  const meta = await readMetadata(buffer ?? sourcePath, entry.fileName, notes);
  const text = describe(meta, entry.override, entry.names, show);

  let image = null;
  let status = 'encoded';
  const known = !FORCE && cache.encodes[key];
  if (known && await allExist(filesFor(id, known.widths))) {
    image = known;
    status = 'unchanged';
  } else if (known && known.id !== id && await allExist(filesFor(known.id, known.widths))) {
    // Same picture under a new name: copy its images instead of re-encoding.
    const from = filesFor(known.id, known.widths);
    const to = filesFor(id, known.widths);
    await Promise.all(from.map((f, i) => copyFile(path.join(OUT_DIR, f), path.join(OUT_DIR, to[i]))));
    image = known;
    status = 'renamed';
  } else if (!FORCE) {
    // No record (e.g. a fresh clone), but the images may already be here.
    const size = orientedSize(await sharp(buffer ?? sourcePath, { failOn: 'truncated', limitInputPixels: PIXEL_LIMIT }).metadata());
    if (size.width && size.height) {
      const widths = widthLadder(size.width, size.height);
      if (await allExist(filesFor(id, widths))) {
        image = { ...size, widths, tint: await tintOf(sharp(path.join(OUT_DIR, `${id}-${widths[0]}.jpg`))) };
        status = 'reused';
      }
    }
  }
  if (!image) image = await encode(buffer ?? await readFile(sourcePath), id, text.rights, notes, entry.fileName);
  cache.encodes[key] = { id, width: image.width, height: image.height, widths: image.widths, tint: image.tint, used: true };

  const { rights, ...fields } = text;
  return {
    ...fields,
    artist: rights.artist,
    copyright: rights.copyright,
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

/** The gallery's target row height as CSS, built from the one definition
 *  (`var ROW = {…}`) in assets/js/page.js. Used for the sizes hints and the
 *  no-JS layout (--row-h on the gallery). */
export function rowCss(pageJs) {
  const match = /var ROW = (\{[^}\n]*\})/.exec(pageJs);
  if (!match) throw new Error('assets/js/page.js is missing its `var ROW = { … };` line.');
  const row = Function(`return ${match[1]}`)();
  return `min(clamp(${row.min}px, calc(${row.base}px + ${+(row.vw * 100).toFixed(3)}vw), ${row.max}px), 85vh)`;
}

function srcset(photo, ext) {
  return photo.widths.map((w) => `${photo.base}-${w}.${ext} ${w}w`).join(', ');
}

/**
 * `sizes` for the first (eager) photos, which browsers start fetching before
 * any script runs: their actual width in the gallery at a range of screen
 * widths, worked out with the page's own row layout. 3x screens get 2x
 * files (page.js caps thumbnails at 2x too).
 */
function eagerSizes(photos, pageJs) {
  const src = pageJs;
  const start = src.indexOf('  function partition(');
  const end = src.indexOf('  /* ---- choosing thumbnail files */');
  if (start < 0 || end < 0 || !photos.length) return [];
  const row = Function(`return ${/var ROW = (\{[^}\n]*\})/.exec(src)[1]}`)();
  const partition = Function('MAX_PER_ROW', `${src.slice(start, end)}; return partition;`)(12);
  const ratios = photos.map((p) => p.width / p.height);
  // Screen widths up to which each estimate applies (CSS px). Within each
  // range the layout is sampled every 40px and the widest result is used, so
  // the photo is never soft and rarely more than a step too large.
  const steps = [];
  for (let vw = 420; vw <= 1260; vw += 60) steps.push(vw);
  steps.push(1400, 1600, 1800, 2000, 2300, 2600);
  const at = (vw) => {
    const gutter = Math.max(Math.min(48, Math.max(16, vw * 0.032)), (vw - 2200) / 2);
    const width = vw - 2 * gutter - 1;
    const gap = Math.min(12, Math.max(6, vw * 0.0075));
    const vh = vw <= 599 ? 844 : vw <= 1024 ? 1180 : 900; // typical screen heights
    const target = Math.min(Math.max(row.min, Math.min(row.max, row.base + row.vw * width)), (vh - 40) * 0.9);
    const widths = new Array(per.length).fill(0);
    for (const r of partition(ratios, width, gap, target, vw <= 599 ? 64 : 80)) {
      for (let k = r.start; k < r.end && k < per.length; k++) widths[k] = Math.ceil(ratios[k] * r.height);
    }
    return widths;
  };
  const per = photos.slice(0, MARKUP.eager).map(() => []);
  let from = 320;
  for (const upTo of steps) {
    const widest = new Array(per.length).fill(0);
    for (let vw = from; vw <= upTo; vw += 40) at(vw).forEach((w, k) => { widest[k] = Math.max(widest[k], w); });
    at(upTo).forEach((w, k) => { widest[k] = Math.max(widest[k], w); });
    widest.forEach((w, k) => per[k].push([upTo, w]));
    from = upTo + 1;
  }
  return per.map((list) => {
    const parts = [];
    list.forEach(([vw, w], i) => {
      const query = i === list.length - 1 ? '' : `(max-width: ${vw}px)`;
      parts.push(`(min-resolution: 2.5dppx)${query ? ` and ${query}` : ''} ${Math.ceil(w * 2 / 3)}px`);
    });
    list.forEach(([vw, w], i) => parts.push(i === list.length - 1 ? `${w}px` : `(max-width: ${vw}px) ${w}px`));
    return parts.join(', ');
  });
}

function renderTile(photo, index, total, rowHeight, eagerSize) {
  const ar = photo.width / photo.height;
  const eager = index < MARKUP.eager;
  const number = String(index + 1).padStart(Math.max(2, String(total).length), '0');
  // Eager photos: their width at each screen size (see eagerSizes). Lazy ones:
  // a close guess that page.js, inlined after the gallery, replaces with the
  // exact width before any of them starts loading (it's what no-JS uses).
  const sizes = eager && eagerSize ? eagerSize : `min(100vw, calc(${round(ar * 1.1, 3)} * ${rowHeight}))`;
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

function renderGallery(photos, pageJs) {
  const rowHeight = rowCss(pageJs);
  const eager = eagerSizes(photos, pageJs);
  const data = photos.map((p) => ({
    id: p.id, title: p.title, caption: p.caption, location: p.location, date: p.date,
    width: p.width, height: p.height, tint: p.tint, exif: p.exif,
  }));
  // The page script runs inline, right here, so rows have their final size
  // before the first paint and before lazy images choose a file.
  const script = pageJs.trim().replace(/<\/(script)/gi, '<\\/$1');
  return `
      <ol class="gallery" id="gallery" style="--row-h: ${rowHeight}">${photos.map((p, i) => renderTile(p, i, photos.length, rowHeight, eager[i])).join('')}
      </ol>
      <script type="application/json" id="gallery-data">${scriptJson(data)}</script>
      <script>/* assets/js/page.js (inlined by the build) */
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

const PLACEHOLDER = /\bYour Name\b|example\.com|City, Country|Client One/;

/** Read site.json, check it, and normalise it. Problems become notes. */
async function loadSite(notes) {
  if (!existsSync(SITE_FILE)) {
    throw new Error('site.json is missing. Restore it from the repository (it holds your name, bio and contact details).');
  }
  const raw = await readJson(SITE_FILE, {}, notes);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('site.json should contain an object like {"name": "…"}.');
  const str = (v, label) => {
    if (v == null) return '';
    if (typeof v !== 'string') {
      notes.push(`site.json: "${label}" should be text in quotes; ignored.`);
      return '';
    }
    return v.trim();
  };
  const map = (v, label) => {
    if (v == null) return [];
    if (typeof v !== 'object' || Array.isArray(v)) {
      notes.push(`site.json: "${label}" should be a list of "Label": "value" pairs; ignored.`);
      return [];
    }
    return Object.entries(v).map(([k, val]) => [k.trim(), str(val, `${label}.${k}`)]).filter(([k, val]) => k && val);
  };
  const section = (key, example) => {
    const v = raw[key];
    if (v == null) return {};
    if (typeof v === 'object' && !Array.isArray(v)) return v;
    notes.push(`site.json: "${key}" should be a group like ${example}; it was ignored.`);
    return {};
  };
  const unknown = Object.keys(raw).filter((k) => !SITE_KEYS.includes(k));
  if (unknown.length) notes.push(`site.json: unknown setting(s) ${unknown.map((k) => `"${k}"`).join(', ')} were ignored (email and links go inside "contact", the bio inside "about").`);
  const about = section('about', '{ "lede": "…", "text": ["…"] }');
  const contact = section('contact', '{ "email": "…", "links": { … } }');
  const showRaw = section('show', '{ "location": "city", "date": "month" }');
  const licensing = section('licensing', '{ "license": "https://…", "page": "https://…" }');
  const paragraphs = typeof about.text === 'string' ? [about.text] : Array.isArray(about.text) ? about.text : [];

  const site = {
    name: str(raw.name, 'name') || 'Your Name',
    title: str(raw.title, 'title') || 'Photography',
    language: str(raw.language, 'language') || 'en',
    tagline: str(raw.tagline, 'tagline'),
    description: str(raw.description, 'description'),
    url: str(raw.url, 'url'),
    lede: str(about.lede, 'about.lede'),
    text: paragraphs.map((t, i) => str(t, `about.text[${i}]`)).filter(Boolean),
    facts: map(about.facts, 'about.facts'),
    intro: str(contact.intro, 'contact.intro'),
    email: str(contact.email, 'contact.email'),
    links: [],
    show: { ...SHOW_DEFAULTS },
    license: '',
    licensePage: '',
  };
  if (!str(raw.name, 'name')) notes.push('site.json: "name" is empty; showing "Your Name".');
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(site.language)) {
    notes.push(`site.json: "language" (${site.language}) should be a language code like "en" or "pt-PT"; using "en".`);
    site.language = 'en';
  }
  for (const key of ['location', 'date']) {
    const v = showRaw[key];
    if (v == null) continue;
    if (SHOW_CHOICES[key].includes(v)) site.show[key] = v;
    else notes.push(`site.json: "show.${key}" should be one of ${SHOW_CHOICES[key].map((c) => `"${c}"`).join(', ')}; using "${SHOW_DEFAULTS[key]}".`);
  }

  if (site.url) {
    try {
      const u = new URL(/^[a-z]+:/i.test(site.url) ? site.url : `https://${site.url}`);
      if (!/^https?:$/.test(u.protocol)) throw new Error('not http(s)');
      // The site's folder: drop a page name (…/index.html), query and hash.
      u.hash = '';
      u.search = '';
      u.pathname = u.pathname.replace(/[^/]*\.[a-z0-9]+$/i, '');
      site.url = u.href.endsWith('/') ? u.href : `${u.href}/`;
    } catch {
      notes.push(`site.json: "url" (${site.url}) isn't a web address like https://yourname.com/; ignored.`);
      site.url = '';
    }
  }
  if (site.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(site.email)) {
    notes.push(`site.json: "email" (${site.email}) doesn't look like an email address; it was left out.`);
    site.email = '';
  }
  for (const [label, value] of map(contact.links, 'contact.links')) {
    // "instagram.com/you" is fine too: https:// is added.
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : /^[^\s/]+\.[^\s/]+/.test(value) ? `https://${value}` : value;
    try {
      const u = new URL(candidate);
      if (!/^(https?|mailto|tel):$/.test(u.protocol)) throw new Error('scheme');
      site.links.push([label, u.href]);
    } catch {
      notes.push(`site.json: the link "${label}" (${value}) should be a web address like https://…; it was left out.`);
    }
  }
  for (const [key, label] of [['license', 'licensing.license'], ['page', 'licensing.page']]) {
    const v = str(licensing[key], label);
    if (!v) continue;
    try {
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) throw new Error('scheme');
      site[key === 'license' ? 'license' : 'licensePage'] = u.href;
    } catch {
      notes.push(`site.json: "${label}" (${v}) should be a web address like https://…; it was left out.`);
    }
  }
  if (!site.lede && !site.text.length && !site.facts.length) notes.push('site.json: "about" is empty, so the About section will be blank.');
  if (!site.email && !site.links.length) notes.push('site.json: no email or links in "contact", so the Contact section will be blank.');
  if (PLACEHOLDER.test(JSON.stringify(raw))) {
    notes.push('site.json still contains placeholder text (e.g. "Your Name", hello@example.com). Replace it with your own details.');
  }
  return site;
}

function renderMeta(site, cover, photos = []) {
  const title = `${site.name} — ${site.title}`;
  const locale = site.language.replace('-', '_');
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    site.description && `<meta name="description" content="${escapeHtml(site.description)}">`,
    `<meta name="author" content="${escapeHtml(site.name)}">`,
    site.url && `<link rel="canonical" href="${escapeHtml(site.url)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${escapeHtml(site.name)}">`,
    `<meta property="og:locale" content="${escapeHtml(locale.includes('_') ? locale : `${locale}`)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    site.description && `<meta property="og:description" content="${escapeHtml(site.description)}">`,
  ];
  // Link previews need absolute addresses, so they wait until "url" is set.
  if (site.url) {
    lines.push(`<meta property="og:url" content="${escapeHtml(site.url)}">`);
    if (cover) {
      const w = cover.widths.filter((x) => x <= 1600).at(-1) ?? cover.widths[0];
      lines.push(
        `<meta property="og:image" content="${escapeHtml(new URL(`${cover.base}-${w}.jpg`, site.url).href)}">`,
        `<meta property="og:image:width" content="${w}">`,
        `<meta property="og:image:height" content="${Math.round((w / cover.width) * cover.height)}">`,
        `<meta property="og:image:alt" content="${escapeHtml(cover.alt)}">`,
        '<meta name="twitter:card" content="summary_large_image">',
      );
    }
  }
  const person = { '@type': 'Person', name: site.name };
  if (site.url) person.url = site.url;
  if (site.tagline) person.description = site.tagline;
  const sameAs = site.links.map(([, url]) => url).filter((u) => /^https?:/.test(u));
  if (sameAs.length) person.sameAs = sameAs;
  const graph = [person];
  // Who made each photo and how to license it (search engines show this as
  // "Licensable" on image results). Needs absolute addresses, so only with url.
  if (site.url) {
    const year = new Date().getFullYear();
    for (const p of photos) {
      const image = {
        '@type': 'ImageObject',
        contentUrl: new URL(`${p.base}-${p.widths.at(-1)}.jpg`, site.url).href,
        name: p.title || undefined,
        creator: { '@type': 'Person', name: p.artist || site.name },
        creditText: p.artist || site.name,
        copyrightNotice: p.copyright || `© ${/\b(1[89]\d\d|2\d{3})\b/.exec(p.date)?.[1] ?? year} ${site.name}`,
      };
      if (site.license) image.license = site.license;
      if (site.licensePage) image.acquireLicensePage = site.licensePage;
      graph.push(image);
    }
  }
  lines.push(`<script type="application/ld+json">${scriptJson({ '@context': 'https://schema.org', '@graph': graph })}</script>`);
  return `\n    ${lines.filter(Boolean).join('\n    ')}\n    `;
}

function renderBrand(site) {
  return `
        <h1 class="brand-name"><a href="#top">${escapeHtml(site.name)}</a></h1>${site.tagline ? `
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

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes('--force');
const ALLOW_EMPTY = ARGS.includes('--allow-empty');

function printNotes(notes) {
  if (!notes.length) return;
  console.log('\nNotes:');
  for (const n of notes) console.log(`  • ${n}`);
}

function list(items, max = 5) {
  return items.slice(0, max).join(', ') + (items.length > max ? `, … (${items.length - max} more)` : '');
}

/** What's in photos/: photos to build, plus everything that was left out. */
async function collectFiles() {
  const found = { photos: [], hidden: [], unsupported: [], folders: [] };
  for (const entry of await readdir(SRC_DIR, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    if (entry.isDirectory()) { found.folders.push(name + '/'); continue; }
    const ext = path.extname(name).toLowerCase();
    if (INPUT_EXT.has(ext)) (isHiddenFile(name) ? found.hidden : found.photos).push(name);
    else if (UNSUPPORTED_EXT.has(ext)) found.unsupported.push(name);
  }
  found.photos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return found;
}

/** Each photo's name info and details.json entry; stops on clashing names. */
function prepareEntries(names, details, notes) {
  const entries = names.map((fileName) => ({ fileName, names: nameInfo(fileName) }));
  const bySlug = new Map();
  for (const e of entries) bySlug.set(e.names.slug, [...(bySlug.get(e.names.slug) ?? []), e.fileName]);
  const clashes = [...bySlug.entries()].filter(([, files]) => files.length > 1);
  if (clashes.length) {
    throw new Error(
      'Some photos have the same name once their order numbers are removed, so their links and\n' +
      '  text in details.json could get mixed up:\n' +
      clashes.map(([slug, files]) => `    "${slug}": ${files.join(', ')}`).join('\n') +
      '\n  Rename them so each is different (e.g. 07-dunes-evening.jpg). Nothing was changed.',
    );
  }
  for (const e of entries) {
    // Keyed by the name without its order number, so reordering keeps the
    // text. Full file names (an older style) are still understood.
    const raw = details[e.names.slug] ?? details[e.fileName];
    if (raw == null) continue;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      notes.push(`details.json: the entry for "${e.names.slug}" should look like {"title": "…"}; ignored.`);
      continue;
    }
    e.override = raw;
    const unknown = Object.keys(raw).filter((k) => !OVERRIDE_KEYS.includes(k));
    if (unknown.length) notes.push(`details.json: "${e.names.slug}" has unknown field(s) ${unknown.map((k) => `"${k}"`).join(', ')} (allowed: ${OVERRIDE_KEYS.join(', ')}).`);
  }
  return entries;
}

/** Write details.json back: an entry per photo, untouched leftovers dropped. */
async function updateDetails(details, entries) {
  const blank = { title: '', caption: '', alt: '', location: '', date: '', camera: '', lens: '' };
  const isBlank = (v) => v && typeof v === 'object' && Object.values(v).every((x) => x === '' || x == null);
  const next = {
    _help: [
      'Optional text for each photo, keyed by its file name without the order number (01-dunes.jpg -> "dunes").',
      'Leave a field "" to use what the photo file says. Type text to replace it. Use "-" to hide it (e.g. a sensitive location).',
      'Fields: title, caption, alt (a description for screen readers), location, date, camera, lens, and also focal, aperture, shutter, iso.',
      '"exif": false ignores all camera data in the file (useful for film scans: type camera, lens etc. yourself).',
      'How much location and date the page shows by default is set in site.json ("show").',
      'Set "_cover" to a photo name to choose the image used in link previews (default: the first landscape photo).',
      'Run `npm run build` after editing.',
    ],
    _cover: typeof details._cover === 'string' ? details._cover : '',
  };
  const kept = [];
  for (const e of entries) {
    const existing = details[e.names.slug] ?? details[e.fileName];
    if (existing == null) next[e.names.slug] = { ...blank };
    else if (typeof existing === 'object' && !Array.isArray(existing)) next[e.names.slug] = { ...blank, ...existing };
    else next[e.names.slug] = existing; // not understood (noted above): kept exactly as written
  }
  for (const [key, value] of Object.entries(details)) {
    if (key.startsWith('_') || key in next) continue;
    if (entries.some((e) => e.fileName === key)) continue; // migrated to the new key
    if (isBlank(value)) continue;
    next[key] = value;
    kept.push(key);
  }
  await writeIfChanged(DETAILS_FILE, JSON.stringify(next, null, 2) + '\n');
  return { cover: next._cover, kept };
}

async function main() {
  if (ARGS.includes('--help') || ARGS.includes('-h')) {
    console.log(HELP);
    return;
  }
  const started = Date.now();
  const notes = [];
  const unknownFlags = ARGS.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknownFlags.length) notes.push(`Unknown option(s) ignored: ${unknownFlags.join(' ')} (see npm run build -- --help).`);

  try {
    await build(notes, started);
  } catch (err) {
    printNotes(notes);
    console.error(`\nBuild stopped: ${err.message}`);
    process.exitCode = 1;
  }
}

async function build(notes, started) {
  let html = await readFile(HTML_FILE, 'utf8');
  for (const name of REGIONS) readRegion(html, name); // fail fast on missing markers
  const previousIds = [...readRegion(html, 'gallery').matchAll(/<li class="tile" id="photo-([^"]+)"/g)].map((m) => m[1]);
  const site = await loadSite(notes);
  const pageJs = await readFile(PAGE_JS_FILE, 'utf8');
  rowCss(pageJs); // fail fast

  await mkdir(SRC_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  const details = await readJson(DETAILS_FILE, {}, notes);
  const stored = await readJson(CACHE_FILE, {}, notes);
  const cache = { files: stored.files ?? {}, encodes: stored.encodes ?? {} };
  for (const e of Object.values(cache.encodes)) delete e.used;

  const found = await collectFiles();
  if (found.hidden.length) notes.push(`Hidden (name starts with "_"): ${list(found.hidden)}.`);
  if (found.folders.length) notes.push(`Folders inside photos/ are ignored: ${list(found.folders)}. Put photos directly in photos/.`);
  if (found.unsupported.length) notes.push(`Skipped ${found.unsupported.length} file(s) in a format browsers can't show (${list(found.unsupported, 4)}). Export them as JPEG or TIFF.`);

  const entries = prepareEntries(found.photos, details, notes);
  if (!entries.length && previousIds.length && !ALLOW_EMPTY) {
    const left = [found.hidden.length && `${found.hidden.length} hidden`, found.unsupported.length && `${found.unsupported.length} in formats browsers can't show`].filter(Boolean);
    throw new Error(
      `No photos to publish in photos/${left.length ? ` (${left.join(', ')})` : ''}, but the live gallery has ${previousIds.length}. Nothing was changed.\n` +
      '  Add your photos to photos/ and run again (or pass --allow-empty to really publish an empty gallery).',
    );
  }

  console.log(`Building ${entries.length} photo${entries.length === 1 ? '' : 's'} from photos/ …`);
  const cores = os.availableParallelism?.() ?? os.cpus().length;
  const concurrency = Math.max(1, Math.min(2, Math.floor(cores / 2)));
  const failures = [];
  let done = 0;
  const results = await mapPool(entries, concurrency, async (entry) => {
    const own = [];
    try {
      const photo = await processPhoto(entry, cache, own, site.show);
      notes.push(...own);
      done++;
      if (photo.status === 'encoded' || photo.status === 'renamed') {
        console.log(`  [${String(done).padStart(String(entries.length).length)}/${entries.length}] ${photo.status.padEnd(8)} ${entry.fileName}`);
      }
      return photo;
    } catch (err) {
      done++;
      failures.push({ file: entry.fileName, message: explainError(err) });
      return null;
    }
  });

  // Save the cache (minus records nothing uses any more), even after a failure,
  // so the photos that did process aren't encoded again next time.
  const names = new Set(found.photos);
  const cacheOut = {
    note: 'Build cache for tools/build.mjs. Safe to delete. Not published.',
    files: Object.fromEntries(Object.entries(cache.files).filter(([f]) => names.has(f))),
    encodes: Object.fromEntries(Object.entries(cache.encodes).filter(([, e]) => e.used).map(([k, { used, ...e }]) => [k, e])),
  };
  await writeAtomic(CACHE_FILE, JSON.stringify(cacheOut, null, 2) + '\n');

  if (failures.length) {
    printNotes(notes);
    console.error('\nThese photos could not be processed:');
    for (const f of failures) console.error(`  ✗ ${f.file} ${f.message}`);
    console.error('\nThe website was not changed (index.html is as it was). Images for the photos that');
    console.error('did process were saved and will be reused next time.');
    console.error('Fix or replace the files above (or start their names with "_" to leave them out) and run again.');
    process.exitCode = 1;
    return;
  }
  const photos = results;

  const { cover: coverKey, kept } = await updateDetails(details, entries);
  let cover = coverKey ? photos.find((p) => p.id === coverKey) : null;
  if (coverKey && !cover) notes.push(`details.json: "_cover" is "${coverKey}", but no photo has that name; using the default.`);
  cover ??= photos.find((p) => p.width / p.height >= 1.2) ?? photos[0];

  html = html.replace(/<html lang="[^"]*">/, `<html lang="${escapeHtml(site.language)}">`);
  html = replaceRegion(html, 'meta', renderMeta(site, cover, photos));
  html = replaceRegion(html, 'brand', renderBrand(site));
  html = replaceRegion(html, 'stats', renderStats(photos));
  html = replaceRegion(html, 'gallery', renderGallery(photos, pageJs));
  html = replaceRegion(html, 'about', renderAbout(site));
  html = replaceRegion(html, 'contact', renderContact(site));
  html = replaceRegion(html, 'footer', renderFooter(site));
  const htmlChanged = await writeIfChanged(HTML_FILE, html);

  // Only now, with the new index.html safely written, remove generated files
  // that no longer belong to any photo (only files matching our naming).
  const keep = new Set(photos.flatMap((p) => p.files));
  let removed = 0;
  for (const f of await readdir(OUT_DIR)) {
    if (GENERATED_FILE.test(f) && !keep.has(f)) {
      await unlink(path.join(OUT_DIR, f));
      removed++;
    }
  }


  // Summary, in gallery order.
  const digits = Math.max(2, String(photos.length).length);
  console.log('');
  const fileW = Math.min(48, Math.max(...photos.map((p) => p.file.length), 8)) + 2;
  const idW = Math.min(40, Math.max(...photos.map((p) => p.id.length), 8)) + 2;
  photos.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(digits, '0')}  ${p.file.padEnd(fileW)}#photo-${p.id.padEnd(idW)}${`${p.width}×${p.height}`.padEnd(11)}${p.status}`);
  });
  const ids = new Set(photos.map((p) => p.id));
  const gone = previousIds.filter((id) => !ids.has(id));
  const encoded = photos.filter((p) => p.status === 'encoded').length;
  console.log(
    `\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s: ${photos.length} in the gallery ` +
    `(${encoded} encoded, ${photos.length - encoded} reused), ${removed} old file${removed === 1 ? '' : 's'} removed` +
    `${htmlChanged ? ', index.html updated' : ', index.html already up to date'}.`,
  );
  if (gone.length) {
    const many = gone.length >= 3 && gone.length >= previousIds.length / 4;
    notes.push(`${many ? 'Check this: ' : ''}${gone.length} photo${gone.length === 1 ? '' : 's'} left the gallery: ${list(gone.map((id) => `#photo-${id}`), 8)}.` +
      (many ? ' If that wasn\'t intended, put them back in photos/ and build again.' : ''));
  }
  const weakAlt = photos.filter((p) => p.altSource === 'title' || p.altSource === 'none');
  if (weakAlt.length) {
    notes.push(
      `${weakAlt.length} photo${weakAlt.length === 1 ? ' has' : 's have'} no description for screen readers ` +
      `(${list(weakAlt.map((p) => p.id), 8)}). Add "alt" (or a caption) in photos/details.json.`,
    );
  }
  if (!site.url) notes.push('"url" in site.json is empty, so link previews (social media, messaging) show no image yet. Set it once the site is live.');
  if (kept.length) notes.push(`details.json keeps text for photos that are not in photos/: ${list(kept)}. Delete those entries if you no longer need them.`);
  if (!photos.length) notes.push('The gallery is empty. Add .jpg/.png/.webp/.tif files to photos/ and run again.');
  printNotes(notes);
}

// Run when called as a script (not when imported by the tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
