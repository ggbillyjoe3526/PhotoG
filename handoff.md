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

| Feature | Attempt | Score | Result | Commit reviewed |
|---|---|---|---|---|
| F1: build pipeline (`tools/build.mjs`, `site.json`) | 1 | **7.4** | Total rework, done | before `b04945e` |
| F1 | 2 | **8.7** | Refined: every finding addressed | `da882f4` |
| F1 | 3 | running | | `3fcdf92` |
| F2: page shell, gallery grid, theme | 1 | **8.5** | Refined | before `b04945e` |
| F2 | 2 | **9.2** | Refined: every finding addressed | `da882f4` |
| F2 | 3 | running | | `3fcdf92` |
| F3: full-screen viewer | 1 | **7.7** | Total rework, done (now `viewer.js`) | `37d4411` |
| F3 | 2 | running | | `7bc60c9` |
| Final build | n/a | n/a | Not started | n/a |

Each feature has 4 attempts at most. If a feature hasn't reached 9.5 after
attempt 4, keep the best-scoring commit.

## 4. Status by feature

### 4.1 F1: build pipeline (attempt 3 under review)

The attempt-2 fixes are in commit `3fcdf92`; its message lists them all.

Highlights:
- **Hidden files.** `_` hides a photo, except camera names such as `_DSC1234`.
  Hidden files and folders are listed.
- **Clashing names.** Two photos whose names match once the order number is
  removed stop the build.
- **Damaged files.** Damaged JPEGs are rejected with plain-language messages,
  while harmless libjpeg quirks are let through.
- **Privacy.** `site.json` `"show"` sets the location level (full, city,
  country or none) and the date level (day, month, year or none). The default
  is city and month.
- **Film scans.** `details.json` accepts per-field camera overrides, and
  `exif: false` keeps the typed values.
- **Rebuilds.** Fresh clones reuse existing images, and unchanged originals
  aren't re-read.
- **Images.** The width ladder is 320–3200, at 72 dpi with ColorSpace sRGB.
- **Link previews.** `og:image` is written only when `url` is set. Added
  JSON-LD and a landscape cover by default.
- **Tests.** Unit tests run with `npm test`.
- **Publishing.** `npm run package` copies the site to `dist/` with a
  `_headers` file, and the GitHub Pages workflow publishes only `index.html`
  and `assets/`.

### 4.2 F2: gallery page (attempt 3 under review)

- **One inlined script.** `assets/js/page.js` holds the theme toggle, the row
  engine, resizing and S/M/L. The build inlines it after the gallery, so
  everything works at first paint and nothing depends on another script.
  `main.js` and `layout.js` were removed.
- **Rows.** Neighbouring rows are penalised for uneven heights (JUMP 0.8). The
  minimum tile width scales with the size factor.
- **Thumbnails.** Capped at 2× density, and upgraded only within a screen of
  the viewport (IntersectionObserver).
- **One row definition.** `var ROW = {…}` in `page.js` is read by the build,
  which writes `--row-h` on the gallery and the `sizes` estimates.
- **Fixes.**
  - The size underline uses `text-decoration`, so it works on touch screens
    and in forced colours.
  - The contact-link arrow shows on touch screens.
  - Captions have right padding.
  - Theme switches happen instantly.
  - Titles underline on hover.
  - Size labels are "S: small thumbnails" and so on.

### 4.3 F3: viewer (attempt 2 under review)

The viewer was rewritten as `assets/js/viewer.js`, which starts itself from
`window.Portfolio`. Its CSS is the "viewer" section of `style.css`.

- **Layout.** The fit is computed from the dialog's own size. The bars float
  over the photo.
  - On short screens (≤500px tall) the controls overlay the photo and the
    details become a side column, `min(260px, 30vw)`.
  - Immersive mode enlarges the photo and hides the controls.
- **Close.** `history.scrollRestoration` is manual while the viewer is open,
  and `teardown` scrolls one frame later. Back→Forward races are aborted
  cleanly.
- **Zoom.** Click, double-tap, Z or the button shows the photo at full
  resolution, with pan by pointer, drag or arrow keys. Esc zooms out first.
  Pinch zoom sets `is-pinched`, which allows one-finger pan and asks for
  sharper files.
- **Loading.** The picture is attached only after its `sizes` is set. When
  moving to the next photo, the old picture is removed before the resize.
  While flicking through, there is a 200ms wait unless the photo is
  preloaded. Neighbours are preloaded only after a photo has been shown for
  300ms.
- **Checks.** `tools/dev/viewer-check.mjs` has 30 pass/fail assertions, all
  passing.

## 5. Next steps, in order

1. When the running reviews (F1 attempt 3, F2 attempt 3, F3 attempt 2)
   report, record the scores above. Refine anything below 9.5 and re-submit,
   up to 4 attempts.
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
| `download-check.mjs [--throttle]` | image requests per device and size; flags wasted, aborted or soft thumbnails |
| `row-sim.mjs` | row partition across widths for S/M/L (uses the real `partition()` from `page.js`) |
| `npm test` | unit tests for the build (`tools/build.test.mjs`) |

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
