# BHS Studio redesign: research and decisions (Oct 2026)

## What Brian asked for

1. The layout doesn't work. Base the new one on what the leading DAWs do and on
   what people who actually use them say.
2. There were no other instruments to pick from or add.
3. Song mode should let each part (hi-hat, snare, clap …) pick its own A/B/C/D
   per section, mute for some bars and come back, and be soloed or muted per
   section. The old version flipped everything to A, then everything to B.
4. The 808 keys and knobs weren't visible at the same time as the drums.
5. Record or loop at any time from what's playing, not only by uploading a file.
   The upload and its waveform weren't clear.
6. More drum kits, and other instruments on the top keyboard, not only the 808.
7. He likes how **Groovebox** works.

## What the research found

Reddit blocks automated reading, so these findings come from forums, review
sites and design critiques. Most of the threads are older, so treat the evidence
as directional.

**BandLab (web and mobile)**
- People praise how simple it is to get started. It eases a beginner in better
  than Audacity does.
- The complaints are about layout, not features. "There's nothing intuitive about
  layout. I felt completely lost." Effects pop-ups can trap you. Important buttons
  float off to the side or collapse when you scroll. Saving takes several steps.
- The mixer is limited: no aux sends or busses.
- The Drum Machine already uses patterns per kit (two to start, up to eight), but
  arranging them is a separate step.

**Cakewalk / Sonar**
- Reviewers call it powerful but say it's hard for beginners: "the complex user
  interface is difficult to navigate."
- People dislike its step sequencer and Matrix view. They're "weaker than they
  look": you can't record into the Matrix, and recorded MIDI only appears after
  you stop.

**FL Studio / Ableton (the step-sequencer and clip models)**
- People generally find FL's pattern-and-playlist approach the easiest for beats.
- A well-known trap: putting the kick, snare, hats and melody in one pattern is
  fast for sketching, but it "considerably limits arrangement options" because
  the whole groove has to play as one unit. You can't drop the hats for a
  breakdown without splitting it. **That's exactly the problem Brian hit.** The
  fix producers learn is one pattern per instrument.
- Ableton's Session view uses a grid with a clip per track and scenes across it.
  It's loved for jamming, though the two-view idea takes a moment to click.

**Groovebox-style apps** (Korg Gadget, GrooviXBeat, Ampify Groovebox)
- Workflow: make clips per track, group them into scenes, then chain the scenes
  into a song. This is the model Brian liked, and it matches the FL/Ableton
  lesson above.
- GrooviXBeat is a Gadget-style desktop groovebox that one developer built with
  Claude Code. It's the closest match found to "built by one guy". If Brian meant
  a different Groovebox, its layout ideas still line up.

**Takeaways for us**
1. One pattern set **per instrument**, not one for the whole kit.
2. A song made of sections, where each instrument picks its own pattern, can sit
   out bars, and can be soloed.
3. Keep everything you touch while playing on screen at once. No hunting, no
   pop-ups that trap you.
4. Saving should be one click. Plain words, few knobs.

## What changed

**Layout.** (Round 4 changed this: the page scrolls, panels never scroll
up/down inside themselves, and the song grid became a sideways timeline — see
"Round 4" below.)

- **Top bar:** Play/Stop (Space), ● Rec plus what to record, BPM, position, the
  *Loop parts* / *Play song* switch, Open, Save (also Ctrl+S), Export, MIDI and
  Claude.
- **Song grid:** one row per instrument and one block per section. Each block
  starts with that instrument's letter for the section (click to cycle
  A → B → C → D → silent), then **S** (solo for this section only), then one
  cell per bar. Click or drag across bars to mute them, or pick the A–D brush and
  paint. Sections can be resized, duplicated, moved, renamed, or played from.
- **Editor tab:**
  - Drum machine: every lane with its own A–D, its own sound, and a kit picker.
  - Piano roll for instruments: click to add a note, drag to lengthen, drag to
    move, click to delete. The 808 gets S buttons for slides.
  - Waveform view for audio clips, with the bars marked.
