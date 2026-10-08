# Rhythm Shop — notes for Claude

## Shared context (all Claude surfaces)
@../ai-context/profile.md
@../ai-context/areas/rhythm-shop.md

Pull the `ai-context` repo (github.com/beardsservices-png/ai-context) before
trusting these if it's been more than a day. If it isn't cloned as a sibling of
this repo, adjust the paths above. Ground rule: that repo is public — never put
customer names, family details, or financials in it.

## This repo

Static site + zero-framework Node server, deployed on Railway with a mounted
volume at `$DATA_DIR`. Two surfaces: **Practice Mode** (`public/practice.html`)
and **BHS Studio** (`public/studio.html`). See `README.md` for the file map.

- **No build step.** Plain HTML/CSS/JS in `public/`, `<script>` tags in source
  order, IIFE modules that hang one global each. Match that style. The one
  exception: `hand-piano.js` does a dynamic `import()` of MediaPipe from a CDN,
  lazily, only when that instrument is picked.
- **Practice Mode** is built to grow: `public/js/practice/note-utils.js` and
  `pitch-detector.js` are DOM-free and meant to be reused by the Studio/DAW
  later. Add an instrument = new module in `instruments/` + one line in
  `registry.js` + a `<script>` in `practice.html`.
- **Design tokens** live in `public/css/base.css` (dark ground, amber accent,
  Courier body, Georgia headings). Stay within them.
- **Flute fingering data** (`instruments/flute.js`) was lifted from a prototype
  and is NOT verified against a specific method book. It's a teaching aid only —
  the mic scores the sound, not the picture. Treat corrections as a data edit to
  `FINGERING_CHARTS`.
- **Studio model** (`public/js/engine/project-model.js`): tracks → four patterns
  (A–D) → sections whose `cells[trackId][bar]` hold a pattern index or OFF (-1),
  plus per-section `solo`. Every drum sound is its own track. One sequencer
  (`engine/sequencer.js`) plays it live AND renders the export — keep it that way
  so the download always matches what you hear. Add an instrument = a recipe in
  `engine/instruments.js`; a kit = an entry in `engine/drumkits.js`.
- **Drum step values:** `false` off, `true` normal (old projects), or a number —
  ones digit = level (1 soft, 2 normal, 3 accent), tens digit = roll (2/3/4).
  Always read them through `Project.stepInfo()`. Swing, key and per-track `pump`
  live on the project; undo snapshots exclude live letters and play mode.
- **Layout rule:** the dock (keyboard + current sound's knobs) stays pinned and the
  page itself doesn't scroll on a laptop — the song grid and editor scroll inside
  their panels. That was the main complaint about the old page; don't regress it.
- **Retired:** Freeplay, Round Robin, and the old Studio page (scenes, per-slot
  looper, sample timeline). `audio-engine.js` is gone. Old saved projects still
  load — `Project.restore()` converts them.

## Verify changes

```
npm install && node server.js          # then open the three pages
node tests/studio.test.js               # needs: npm install --no-save playwright
```

Practice Mode's live mic path can't be automated (Chrome fake-audio doesn't flow
through Web Audio) — check it by ear with a real instrument or a whistle.
