# Photography portfolio

A minimal, fast portfolio built to get out of the way of the photographs. It's
one page: a justified gallery that never crops your images, a full-screen viewer
that shows each photo's camera data, and a short About/Contact section. Light
and dark themes follow the visitor's system setting, and there's a toggle to
switch between them.

It's plain HTML, CSS and JavaScript with no framework and no tracking, so any
static host can serve it.

---

## Quick start

You need [Node.js](https://nodejs.org) 20.9 or newer. You only need it on your
own computer to prepare the photos; the published site doesn't use it.

```bash
npm install          # once
npm run build        # after adding or changing photos or site.json
npm run preview      # view the site at http://localhost:8080
```

You can also open `index.html` straight from the folder. `npm run build:force`
re-encodes every photo. `npm test` checks the build itself; it also runs
before every automatic publish.

## 1. Add your photographs

1. Export your photos as JPEGs. Use the full resolution, or about 3000–4000 px
   on the long edge.
2. Put them in the **`photos/`** folder. The gallery always shows exactly
   what's in `photos/`, so the generated sample images the site ships with
   disappear on your first build.
3. Run `npm run build`.

The build makes resized AVIF and JPEG copies in `assets/gallery/` and writes
the gallery into `index.html`. Photos that haven't changed are skipped, and so
are photos you've only renamed, so rebuilds are quick.

**The build is careful with your site.**
- If any photo can't be read, it stops and the website stays as it was. That
  covers a damaged file or one that didn't finish copying, and it tells you
  which file and why in plain words.
- An empty `photos/` folder never empties a published gallery.
- It only ever deletes files it created itself.
- Two photos whose names clash after the numbers are removed (`03-dunes.jpg`
  and `07-dunes.jpg`) stop the build until you rename one, so their links and
  text can't get mixed up.
- RAW and HEIC files are skipped with a note: export them as JPEG or TIFF
  first.
- Folders inside `photos/` are ignored, also with a note.
- At the end it lists any photos that left the gallery.

**Order.** Photos appear in file-name order. To set the order, start the names
with numbers: `01-harbour.jpg`, `02-dunes.jpg`… The number isn't shown on the
site and isn't part of the photo's link.

**Hide a photo without deleting it.** Start its file name with an underscore,
for example `_maybe-later.jpg`. Names cameras give their files, such as
`_DSC1234.jpg`, aren't hidden. Every build lists what it hid.

**Privacy.**
- **Image files.** The resized copies have all metadata removed, including GPS
  location, camera serial numbers and edit history. Only your Artist and
  Copyright fields are kept, along with an sRGB colour profile.
- **What the page shows.** The page shows location and date text from your
  photos' metadata. By default that's the city and the month (for example
  "Lisbon, Portugal · June 2024"), never the street or the exact day. You can
  change this with `"show"` in `site.json` (see section 3), and hide it for
  single photos in `photos/details.json`.
- **Your originals.** They stay on your computer: git ignores `photos/` (see
  `.gitignore`), so they're never committed or published. Keep your own backup
  of them.

## 2. Titles, captions and locations

The build reads the metadata your editing software already writes:

| Shown on the site | Where it comes from |
| --- | --- |
| Title | Title (Lightroom: *Title*; IPTC Object Name). If empty, the file name is used: `02-fog-line.jpg` becomes "Fog line" |
| Caption | Caption / Description |
| Location | IPTC City, State, Country (plus Sublocation if `"show"` allows it) |
| Date | Date taken (EXIF), as the month by default |
| Camera data | Camera, lens, focal length, aperture, shutter speed, ISO (EXIF) |
| Alt text (for screen readers) | IPTC *Alt Text (Accessibility)*, or the caption, or the title |

**Overrides without re-exporting.** After the first build, `photos/details.json`
has an entry for every photo, named after the file without its order number
(`03-horizon.jpg` becomes `"horizon"`), so reordering never loses your text.
Fill in a field to override the file's metadata, or leave it `""` to keep the
file's value. Use `"-"` to hide something the file contains, such as a
sensitive location. Then run `npm run build` again:

```json
"horizon": {
  "title": "Horizon, 05:58",
  "caption": "Flat sea at first light.",
  "alt": "A calm grey sea meeting a pale sky at dawn.",
  "location": "-",
  "date": "June 2024",
  "camera": "",
  "lens": ""
}
```

- Camera data can be typed too: `camera`, `lens`, `focal`, `aperture`,
  `shutter` and `iso`. Plain numbers are fine: `"35"` shows as 35mm, `"5.6"`
  as f/5.6, `"125"` as 1/125s and `"400"` as ISO 400. Any of them can be `"-"`
  to hide it.
- `"exif": false` ignores everything the file says about the camera. Use it
  for film scans, where the file describes the scanner, and type the real
  camera and lens instead.
- `"_cover": "horizon"` at the top of the file picks the image that appears
  when someone shares your site's link. The default is the first landscape
  photo.

At the end of every build you'll see a list of photos that have no description
for screen readers, so you know which ones still need an `alt`.

## 3. Your name, bio and contact details

Everything about you is in **`site.json`** in the main folder. Edit the text
between the quotes, then run `npm run build`:

```json
{
  "name": "Ana Ferreira",
  "tagline": "Photographer · Landscape & Architecture",
  "description": "Landscape and architectural photography by Ana Ferreira.",
  "url": "https://anaferreira.com/",
  "about": {
    "lede": "Ana Ferreira photographs light and the quiet geometry of built places.",
    "text": ["A short biography. Add more paragraphs as more quoted lines."],
    "facts": { "Based in": "Lisbon, Portugal", "Available for": "Commissions, prints" }
  },
  "contact": {
    "intro": "For commissions, licensing and print enquiries:",
    "email": "ana@anaferreira.com",
    "links": { "Instagram": "https://instagram.com/anaferreira" }
  }
}
```

- **name** appears in the header, the browser tab, search results and the
  footer. **title** follows it in the browser tab ("Ana Ferreira —
  Photography"). **language** is the page's language code ("en", "pt-PT"…).
- **description** is the one-line summary shown by search engines and in link
  previews.
- **url** is your site's address. Leave it `""` until the site is live. Once
  it's set, sharing your link on social media or in a messaging app shows your
  first photo (or the one you pick with `_cover` in `photos/details.json`).
- **facts** and **links** are lists of `"Label": "value"` pairs. Add, remove or
  rename them freely. A link can be written as `instagram.com/you`, and
  `https://` is added for you.
- **licensing** (optional): `{ "license": "https://…", "page": "https://…" }`.
  These point to your licence terms and to a page where people can ask to
  license a photo. Search engines then label your images "Licensable".
- Leave **email** `""` to show only the links.
- **show** sets how much location and date text from your photos' metadata
  the page shows. `"location"` can be `"full"` (including street or place),
  `"city"`, `"country"` or `"none"`. `"date"` can be `"day"`, `"month"`,
  `"year"` or `"none"`. The default is `{ "location": "city", "date": "month" }`.

The build checks the file and tells you about anything it had to leave out,
such as a link that doesn't start with `https://`. It also reminds you while
placeholder text like "Your Name" is still there.

The page layout itself is `index.html`. Don't edit inside the
`<!-- build:… -->` markers: the build rewrites those parts every time it runs.

## 4. Publish

The website is `index.html` plus the `assets/` folder; nothing else belongs on
the server. Your originals, `site.json`, `photos/details.json` and the tools are
not part of the website.

- **GitHub Pages (recommended):** push the repository to GitHub. Then choose
  *Settings → Pages → Source: GitHub Actions* once. The included workflow
  (`.github/workflows/pages.yml`) publishes `index.html` and `assets/` every
  time the main branch changes. Don't use "Deploy from a branch": that would
  publish every file in the repository.
- **Netlify / Cloudflare Pages:** connect the repository and set the build
  command to `npm run package` and the publish directory to `dist`. The
  command copies just the website into `dist/`, plus a `_headers` file that
  lets browsers cache images and fonts for a long time.
- **Any other web host:** run `npm run package` and upload the contents of
  `dist/`.

### Updating the site

1. Add, remove or rename photos in `photos/`, or edit `site.json` or
   `photos/details.json`.
2. Run `npm run build` and check it with `npm run preview`.
3. Commit `index.html`, `assets/`, `site.json` and `photos/details.json`, then
   push. The workflow tests the site and publishes it.

### A public repository and your privacy

Free GitHub Pages needs a public repository. Your originals are never in it,
but everything that is committed can be read by anyone, including
`site.json`, `photos/details.json` and every published image.

Git also keeps history. A photo you remove from the gallery stays
downloadable from earlier commits. If you need to take a picture down
completely (for example at a client's request), keep the repository private
and publish with Netlify or Cloudflare Pages instead, or ask for help
rewriting the history. Every re-encoded photo also adds to the repository's
size for good, so avoid `build:force` unless you need it.

Image file names include a content hash (`horizon-1a2b3c4d-1600.avif`), so
long-term caching is safe: a changed photo always gets a new name.

---

## What visitors get

- **A gallery that never crops.** Rows are fitted to the exact width of the
  screen and every photo keeps its aspect ratio. Visitors can choose small,
  medium or large thumbnails, and the site remembers their choice.
- **A full-screen viewer** with the title, location, date and camera settings.
  - Keyboard: ← → to move between photos, Home and End to jump to the first or
    last, **I** to show or hide details, **Z** to zoom, Esc to close.
  - Zoom: click the photo (or press Z, or use the magnifier button) to see it
    at full resolution, then move the pointer, drag or use the arrow keys to
    look around.
  - Touch: swipe sideways to change photo, swipe down to close, tap the photo
    to hide the controls, and double-tap to zoom. Pinch-zoom works too.
  - On a phone held sideways, the photo fills the screen height and the
    details sit beside it.
  - Every photo has its own shareable link (`yoursite.com/#photo-horizon`), and
    the browser's Back button closes the viewer.
- **Fast loading.** Each screen gets an AVIF image at the right size, with a
  JPEG fallback, and no photo is ever downloaded twice. Only the first few
  photos load straight away, and each thumbnail shows its average colour while
  it loads. The page doesn't jump around while it loads.
- **Accessible.** Everything works with a keyboard, focus is always visible,
  screen readers get alt text and announcements, and animations are turned off
  for visitors who ask their system for reduced motion.
- **Works without JavaScript.** The grid still lays out, and each thumbnail
  opens the full image.

## Project layout

```
site.json             your name, bio, contact details and privacy choices
index.html            the page layout (build:… regions are generated)
assets/css/style.css  all styling; colours are tokens at the top
assets/js/page.js     theme, gallery rows, S/M/L (inlined into index.html by the build)
assets/js/viewer.js   the full-screen viewer
assets/fonts/         Geist and Geist Mono (SIL Open Font License, see OFL.txt)
assets/gallery/       generated by the build (don't edit or add files here)
photos/               your originals (kept private) + details.json
tools/build.mjs       the build (photos + site.json -> index.html); tests in build.test.mjs
tools/package.mjs     copies the website into dist/ for publishing
tools/check-site.mjs  checks every file index.html refers to exists
tools/dev/            development checks (not needed to run the site)
```
