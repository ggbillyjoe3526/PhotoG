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
| F1 | 3 | **8.9** | Refined (every finding addressed) |
| F1 | 4 (final) | see below | |
| F2: page shell, gallery grid, theme | 1 | **8.5** | Refined |
| F2 | 2 | **9.2** | Refined |
| F2 | 3 | **9.3** | Refined (every finding addressed) |
| F2 | 4 (final) | see below | |
| F3: full-screen viewer | 1 | **7.7** | Total rework (now `viewer.js`) |
| F3 | 2 | **8.9** | Refined: a new touch layer |
| F3 | 3 | see below | |
| Final build | n/a | not started | |

Each feature has 4 attempts at most. If a feature hasn't reached 9.5 by its
4th attempt, keep the best-scoring commit; this file's git history records
which commit each attempt reviewed. Full reports were written to the session
scratchpad (`critic/<feature>-a<attempt>/report.md`).

## 4. Status by feature

### 4.1 F1: build pipeline

- **Decoding.** Each photo is decoded once while collecting decoder warnings.
  A short list of harmless quirks becomes a note: stray bytes, odd SOS
  parameters, an unknown JFIF revision. Anything else, or a warning count
  above what's shown, stops that photo.
- **Order of writes.** `details.json` and `index.html` are written before any
  generated file is deleted. Renames are retried on EPERM/EBUSY.
- **`site.json` checks.**
  - Wrong types and unknown settings produce notes.
  - Notes appear when About or Contact would be empty.
  - Page names are stripped from `url`.
  - Optional `licensing` (license URL and licensing page) feeds JSON-LD
    ImageObjects, written only when `url` is set.
  - `og:site_name` and `og:locale` are written.
- **Typed camera values** are normalised: "35" becomes 35mm, "5.6" f/5.6,
  "125" 1/125s and "400" ISO 400.
- **Camera names.** The DCF rule (`_IGP0042`, `_1000123`) means these are
  never hidden.
- **Tints** are taken from the smallest published JPEG, so every machine
  produces the same colour.
- **Sizes for the first two photos** come from running the real `partition()`
  across screen widths, sampled densely, plus 2× variants for 3× screens. The
  other photos are lazy and get exact sizes from `page.js`.
- **AVIF and limits.** Quality is q64 for widths of 1600 and up, and a 2000
  width was added. The pixel limit is raised to 1 GP, and `.jfif` is accepted.
- **Error messages** are in plain language, including JSON errors with the
  line, column and probable cause.
- **Tests.** `tools/build.test.mjs` holds the unit tests and
  `tools/build.integration.test.mjs` runs the real build in a temporary copy
  (via `PHOTOG_ROOT`). `npm test` runs 20 tests.
- **Publishing.** `tools/check-site.mjs` checks that every referenced file
  exists. The Pages workflow runs `npm ci`, `npm test` and that check before
  publishing.

### 4.2 F2: gallery page

- **`page.js`** is inlined after the gallery and holds the theme, the row
  engine, resizing and S/M/L. `main.js` and `layout.js` no longer exist.
- **Row engine:**
  - Neighbouring rows of uneven height cost more.
  - The last row can be justified or left part-filled at the height of the
    row above, whichever is cheaper. It pays for being unfilled or holding a
    single photo, and pays extra for being taller than the row above.
  - At M and L, rows are capped to the screen height.
- **Thumbnails.** Capped at 2× density, and upgraded only near the viewport.
  The first photos' `sizes` are frozen once loaded, so rotation doesn't
  re-fetch them.
- **Fixes:**
  - The arrow is visible in forced colours.
  - Hover feedback (a hairline frame and an underlined title) only on devices
    that hover.
  - One breakpoint, 599px.
  - The brand links to `#top`.
  - The toggle's title matches its label.

### 4.3 F3: viewer (`assets/js/viewer.js`)

- **Layout.** The fit is computed from the dialog's own size and the bars
  float. Short screens get overlay controls with small translucent backings
  and the details in a side column.
- **Touch layer**, listening on the whole dialog with `touch-action: none`:
  - A tap toggles the controls and never closes the viewer.
  - Double-tap zooms, with no flicker.
  - Pinch zoom is the viewer's own.
  - A sideways swipe slides the neighbouring photo in alongside.
  - A swipe down fades the background, using the `::before` layer and
    `--fade`.
- **Gutter.** The page drops its scrollbar gutter while the viewer is open,
  with the gallery's width frozen, so the viewer gets the whole window.
- **Checks.** `tools/dev/viewer-check.mjs` has about 40 assertions, all
  passing.

## 5. Next steps, in order

1. Record the results of F1 attempt 4, F2 attempt 4 and F3 attempt 3. F1 and
   F2 are then finished: keep their best-scoring commits. F3 has one attempt
   left.
2. Final-build review of the whole site, then update `README.md` and this
   file.

## 6. Working on this repo

```bash
npm install                                   # sharp + exifr
python3 -m pip install Pillow numpy           # only for the sample generator
python3 tools/dev/gen_samples.py photos       # recreate the 17 placeholder originals (git-ignored)
npm run build                                 # photos/ -> assets/gallery/ + index.html (~2 min cold, AVIF)
npx http-server -p 8123 -c-1 -s . &           # serve
```

**Dev checks** live in `tools/dev/`. They use Playwright with Chromium at
`/opt/pw-browsers/chromium`. For ESM imports, symlink the global `playwright`
into a local `node_modules`, or `npm i -D playwright`.

| Script | What it checks |
|---|---|
| `run-critic.sh <prompt> <report>` | runs the critic (Opus 5.5, xhigh) |
| `screenshots.mjs <url> <outDir>` | main states incl. S/M/L, no-JS, 2560px; logs CLS and console errors |
| `viewer-check.mjs` | 30 pass/fail viewer assertions (close paths, rotation, landscape phone, zoom, races, touch, reduced motion) |
| `anchor-check.mjs` | S/M/L keeps the centred photo in place |
| `download-check.mjs [url] [--throttle]` | image requests per device and size, including a rotation step; flags wasted, aborted, soft or oversized files |
| `row-sim.mjs` | row partition across widths for S/M/L (uses the real `partition()` from `page.js`) |
| `npm test` | 20 unit and integration tests for the build |

**Build edge cases to re-test after F1 changes:**
- A Lightroom XMP file containing `&amp;` and `&#xA;`.
- A PNG with alpha.
- `DSC_1234.jpg`.
- A `.HEIC` file.
- A truncated JPEG: expect exit 1 and nothing changed.
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
.github/workflows/pages.yml  publishes only index.html + assets/ to GitHub Pages
assets/gallery/        generated AVIF+JPEG: <slug>-<hash(source+settings)>-<width>.<ext>
assets/fonts/          Geist + Geist Mono (OFL)
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