- **Mixer** and **Reverb & delay** tabs.
- **Dock** (always pinned at the bottom):
  - A keyboard or drum pads, plus the knobs for whatever it's playing.
  - **Play** picks any instrument track or the drum pads. **Sound** changes the
    instrument.
  - **Write notes** records what you play into the pattern while the song runs,
    snapped to the grid.

**Instruments:** 808, Grand Piano, Electric Piano, Organ, Bell, Strings, Brass,
Flute, Warm Pad, Synth Lead, Pluck and Synth Bass. They're all synthesised, so
nothing needs downloading.

**Drum kits:** Trap 808, Boom Bap, House 909, Lo-Fi Dusty, Live Kit, and Classic
(the original sounds, so old projects sound the same). Any lane can borrow a sound
from another kit. You can also add Tom and Rim lanes, or extra lanes of anything.

**Recording:** ● Rec records one of three things, snapped to bars, and each take
becomes an audio track with a waveform:
- *My playing*: the keys or pads only, without the beat.
- *Whole mix*: a bounce of everything. It starts switched off so it doesn't
  double up.
- *Microphone*: with a timing trim.

Uploads work the same way and are now saved with the project (before, they were
lost on reload).

**Export:** now runs through the mixer, so levels, pan, mute, solo and the reverb
and delay all apply. Before, it ignored them.

**Ask Claude:** speaks the new model. It can add instruments, write notes and drum
patterns, build sections with per-track letters, muted bars and solos, change
kits, and turn knobs. It uses Claude Opus 5.5 and falls back to another model
automatically if a request is declined.

**Old projects** open and convert automatically, keeping their patterns, 808
sound, mixer levels and loops.

## Verified

`tests/studio.test.js` runs 68 browser checks covering:
- The layout fits at 1440×900.
- Each part follows its own letter per section, with bar mutes and solos.
- Pattern lengths, kits and every instrument produce sound.
- The piano roll, Write notes, and taking a recording (length checked to the
  sample).
- Bounce, upload, export, save and open with audio, and converting an old
  project.
- Ask Claude's actions, and MIDI.
- Practice Mode still loads.

## Round 2 (same week)

- **Start screen** every time the Studio opens: Continue where you left off,
  six templates (Trap, Boom Bap, Lo-Fi, House, R&B, Blank) plus the demo beat,
  and your saved tracks. Also under Open → "New from a template…".
- **Undo / redo:** the ↶ ↷ buttons, Ctrl+Z, and Ctrl+Shift+Z. They cover
  patterns, sections, sounds, knobs, swing, key and pump. Mixer faders and
  what's playing live are left alone.
- **Autosave** in the browser, including recorded and uploaded audio, so a closed
  tab loses nothing. Save still puts the track on the server.
- **Drum brushes:** Hit, Accent, Soft (ghost note) and Roll ×2/×3/×4 for trap
  hi-hat rolls. **Swing** for the whole song sits in the drum machine.
- **Click (metronome).** Recording from a stop counts in one bar first, and the
  take starts exactly on the downbeat.
- **Key and chords** in the piano roll. Notes in the key are lit. With Chords on,
  one click places a three-note chord that fits the key.
- **Pump** slider on every mixer strip: the sidechain "breathing" effect, ducking
  that track on every kick. It's also in the export.
- Ask Claude can now set swing, key and pump, and write accents and rolls.

## Round 4 — "what is making the sound?"

Brian's feedback after using it: with a template playing he couldn't tell which
part was making the kick, didn't know how the piano roll opened, hated scrolling
inside the drum machine to reach the clap, wanted a right-scrolling timeline he
could copy/paste/move on like a video editor, a real manual, and auto-mastering
for depth. What changed:

- **Song timeline** replaces the song grid. Bars run left→right (scrolls
  sideways); each instrument is a row of blocks; a block's letter = the pattern
  it plays. Drag to move (Alt = copy), drag an edge to stretch, drag on empty
  space to draw, double-click to fill to the section end, Ctrl+C/V/D, Delete,
  a toolbar for the selected block (A–D, Edit, Copy, Paste, Duplicate, Solo in
  section, Delete). Bar numbers and section names play from there. Playhead.
