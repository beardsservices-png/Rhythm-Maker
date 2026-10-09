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
- **Layout rule:** the dock (keyboard + current sound's knobs) stays pinned at the
  bottom. **No panel scrolls up/down inside itself** — every drum lane and every
  timeline row is always visible; the *page* scrolls instead. The song timeline
  scrolls sideways only. Brian hated hunting inside boxes; don't regress it.
- **Timeline** (`studio-arrange.js`) is drawn from `Project.runs()` — the blocks
  are just runs of equal cells, and edits go through `Project.setCells()` (which
  grows the song). Clicking a block selects that track AND that pattern letter.
- **What's sounding:** the sequencer calls `onHit(trackId)` on every hit; the
  timeline LED, the drum-lane names and the pads light from `Sequencer.onHit`.
- **Recorded instruments** (`engine/samples.js`, files in `public/samples/`, map in
  the GENERATED `sample-manifest.js`): presets with `sampled: true` in
  `instruments.js` and kits with `recorded: true` in `drumkits.js`. Lazy-loaded;
  until a file arrives the synth `fallback` plays. Export awaits
  `Samples.preloadFor()`. To change the set, edit and run `tools/build-samples.js`
  (pitch-checks every file; some libraries name octaves differently) and bump the
  cache name in `sw.js` (samples are cache-first). Credits/licences are in the
  manifest and the manual — the Rhodes and upright bass are BY-NC samples (music
  made with them is free); swap them if the app is ever sold.
- **Per-hit / per-note mix:** a drum step may be `{c, v, p}` (code, volume, pan) —
  set via `Project.setStepMix`, notes carry `vel`/`pan` via `Project.setNoteMix`.
  The sequencer puts a StereoPanner per hit only when pan ≠ 0.
- **Character** (`engine/character.js`): `track.character = {id, amount}`; the mixer
  strip inserts the chain between duck and fader, export builds the same chain.
  Amount 0 must stay transparent.
- **Tune** (`engine/tune.js`, glue in `studio-voice.js`): `track.tune` on audio
  tracks; the tuned copy lives in memory only (`Project.playbackAudio`), rebuilt
  from the untouched original when tune/key/audio change.
- **Tour** (`studio-tour.js`): steps point at real elements by selector and advance
  on Project/App/Transport events — if you rename an id or class it uses, update it.
- **Mastering** (`engine/master.js`): styles clean / deep (default) / loud, then a
  lookahead limiter to −1 dBFS. Export has a "Hear it first" preview.
- **User manual** `public/manual.html`; its pictures and callout boxes come from
  `tools/make-manual.js` (run it after any visible UI change, with the server up).
- **Retired:** Freeplay, Round Robin, and the old Studio page (scenes, per-slot
  looper, sample timeline). `audio-engine.js` is gone. Old saved projects still
  load — `Project.restore()` converts them.

## Verify changes

```
npm install && node server.js          # then open the three pages
node tests/studio.test.js               # needs: npm install --no-save playwright
node tools/make-manual.js               # re-shoot the manual's screenshots
```

Practice Mode's live mic path can't be automated (Chrome fake-audio doesn't flow
through Web Audio) — check it by ear with a real instrument or a whistle.
