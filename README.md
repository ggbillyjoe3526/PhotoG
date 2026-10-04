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
npm run build        # after adding or changing photos
npm run preview      # view the site at http://localhost:8080
```

You can also open `index.html` straight from the folder.

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

**The build is careful with your site.** If any photo can't be read (for
example, a file that didn't finish copying), it stops and changes nothing. An
empty `photos/` folder never empties a published gallery. It only ever deletes
files it created itself. RAW and HEIC files are skipped with a warning; export
them as JPEG or TIFF first.

**Order.** Photos appear in file-name order. To set the order, start the names
with numbers: `01-harbour.jpg`, `02-dunes.jpg`… The number isn't shown on the
site and isn't part of the photo's link.

**Hide a photo without deleting it.** Start its file name with an underscore,
for example `_maybe-later.jpg`.

**Privacy.** The resized copies have all metadata removed, including GPS
location, camera serial numbers and edit history. Only your Artist and
Copyright fields are kept, along with an sRGB colour profile. Your originals in
`photos/` stay on your computer: git ignores them (see `.gitignore`), so they
are never committed or published. Keep your own backup of them.

## 2. Titles, captions and locations

The build reads the metadata your editing software already writes:

| Shown on the site | Where it comes from |
| --- | --- |
| Title | Title (Lightroom: *Title*; IPTC Object Name). If empty, the file name is used: `02-fog-line.jpg` becomes "Fog line" |
| Caption | Caption / Description |
| Location | IPTC Sublocation, City, State, Country |
| Date | Date taken (EXIF) |
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

- `camera` and `lens` can be filled in by hand, which is useful for film scans.
- `"exif": false` hides all camera data for one photo.
- `"_cover": "horizon"` at the top of the file picks the image that appears
  when someone shares your site's link. The default is the first photo.

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

- **name** appears in the header, the browser tab, search results and the footer.
- **description** is the one-line summary shown by search engines and in link
  previews.
- **url** is your site's address. Leave it `""` until the site is live. Once
  it's set, sharing your link on social media or in a messaging app shows your
  first photo (or the one you pick with `_cover` in `photos/details.json`).
- **facts** and **links** are lists of `"Label": "value"` pairs. Add, remove or
  rename them freely. Links must start with `https://`.
- Leave **email** `""` to show only the links.

The build checks the file and tells you about anything it had to leave out,
such as a link that doesn't start with `https://`. It also reminds you while
placeholder text like "Your Name" is still there.

The page layout itself is `index.html`. Don't edit inside the
`<!-- build:… -->` markers: the build rewrites those parts every time it runs.

## 4. Publish

The website is `index.html` plus the `assets/` folder; nothing else is needed
on the server. Your originals in `photos/` aren't part of the website.

- **GitHub Pages:** push to GitHub, then *Settings → Pages → Deploy from a
  branch* and choose your branch and `/ (root)`.
- **Netlify / Cloudflare Pages / Vercel:** connect the repository, leave the
  build command empty and set the publish directory to `/`.
- **Any web host or drag-and-drop host:** upload `index.html` and the
  `assets/` folder only. Don't upload the `photos/` folder.

Image file names include a content hash (`horizon-1a2b3c4d-1600.avif`), so you
can let browsers cache `assets/gallery/` for a long time.

---

## What visitors get

- **A gallery that never crops.** Rows are fitted to the exact width of the
  screen and every photo keeps its aspect ratio. Visitors can choose small,
  medium or large thumbnails, and the site remembers their choice.
- **A full-screen viewer** with the title, location, date and camera settings.
  - Keyboard: ← → to move between photos, Home and End to jump to the first or
    last, **I** to show or hide details, Esc to close.
  - Touch: swipe sideways to change photo, swipe down to close, and tap the
    photo to hide the controls. Pinch-zoom works too.
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
site.json             your name, bio and contact details
index.html            the page layout (build:… regions are generated)
assets/css/style.css  all styling; colours are tokens at the top
assets/js/layout.js   gallery rows (inlined into index.html by the build)
assets/js/main.js     theme, thumbnail size, viewer
assets/fonts/         Geist and Geist Mono (SIL Open Font License, see OFL.txt)
assets/gallery/       generated by the build (don't edit or add files here)
photos/               your originals (kept private) + details.json
tools/build.mjs       the build (photos + site.json -> index.html)
tools/dev/            development checks (not needed to run the site)
```
