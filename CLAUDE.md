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
- **Retired:** Freeplay and Round Robin. Don't resurrect them; `audio-engine.js`
  stays only because the Studio uses it.

## Verify changes

```
npm install && node server.js          # then open the three pages
node tests/midi.test.js                 # needs: npm install playwright
```

Practice Mode's live mic path can't be automated (Chrome fake-audio doesn't flow
through Web Audio) — check it by ear with a real instrument or a whistle.
