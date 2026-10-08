# Rhythm Shop

Two things, from one static Node server:

- **Practice Mode** (`practice.html`) — learn a real instrument. Pick flute or
  piano and a beginner song; each note lights up with its fingering (flute) or
  key (piano); play it into the microphone and it turns green when you hold it
  steady. Build and save your own songs. Flute matches on pitch class (any
  octave); piano matches octave-exact unless you relax it in Settings.
- **BHS Studio** (`studio.html`) — a one-screen groovebox/DAW. Every instrument is
  a track with four patterns (A–D); a **song grid** of sections says which pattern
  each track plays per section, which bars it sits out, and what's soloed there.
  Instruments: the 808 plus piano, electric piano, organ, strings, brass, flute,
  pads, leads, plucks, bells and synth bass; six drum kits. A keyboard/pad **dock**
  with the current sound's knobs stays pinned under everything. Record a take
  (what you play, the whole mix, or the mic) or upload audio — each becomes an
  audio track with a waveform. Mixer with shared reverb/delay, auto-master,
  offline `.wav` export, MIDI keyboards, and "Ask Claude" edits the song via tool
  use. Design and research notes: `docs/studio-redesign.md`.

(Freeplay and Round Robin, the original 32-step pattern games, were retired when
Practice Mode landed. Their one reusable idea — practising something in growing
chunks — lives on as Practice Mode's "in growing chunks" option.)

## Structure

```
public/
  index.html            mode picker
  practice.html          Practice Mode
  studio.html            BHS Studio
  css/   base.css (shared tokens) + practice.css + studio.css
  js/
    storage-client.js    save/load via /api/patterns, localStorage fallback
    practice/
      note-utils.js       note name / MIDI / frequency math (no DOM)
      pitch-detector.js   McLeod Pitch Method + mic source + hold gate (no DOM)
      songs.js            beginner presets + custom-song helpers
      instruments/
        mic-instrument.js base for any "listen for the note" instrument
        flute.js          octave-agnostic + fingering diagram
        piano.js          octave-exact + on-screen keyboard
        hand-piano.js     silent practice — webcam + MediaPipe, point at the lit key (beta)
        registry.js       the list Practice Mode picks from
      shell.js            song setup, note lane, match loop, settings
      assist.js           "ask a music question" panel (hidden unless the server has a key)
    engine/              the Studio's engine (no DOM except recorder-worklet's host)
      project-model.js    the song: tracks, A–D patterns, sections (cells per bar)
      sequencer.js        plays the project — live and for export (same code)
      instruments.js      melodic instruments (808 + synth recipes)
      drumkits.js         drum sounds, grouped into kits
      recorder.js         bar-quantised takes: keys / whole mix / mic
      transport, mixer, effects, master, midi, wav, synth-808, recorder-worklet
    studio-*.js          the Studio's UI: app (top bar), arrange (song grid),
                         editor (drums / piano roll / waveform), keys (the dock),
                         record, mixer, effects, midi, project, export, claude
server.js               static files + JSON APIs, no framework
studio-assist.js        Studio's Claude tool-use endpoint
```

**Adding an instrument to Practice Mode:** build a module like `flute.js`
(a frequency band + a `renderDiagram`), add its `<script>` to `practice.html`,
add one line to `registry.js`. `note-utils.js` and `pitch-detector.js` are
written standalone so the DAW can reuse them.

## Stack & storage

**Node, no framework.** Built-in `http` serves the static files and a small CRUD
API, so deploy is a single `node server.js`. The one npm dependency is
`@anthropic-ai/sdk` for the Studio's assist endpoint. Practice Mode's "watch my
hands" instrument lazily imports MediaPipe Tasks Vision from a CDN — only when
that instrument is picked; every other mode is dependency-free.

**Storage: one JSON file per mode on the volume**, `$DATA_DIR/<mode>.json` — a
small name→data map that reads and writes atomically. `practice` patterns store
`{ notes: ["E","D","C", …] }`. Studio projects are JSON + sidecar WAVs under
`$DATA_DIR/projects` and `$DATA_DIR/audio`.

## Running locally

```
npm install
node server.js          # http://localhost:8080 (or $PORT)
```

Practice Mode needs microphone permission and an `https://` origin (or
`localhost`). Chrome or Firefox recommended.

## Deploying on Railway

1. Push to the `Rhythm-Maker` repo.
2. Railway → New Project → Deploy from GitHub repo.
3. Attach a volume and set `DATA_DIR` to its mount path (e.g. `/data`) so saved
   songs and projects survive redeploys.
4. Set `ANTHROPIC_API_KEY` to enable the Studio's "Ask Claude". Optional
   `ANTHROPIC_MODEL` overrides the default.

`railway.json` declares the builder, start command and `/health` check.

## Tests

`tests/studio.test.js` drives the Studio in a real browser — song sections, bar
mutes and solos, kits, instruments, the dock, recording, uploads, export,
save/load (including old-format projects), Ask Claude's actions, MIDI — plus a
Practice Mode smoke check (`npm install --no-save playwright`, then run the
file — see its header).
The pure Practice Mode logic (pitch detection, note math, song parsing) has
no-browser checks that run under plain `node`.

## API surface

`:mode` is any `[a-z0-9_-]+` (`practice`, plus Studio's own).

- `GET  /health` → `{ status, dataDir }`
- `GET  /api/patterns/:mode` → `{ names }`
- `GET  /api/patterns/:mode/:name` → `{ name, data }`
- `POST /api/patterns/:mode/:name` with `{ data }` → save
- `DELETE /api/patterns/:mode/:name`
- `GET/POST/DELETE /api/projects…` — Studio projects + sidecar audio
- `GET  /api/practice-assist` → `{ available }` ; `POST` `{ question, context }` → `{ answer }`
- `POST /api/studio-assist` — Studio's Claude tool-use endpoint