- **What's sounding** is shown: each row has an LED that flashes when it plays,
  drum-lane names and pads flash too, blocks show a tiny preview of their notes.
- **"1 · WHEN" / "2 · WHAT"** labels on the two halves. The editor says
  "Editing [instrument ▾] — pattern X" with a picker, plus a plain-words box on
  how to use it. Clicking a block opens exactly the pattern that block plays.
- **No scrolling inside boxes.** Every drum lane, every timeline row and the full
  piano roll are visible; the page scrolls, the dock stays pinned.
- **Mastering styles:** Deep & warm (default: low-end weight, a little
  saturation, wider sides above 150 Hz, gentle glue), Loud, Clean, or off — then
  a lookahead limiter to −1 dBFS. "Hear it first" previews the mastered mix.
- **User manual** (`manual.html`, "? Manual" in the top bar, linked on the start
  screen): 18 sections, real screenshots with numbered red boxes and a key for
  each, how-to tables, shortcuts and troubleshooting. `tools/make-manual.js`
  re-shoots it so it never goes stale.

## Round 5 — "will it sound great for a beginner?"

Honest review after round 4: the layout was fine, the *sound* wasn't — every
piano, string and drum was synthesised. Built:

- **Recorded instruments and kits.** 18 real instruments and 34 drum/percussion
  hits from free libraries (Splendid Grand Piano, jRhodes3d, VCSL, Sonic Pi,
  tonejs-instruments), trimmed, pitch-checked and encoded by
  `tools/build-samples.js` (~11 MB). Lazy-loaded with a synth stand-in, cached
  offline. Templates rebuilt on them.
- **Per-hit and per-note volume and left/right** — a lane under the drum machine
  (selected lane) and under the piano roll. Brian asked for this for claps and
  hats, which don't change pitch but need dynamics.
- **Character** — one dropdown + Amount per track (Warm, Punchy, Bright, Big &
  heavy, Soft, Far away, Lo-fi, Radio, three vocal chains). EQ + compressor +
  saturation (+ de-esser for vocals) behind one knob; Amount 0 is untouched.
- **Vocals** — mic takes get "Vocal: clean & present" automatically; **Tune**
  (Natural / Hard) is offline PSOLA pitch correction to the song's key.
- **Guided tour** — "Make your first song", 15 steps that spotlight the real
  controls and advance when you do the thing.

## Still not built

- Time-stretching recorded loops when the BPM changes. A take keeps its original
  speed.
- A per-track filter sweep for builds.

## Sources

- BandLab mobile design critique — https://ixd.prattsi.org/2025/09/design-critique-bandlab-music-making-studio-mobile/
- BandLab user reviews — https://www.trustpilot.com/review/www.bandlab.com?page=4 · https://www.capterra.com/p/10004016/BandLab/reviews
- BandLab Drum Machine patterns — https://blog.bandlab.com/introduction-to-drum-machine-online-sequencer/
- Cakewalk/Sonar user threads — https://www.kvraudio.com/forum/viewtopic.php?p=8442825 · https://www.g2.com/products/cakewalk-by-bandlab/reviews · https://equipboard.com/items/sonar-artist
- FL Studio one-pattern-per-instrument lesson — https://www.elephorm.com/formation/maitriser-fl-studio-2026-les-fondamentaux/programmer-un-rythme-simple-dans-le-rack-de-canaux · https://flstudio.image-line.com/help/html/basics_workflow.htm
- FL vs Ableton for beginners — https://www.audeobox.com/learn/compare/fl-studio-vs-ableton/
- GrooviXBeat (Gadget-style, one developer) — https://forum.juce.com/t/would-like-to-share-my-open-source-free-groove-box-app-written-with-html-and-juce/68215 · https://github.com/groovixlabs/GroovixBeat
- Ampify Groovebox — https://cdm.link/groovebox-music-app-rigorously-designed-give-place-start/
