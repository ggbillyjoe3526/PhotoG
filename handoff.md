# Handoff: photography portfolio

Notes for the next working session. Read this first, then `README.md` (the
owner-facing guide).

**Branch:** `claude/peaceful-babbage-rt4xuu` · **Last updated:** 2026-10-04

---

## 1. What the owner asked for

> A basic, functional, yet minimalistic website to show off my photography in
> a modern, technical gallery. Professional and top quality. The goal is for
> viewers to easily look at the photographs.

**Process rule (owner's):** every feature, milestone and final build is reviewed
by a critic agent running Opus 5.5 at "Extra" effort (`xhigh`).

| Critic score | What happens |
|---|---|
| below 8.5 | total rework |
| 8.5 to 9.4 | rework, refine, improve |
| 9.5 or above | accepted |

Each feature gets at most 4 critic attempts. If none reaches 9.5, keep the
highest-scoring version, which is why every attempt is committed.

**Owner's answers to setup questions:**

| Question | Answer |
|---|---|
| Name on the site | Placeholder for now ("Your Name") |
| Theme | Follow the system light/dark setting, plus a toggle |
| Structure | One page: gallery, then About and Contact |
| Camera data | Read automatically from EXIF with one Node command, which also makes resized copies |

## 2. How the critic is run

- The brief, method, rubric and output format are in `.claude/agents/critic.md`.
  Its frontmatter sets `model: claude-opus-5-5` and `effort: xhigh`.
- **Preferred: `tools/dev/run-critic.sh <prompt-file> <report-file>`.** It runs
  the critic as a separate Claude Code process (`claude -p --agent critic
  --model claude-opus-5-5 --effort xhigh`, own session, Read/Glob/Grep/Bash
  allowed) and writes the report as markdown, with the model actually used in
  its first line. Run it from the repo root in the background. This works even
  when the Agent tool is unavailable, as it was in the 2026-10-04 session.
- Alternatively, in a fresh session, `Agent(subagent_type: "critic")`.
- Give each critic a **frozen snapshot** of the repo, not the live tree. Copy
  it to a scratch folder with `tar --exclude=.git -cf - . | tar -xf - -C <dir>`
  and give the critic its own port. This lets you keep working while it
  reviews.
- When re-reviewing, pass the previous findings so the critic can verify them,
  but ask for an independent score.
- Tell critics the dev server sends `no-store`, so a repeated request for the
  same URL is a dev-server artefact.

## 3. Review scoreboard

| Feature | Attempt | Score | Result |
|---|---|---|---|
| F1: build pipeline (`tools/build.mjs`, `site.json`) | 1 | **7.4** | Total rework |
| F1 | 2 | **8.7** | Refined |
| F1 | 3 | **8.9** | Best F1 score (reviewed commit `3fcdf92`) |
| F1 | 4 (last) | **8.4** | Two blockers that earlier reviews missed (large damaged JPEGs published; 16-bit colour shift). Fixed after the loop, in `0a20ea9` |
| F2: page shell, gallery grid, theme | 1 | **8.5** | Refined |
| F2 | 2 | **9.2** | Refined |
| F2 | 3 | **9.3** | Best F2 score (reviewed commit `3fcdf92`) |
| F2 | 4 (last) | **9.2** | Safe areas and slow-network double downloads. Fixed after the loop, in `0a20ea9` |
| F3: full-screen viewer | 1 | **7.7** | Total rework (now `viewer.js`) |
| F3 | 2 | **8.9** | Refined: a new touch layer |
| F3 | 3 | **8.7** | Four blockers (phone EXIF clipped, tap jump when zoomed, drag zoomed out, broken-image icon). All fixed |
| F3 | 4 (last) | **8.9** | Ties the best F3 score. Two blockers (repeated Esc closed instead of zooming out; landscape details column overflowing upward) and refinements, all fixed after the loop |
| Final build (whole site) | 1 | **8.8** | Two blockers (dark control backings stuck on, hiding the light-theme focus ring; landscape details column). Fixed, along with the refinements |
| Final build | 2 | pending | |

**How the "keep the best" rule was applied to F1, F2 and F3.** None reached
9.5 in 4 attempts. Their attempt-4 findings were defects that were already
in the best-scoring versions (the reviewers found them later, not
regressions), so the current code, which is the best version plus fixes for
everything the reviewers found, is kept rather than rolling back. The
final-build review judges those fixes.

Full reports were written to the session scratchpad
(`critic/<feature>-a<attempt>/report.md`); the commit history records which
commit each attempt reviewed.

## 4. Status by feature

### 4.1 F1: build pipeline

- **Two phases.**
  1. One photo at a time: hash, decide whether its images can be reused
     (unchanged, renamed, or built on another computer). A photo that needs
     encoding gets a full-resolution integrity check first. A strict
     `failOn: 'warning'` `stats()` pass streams every pixel. If that stops on a
     warning that isn't damage, a full raw decode collects every warning.
     Known harmless quirks become a note. Damage, or more warnings than
     described, stops the build before anything is encoded. (The encoder
     shrinks while decoding, which hides damage, hence the separate pass.
     `stats()` emits no warning events, and `extractChannel()` loses them.)
  2. In parallel: encode from one decoded sRGB master per photo. 16-bit files
     with a profile get `.withIccProfile('srgb')`; untagged ones must not.
- **Order of writes.** `details.json` and `index.html` are written before any
  generated file is deleted. Renames are retried on EPERM/EBUSY.
- **Renames** copy the images and move the photo's `details.json` text to the
  new name. `"hide": true` leaves a photo out but keeps its text.
- **Stale-page guard.** `index.html` carries per-file fingerprints
  (`<!-- sources: site.json=… photos/details.json=… assets/js/page.js=…; … -->`),
  ignoring line endings and BOM. `tools/check-site.mjs` fails and names the
  file if one changed without a rebuild. CI and `npm run package` both run
  it.
- **Text-only rebuilds.** Every full build writes
  `assets/gallery/gallery.json` (the gallery's photo records). When `photos/`
  is completely empty, as on a fresh clone without the originals, the build
  keeps the gallery from that record and applies `site.json` and `page.js`.
  It does this only if the record matches the page and every image exists.
  A `details.json` change can't be applied there: its old fingerprint is
  kept, so the publish check flags it.
- **`site.json` checks.**
  - Wrong types and unknown keys, including nested ones in about, contact,
    show and licensing, produce notes.
  - Notes appear when About or Contact would be empty.
  - Page names are stripped from `url`, and `pt_PT` is accepted.
  - Optional `licensing` feeds JSON-LD ImageObjects (only when `url` is set)
    and the XMP WebStatement.
- **Typed camera values:** "35" becomes 35mm, "24-70" 24–70mm, "5.6" f/5.6,
  "125" 1/125s, "30s" stays 30s, and "400" ISO 400.
- **Camera names** (never hidden by `_`): known prefixes, plus the DCF rule
  in upper case only (`_IGP0042`, `_1000123`; `_old2024` is hidden).
- **Layout settings.** `page.js` holds one-line `ROW` and `LAYOUT` settings
  that the build reads, along with `partition()` itself, matched by braces.
  The build uses them to compute `sizes` for the eager photos: every photo in
  the first row of the widest layout, from 2 up to 5, sampled at common
  phone widths and then every 60 px. A unit test checks that `LAYOUT`
  matches `style.css`.
- **Damaged cache.** A damaged `.build-cache.json` is replaced, with a note.
- **Tests.** Run with `npm test`, 32 in total:
  - 19 unit tests in `tools/build.test.mjs`.
  - 13 integration tests in `tools/build.integration.test.mjs`, running the
    real build in a temporary copy via `PHOTOG_ROOT`. They cover large
    cut-off and damaged JPEGs, a quirk with and without damage, 16-bit
    colour, rename, hide, a damaged cache, and the stale-page check.

### 4.2 F2: gallery page

- **`page.js`** is inlined after the gallery and holds the theme, the row
  engine, resizing and S/M/L.
- **Row engine** (dynamic programming, like line breaking):
  - Uneven neighbouring rows cost more.
  - The last row is justified or left part-filled, whichever is cheaper.
  - Rows taller than the screen minus the captions (`maxH`) pay a steep
    penalty.
- **Thumbnails.**
  - Capped at 2× density and upgraded only near the viewport.
  - The first row's photos are eager, with no fade-in; lazy photos fade in
    over 0.3 s.
  - The first photos' `sizes` are frozen once they load.
  - Lazy images are `display: none` until the rows are laid out
    (`.is-justified`), so slow connections don't fetch them twice. A 3 s
    `layout-timeout` class and `layout-failed` are the fail-safes.
- **Rotation and resize** keep the centred photo in place.
- **Safe areas.** The header, sections and footer use
  `--page-gutter-l` and `--page-gutter-r`.
- **Fonts.** Latin and Latin Extended subsets of Geist and Geist Mono, split
  by `unicode-range`. Only Latin is preloaded.

### 4.3 F3: viewer (`assets/js/viewer.js`)

- **Layout.** The fit is computed from the dialog's own size and the bars
  float. The details reserve is measured in a detached clone.
  - Phones: a compact exposure line ("210mm · f/8 · 1/320s · ISO 160").
  - Short screens: overlay controls, with the details in a side column. The
    column is a flex column with `margin-top: auto`, so it sits at the
    bottom but scrolls from the top.
  - Dark glass backings are computed from `fit`/`zoom`, not the live rect,
    for the tools and the counter separately; more than 12 px of overlap on
    both axes is needed. Over a photo, the focus ring is white with a dark
    halo.
- **Touch layer**, listening on the whole dialog with `touch-action: none`:
  - A tap toggles the controls and never closes the viewer.
  - Double-tap zooms.
  - Pinch zoom is the viewer's own.
  - A sideways swipe slides the neighbouring photo in.
  - A swipe down fades the background.
- **Mouse.** Drag-to-pan when zoomed, with pointer capture and a grab
  cursor. A press that moves more than 4 px is never a click. The wheel pans.
- **Keys.** Esc while zoomed is caught on keydown in the capture phase,
  because Chrome can skip the cancelable `cancel` event on repeated Esc. I
  and the Details button also zoom out first while zoomed.
- **Robustness.**
  - A failed load keeps the preview: AVIF first, then the JPEG.
  - `show()` hides any half-slid neighbour.
  - The source tile is hidden during the open and close animations.
- **Shared links.** The head script, above the stylesheet, preloads
  `viewer.js` at high priority. A `deep-link` cover paints the viewer
  background until it opens.
- **Checks.** `tools/dev/viewer-check.mjs` has 48 assertions, all passing.
  They include three zoom/Esc rounds, a 5-size × 17-photo landscape column
  sweep, and the backing test.

## 5. Next steps, in order

1. Final-build review attempts 2 to 4, as needed. Then update `README.md`
   and this file.

## 6. Working on this repo

```bash
npm install                                   # sharp + exifr
python3 -m pip install Pillow numpy           # only for the sample generator
python3 tools/dev/gen_samples.py photos       # recreate the 17 placeholder originals (git-ignored)
npm run build                                 # photos/ -> assets/gallery/ + index.html (~2 min cold, AVIF)
npx http-server -p 8123 -c-1 -s . &           # serve
```

**Dev checks** live in `tools/dev/`. They use Playwright with Chromium at
`/opt/pw-browsers/chromium`. For ESM imports, run them from a folder with a
`node_modules/playwright` symlink to the global install (ESM ignores
`NODE_PATH`), or `npm i -D playwright`.

| Script | What it checks |
|---|---|
| `run-critic.sh <prompt> <report>` | runs the critic (Opus 5.5, xhigh) |
| `screenshots.mjs <url> <outDir>` | main states incl. S/M/L, no-JS, 2560px; logs CLS and console errors |
| `viewer-check.mjs [url]` | 48 pass/fail viewer assertions (close paths, rotation, landscape phones, zoom/Esc, drag, races, touch, failed loads, control backings, reduced motion) |
| `anchor-check.mjs` | S/M/L keeps the centred photo in place |
| `download-check.mjs [url] [--throttle]` | image requests per device and size, including a rotation step; flags wasted, aborted, soft or oversized files |
| `row-sim.mjs` | row partition across widths for S/M/L (uses the real `partition()` from `page.js`) |
| `npm test` | 32 unit and integration tests for the build |

**Build edge cases to re-test after F1 changes:**
- A Lightroom XMP file containing `&amp;` and `&#xA;`.
- A PNG with alpha.
- `DSC_1234.jpg`.
- A `.HEIC` file.
- Truncated and mid-damaged JPEGs, including ones larger than 4000 px: expect exit 1, nothing encoded and nothing changed.
- A 16-bit TIFF or PNG with a profile: colours must match the 8-bit export.
- An empty `photos/`: the build must refuse.
- Renaming `32-x.jpg` to `03-x.jpg`: text kept, nothing re-encoded.
- `"-"` and `exif: false` overrides.
- Trailing commas and unknown keys in `details.json`.
- A non-generated file in `assets/gallery/` must survive the build.
- `site.json` cases. Each should produce a note and be left out:
  - an empty name
  - a `javascript:` url or link
  - a bad email
  - HTML in the tagline (must be escaped)
  - trailing commas
- A missing `site.json` must stop the build.

## 7. Architecture at a glance

```
index.html             page shell; all <!-- build:… --> regions are generated
assets/css/style.css   tokens (light/dark) at top; gallery; about/contact; viewer
site.json              owner details + privacy ("show") -> build:meta|brand|about|contact|footer
assets/js/page.js      theme, row engine, resize, S/M/L; inlined after the gallery by the build
assets/js/viewer.js    the viewer (deferred; starts from window.Portfolio)
tools/package.mjs      copies index.html + assets/ to dist/ (+ _headers)
tools/check-site.mjs   CI gate: index.html up to date + every referenced file exists
.github/workflows/pages.yml  publishes only index.html + assets/ to GitHub Pages
assets/gallery/        generated AVIF+JPEG: <slug>-<hash(source+settings)>-<width>.<ext>
assets/fonts/          Geist + Geist Mono, latin + latin-ext (OFL)
photos/                originals (git-ignored), details.json + README.txt (tracked)
tools/build.mjs        the pipeline (see header comment for safety rules)
tools/dev/             sample generator + browser checks
.claude/agents/critic.md   the critic definition
```

Design decisions worth keeping:
- Neutral, untinted greys.
- Geist for text, Geist Mono for technical labels.
- Justified rows that never crop.
- Progressive enhancement: the page works without JS.
- No third-party requests.
- Private originals; published copies have metadata stripped.
