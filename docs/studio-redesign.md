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

**One-screen layout** (on a laptop the page itself never scrolls):

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

## Next, if wanted

- A start screen like Groovebox's: recent tracks, plus "new from template"
  (trap, boom bap, lo-fi).
- Time-stretching recorded loops when the BPM changes. Right now a take keeps its
  original speed.
- Swing/shuffle per track, and velocity per drum step.

## Sources

- BandLab mobile design critique — https://ixd.prattsi.org/2025/09/design-critique-bandlab-music-making-studio-mobile/
- BandLab user reviews — https://www.trustpilot.com/review/www.bandlab.com?page=4 · https://www.capterra.com/p/10004016/BandLab/reviews
- BandLab Drum Machine patterns — https://blog.bandlab.com/introduction-to-drum-machine-online-sequencer/
- Cakewalk/Sonar user threads — https://www.kvraudio.com/forum/viewtopic.php?p=8442825 · https://www.g2.com/products/cakewalk-by-bandlab/reviews · https://equipboard.com/items/sonar-artist
- FL Studio one-pattern-per-instrument lesson — https://www.elephorm.com/formation/maitriser-fl-studio-2026-les-fondamentaux/programmer-un-rythme-simple-dans-le-rack-de-canaux · https://flstudio.image-line.com/help/html/basics_workflow.htm
- FL vs Ableton for beginners — https://www.audeobox.com/learn/compare/fl-studio-vs-ableton/
- GrooviXBeat (Gadget-style, one developer) — https://forum.juce.com/t/would-like-to-share-my-open-source-free-groove-box-app-written-with-html-and-juce/68215 · https://github.com/groovixlabs/GroovixBeat
- Ampify Groovebox — https://cdm.link/groovebox-music-app-rigorously-designed-give-place-start/
