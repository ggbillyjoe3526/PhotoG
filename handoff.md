# Handoff: photography portfolio

Notes for the next working session. Read this first, then `README.md` (the
owner-facing guide).

**Branch:** `claude/peaceful-babbage-rt4xuu` · **Last updated:** 2026-10-03

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
- In a **new** session this loads as the `critic` agent type: use
  `Agent(subagent_type: "critic")`. It did not load mid-session the first time,
  so this session used `general-purpose` + `model: opus` (which inherited the
  session's `xhigh` effort), with a prompt telling it to read `critic.md` first.
- Give each critic a **frozen snapshot** of the repo, not the live tree. Copy
  it to a scratch folder with `tar --exclude=.git -cf - . | tar -xf - -C <dir>`
  and give the critic its own port. This lets you keep working while it
  reviews.
- When re-reviewing, pass the previous findings so the critic can verify them,
  but ask for an independent score.

## 3. Review scoreboard

| Feature | Attempt | Score | Result | Commit reviewed |
|---|---|---|---|---|
| F1: photo build pipeline (`tools/build.mjs`) | 1 | **7.4** | Total rework, done (see 4.1) | before `b04945e` |
| F1 | 2 | n/a | Reworked version **not scored**: review stopped at the owner's wrap-up | `b04945e` |
| F2: page shell, gallery grid, theme | 1 | **8.5** | Refine; partly done (see 4.2) | before `b04945e` |
| F3: full-screen viewer | 1 | n/a | Review stopped at the owner's wrap-up | `c955253` |
| Final build | n/a | n/a | Not started | n/a |

## 4. Status by feature

### 4.1 F1: photo build pipeline (reworked, awaiting re-review)

Every attempt-1 finding was addressed in the rework, and each fix was checked
against the edge cases in section 6.

**Blocking findings fixed:**
- XMP entities are decoded.
- Originals are git-ignored. The build cache moved to `photos/.build-cache.json`.
- Output goes to `assets/gallery/`, and only files the build generated are ever
  deleted.
- `details.json` is keyed by slug, so renaming a photo keeps its text and
  reuses its encodes.
- `"-"` or `false` hides a field.
- `failOn: 'truncated'`.
- Any failure, or an empty `photos/` folder, publishes nothing.

**Refinements done:**
- Camera-default names (DSC_1234) don't become titles, and a list of photos
  with weak alt text is printed.
- Order prefixes (1–3 digits) and date prefixes are stripped. Slugs support
  Unicode.
- Width ladder is 480/800/1200/1600/2400/3200, capped at 3200 px on the long
  edge, with near-duplicate widths skipped.
- The encode settings hash is part of every file name.
- Unsupported formats (RAW, HEIC) trigger a warning.
- Transparency is flattened to white. An sRGB ICC profile is embedded.
- Each original is decoded once into an sRGB master, and files are written
  atomically.
- Rational and ISO values are normalised, and XMP-only dates are handled.
- `_cover` picks the share image. A warning shows when `og:url` is missing.
- `details.json` shows every field, drops blank orphan entries, warns about
  unknown keys and tolerates trailing commas.
- `--help`, `engines >=20.9`, `photos/README.txt`.

**Next:** run F1 attempt 2 on the current tree.

### 4.2 F2: gallery page (8.5, refinement half done)

Findings from attempt 1 and where each stands:

**Blocking:**
1. ✅ **Thumbnails downloaded twice.** Fixed in `c955253`. `sizes="auto"` was
   removed, the static guess was improved, and JS now changes `sizes` only
   after an image has loaded, and only upward. `tools/dev/download-check.mjs`
   shows 17 requests and zero duplicates at 1280@1x, 1440@2x and 390@3x.
   - The critic's stronger suggestion is still open: inline the layout after
     `</ol>` so rows are final before first paint. That would remove the
     `opacity:0` gate and stop LCP waiting on `main.js`. Drafted as
     `assets/js/layout.js` (see "Next steps").
2. ❌ **Frame numbers fail contrast.** `.tile-no` uses `--fg-faint` (2.28:1).
   Use `--fg-muted` instead.
3. ❌ **S/M/L doesn't visibly change the first screen** on desktop. The new
   costs and targets in `layout.js` fix it, as simulated with
   `tools/dev/row-sim.mjs`.
4. ❌ **"Back to top" doesn't reach the top.** Move `id="top"` from `<main>` to
   `<body>`.

**Refinements (all still open):**
- Bigger thumbnails on tablet and phone (the new targets in `layout.js`).
- One caption rule per breakpoint: numbers only below 600px, number + title
  above. Drop the container query.
- The section head shifts 4px when the size control appears. Reserve its space
  with `visibility` instead of `hidden`. Same for the theme toggle.
- Preload Geist Mono.
- Size-change scroll anchor: use the tile at the viewport centre.
- Theme: clear the stored choice when the system starts to match it. Reveal the
  toggle only once `main.js` runs.
- 44px touch targets under `(pointer: coarse)`.
- Semantics:
  - The brand name should be the h1, and "Selected work" an h2.
  - `aria-hidden` on `.section-no`.
  - Put the title in each tile link's accessible name.
- The skip link overlaps the name; centre it.
- Max page width of about 2200px for ultra-wide screens. Planned as
  `--page-gutter: max(var(--gutter), calc((100vw - 2200px)/2))`.
- Favicon: add a backing tile and a 180×180 `apple-touch-icon`.
- About and Contact: align the label baseline with the first line of text
  (`align-items: baseline`) and drop the negative margin on `.lede`.
- Owner setup: the name appears about 9 times. Plan: a `site.json` (name,
  tagline, description, url, about text and facts, email, links) rendered into
  new `<!-- build:… -->` regions.

**Keep, per the critic:**
- The justified-row engine and the CSS-only fallback.
- CLS of 0.
- Theming: no flash on load, `theme-color` stays in sync.
- Geist / Geist Mono, numbered sections, hairlines.
- The contact block and the focus rings.

### 4.3 F3: viewer (built and self-tested, not yet reviewed)

The viewer is `initViewer()` in `assets/js/main.js` plus the "viewer" section
of `style.css`.

**What it does:**
- `<dialog>` with zoom from the thumbnail on open and back to it on close
  (WAAPI, turned off for reduced motion).
- Instant low-res preview, then the full-resolution image fades in; a loading
  bar appears after 450ms.
- Preloads the previous and next photos.
- Navigation: ←/→, Home/End, **I** toggles details, Esc. Swipe sideways to
  change photo, swipe down to close, tap to hide the controls. Pinch zoom
  works.
- Deep links `#photo-<slug>`. The browser's Back button closes the viewer.
- Focus returns to the tile on close. Live region announcements.
- `aria-disabled` at the ends, so focused buttons keep focus.
- Safety net for Chrome closing the dialog without a cancel event.

**Self-tested with** `tools/dev/viewer-check.mjs`: all pass.

**Next:** F3 attempt 1 review.

## 5. Next steps, in order

1. **Wire in `assets/js/layout.js`.**
   - In `tools/build.mjs` `renderGallery()`, inline the file as a `<script>`
     right after `</ol>`.
   - In `main.js`, delete `partition`, `baseRowHeight`, `candidateWidth`,
     `updateSizes` and the fade-in, and call `window.PhotoLayout.layout(gallery,
     size, false)` on resize and size change.
   - Delete the `html.js .gallery:not(.is-justified)` opacity gate in CSS.
   - Update the build's `sizes` guess and the CSS `--row-h` fallback to the new
     base: `clamp(220px, calc(200px + 9vw), 440px)` × 1.1.
   - Re-run `tools/dev/download-check.mjs` and `row-sim.mjs`.
2. Finish the remaining F2 items in 4.2, including `site.json`. Then run the F2
   attempt 2 review.
3. Run F1 attempt 2 and F3 attempt 1, and fix what they find.
4. Final-build review of the whole site, then update `README.md`. If
   `site.json` lands, rewrite README section 3, which currently says "edit
   index.html, search for EDIT:".
5. Optional, raised during reviews but not requested: a 1:1 zoom in the viewer
   for inspecting detail.

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
| `screenshots.mjs <url> <outDir>` | desktop/phone, light/dark, viewer |
| `viewer-check.mjs` | keyboard, history, deep links, swipe, tap |
| `download-check.mjs` | image requests per device; flags duplicate or aborted downloads |
| `row-sim.mjs` | row partition across widths for S/M/L |

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

## 7. Architecture at a glance

```
index.html             page; <!-- build:og|stats|gallery --> regions are generated
assets/css/style.css   tokens (light/dark) at top; gallery; about/contact; viewer
assets/js/main.js      theme toggle, gallery layout (current), S/M/L, viewer
assets/js/layout.js    NEW row engine, not wired in yet (see section 5, step 1)
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
