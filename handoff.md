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
| F1 | 2 | running | | `da882f4` |
| F2: page shell, gallery grid, theme | 1 | **8.5** | Refined, all findings addressed | before `b04945e` |
| F2 | 2 | running | | `da882f4` |
| F3: full-screen viewer | 1 | running | | `37d4411` (viewer code unchanged since) |
| Final build | n/a | n/a | Not started | n/a |

Critic reports are written to the session scratchpad. Copy the scores into
this table when they arrive.

## 4. Status by feature

### 4.1 F1: build pipeline

All attempt-1 findings were fixed in the rework, which is described in commit
`b04945e`. In `da882f4` the build also gained:
- **`site.json`.** The owner's name, tagline, description, url, about (lede,
  text, facts) and contact (intro, email, links) live here. The build
  validates the file, escapes everything, rejects non-http(s) links and bad
  emails with a note, warns about placeholder text, and renders the
  `build:meta|brand|about|contact|footer` regions.
- **Inlining.** `assets/js/layout.js` is inlined after the gallery as a
  `<script>`, with `</script` escaped.
- **New `sizes` estimate.** `min(100vw, calc(ar*1.1 * clamp(220px, calc(200px
  + 9vw), 440px)))`. It is only used by the 4 eager photos and when JS is off.
- **Captions describe links.** Each tile link gets `aria-describedby`
  pointing at its visible caption.

### 4.2 F2: gallery page (all attempt-1 findings addressed in `da882f4`)

- **Row layout is inlined.** It runs before first paint, so there's no opacity
  gate. Lazy images that haven't chosen a file get exact `sizes`. Eager images
  keep the HTML estimate, because the preload scanner may already have fetched
  them. After loading, a photo is only ever upgraded, never downloaded smaller.
  `tools/dev/download-check.mjs` reports no waste on desktop, tablet or phone,
  in S, M and L, throttled or not. A saved L preference upgrades eager photos
  once, which is by design.
- **Rows re-tuned.** The base row height is `clamp(220, 200 + 0.09w, 440)`.
  The size factors are S 0.6 (0.45 on phones), M 1 and L 1.75. Costs penalise
  rows below 0.8× or above 1.3× the target, and slivers under 64/80px.
- **Contrast.** Frame numbers use `--fg-muted` and titles `--fg`. Phones show
  numbers only, except at L.
- **Navigation.** `id="top"` is on `<body>`. Size changes keep the photo
  nearest the screen centre in place, to within 1px.
- **Semantics.** The brand is the h1 and "Selected work" an h2. Section numbers
  are `aria-hidden`.
- **Controls appear without shifting.** They are revealed with `.is-ready`,
  using visibility, so there's no shift and no dead controls if `main.js`
  fails.
- **Theme.** The saved choice is cleared when the system changes to match it.
- **Touch, layout and type.** 44px touch targets under `pointer: coarse`.
  2200px max width via `--page-gutter`. Labels scale up to 13px. Rows at S sit
  closer together.
- **About and Contact.** Labels are baseline-aligned with the first line of
  text.
- **Fonts and icons.** Geist Mono is preloaded. The favicon has a dark tile,
  and there's a 180px `apple-touch-icon`.

### 4.3 F3: viewer (built and self-tested, review running)

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

**Self-tested with** `tools/dev/viewer-check.mjs`: all pass.

## 5. Next steps, in order

1. Read the three running critic reports (F1 attempt 2, F2 attempt 2, F3
   attempt 1). Each one either reaches 9.5 or goes back for rework, up to 4
   attempts. Keep the best-scoring version of each.
2. Final-build review of the whole site, then update `README.md` and this
   file.
3. Optional, raised during reviews but not requested: a 1:1 zoom in the viewer
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
| `run-critic.sh <prompt> <report>` | runs the critic (Opus 5.5, xhigh) |
| `screenshots.mjs <url> <outDir>` | main states incl. S/M/L, no-JS, 2560px; logs CLS and console errors |
| `viewer-check.mjs` | keyboard, history, deep links, swipe, tap |
| `download-check.mjs [--throttle]` | image requests per device and size; flags wasted, aborted or soft thumbnails |
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
site.json              owner details -> build:meta|brand|about|contact|footer
assets/js/layout.js    row engine; inlined after the gallery by the build
assets/js/main.js      theme toggle, resize + S/M/L (via window.PhotoLayout), viewer
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
