// sample-timeline.js — upload a clip, drop it on a bar, drag it, trim it.
//
// Everything else in the studio is a pattern (steps that repeat every bar).
// A sample clip isn't — it's a specific piece of real audio sitting at a
// specific bar, playing once. So this needs its own scheduler, not the
// per-step one the drums and bassline share.
//
// TIMING. The obvious way to place a clip is against Transport's own bar
// counter (ev.bar from onStep). That breaks the moment a pattern is looping
// every 1 bar while a clip needs to sit at bar 12 — Transport's bar count
// wraps with the pattern loop, so bar 12 never arrives. So this module keeps
// its OWN step counter, driven by the same onStep callbacks (for the same
// audio-clock accuracy) but counting independently of whatever the pattern
// loop is doing. It only advances while Transport is actually playing, so
// pausing and resuming picks up exactly where it left off — no special
// pause-vs-stop handling needed. If "loop timeline" is on, the counter wraps
// at the timeline's own length instead of Transport's.
//
// TRIM. AudioBufferSourceNode already supports start(when, offset, duration)
// — offset skips into the source, duration caps how much plays. Trimming a
// clip is just choosing those two numbers; no re-encoding, no copying audio.

const SampleTimeline = (() => {
  const TRACKS = 4;
  const TIMELINE_BARS = 32;

  let ctx = null;
  let ready = false;
  let loopTimeline = true;
  let stepCounter = 0;

  const library = [];       // { id, name, buffer, duration }
  const clips = [];         // { id, sampleId, track, startBar, lengthBars, offsetSec }
  let nextId = 1;

  const listeners = new Set();
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() {
    const snap = { library: library.map(s => ({ id: s.id, name: s.name, duration: s.duration })),
                    clips: clips.map(c => ({ ...c })), loopTimeline, playhead: stepCounter };
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }

  function init() {
    if (ready) return;
    ctx = Synth808.ensureContext();
    if (!ctx) return;
    ready = true;
    if (typeof Mixer !== 'undefined') {
      Mixer.init(ctx);
      for (let i = 0; i < TRACKS; i++) Mixer.addTrack('timeline:' + i, 'Sample ' + (i + 1), { volume: 0.85 });
    }
  }

  async function addSample(file) {
    init();
    if (!ctx) return null;
    const arr = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arr);
    const sample = { id: nextId++, name: file.name.replace(/\.[^.]+$/, ''), buffer, duration: buffer.duration };
    library.push(sample);
    emit();
    return sample;
  }

  function barsFor(sample, secPerBar) {
    return Math.max(1, Math.min(16, Math.ceil(sample.duration / secPerBar)));
  }

  function addClip(sampleId, track, startBar, secPerBar) {
    const sample = library.find(s => s.id === sampleId);
    if (!sample || track < 0 || track >= TRACKS) return null;
    const clip = {
      id: nextId++, sampleId, track,
      startBar: Math.max(0, startBar | 0),
      lengthBars: barsFor(sample, secPerBar),
      offsetSec: 0
    };
    clips.push(clip);
    emit();
    return clip;
  }

  function moveClip(id, track, startBar) {
    const c = clips.find(c => c.id === id);
    if (!c) return;
    c.track = Math.max(0, Math.min(TRACKS - 1, track | 0));
    c.startBar = Math.max(0, startBar | 0);
    emit();
  }

  function trimClip(id, lengthBars) {
    const c = clips.find(c => c.id === id);
    if (!c) return;
    c.lengthBars = Math.max(1, Math.min(32, lengthBars | 0));
    emit();
  }

  function removeClip(id) {
    const i = clips.findIndex(c => c.id === id);
    if (i >= 0) { clips.splice(i, 1); emit(); }
  }

  function setLoopTimeline(on) { loopTimeline = !!on; emit(); }

  // ── playback ──
  function onStep(ev) {
    const st = Transport.getState();
    const stepsPerBar = st.stepsPerBar;
    const totalSteps = TIMELINE_BARS * stepsPerBar;

    if (loopTimeline && stepCounter >= totalSteps) stepCounter = 0;

    const bar = Math.floor(stepCounter / stepsPerBar);
    const stepInBar = stepCounter % stepsPerBar;

    if (stepInBar === 0 && bar < TIMELINE_BARS) {
      clips.forEach(c => {
        if (c.startBar !== bar) return;
        const sample = library.find(s => s.id === c.sampleId);
        if (!sample) return;
        playClip(sample, c, ev.time, st.secondsPerStep * stepsPerBar);
      });
    }
    stepCounter++;
  }

  function playClip(sample, clip, when, secPerBar) {
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    const dest = (typeof Mixer !== 'undefined' && Mixer.get('timeline:' + clip.track))
      ? Mixer.input('timeline:' + clip.track)
      : ctx.destination;
    src.connect(dest);

    const duration = Math.min(clip.lengthBars * secPerBar, sample.duration - clip.offsetSec);
    if (duration <= 0) return;
    src.start(when, clip.offsetSec, duration);
  }

  function onVisualStep(ev) {
    // stepCounter has already advanced past this ev by the time it fires
    // visually (it's incremented in onStep, which runs ahead in the audio
    // schedule) — recompute the bar the same way for the playhead display.
  }

  function serialize() {
    return { clips: clips.map(c => ({ ...c })), loopTimeline,
             sampleNames: library.map(s => ({ id: s.id, name: s.name })) };
  }
  // Uploaded audio is not persisted — only clip placement and sample names.
  // Reloading a saved project restores the timeline layout but the samples
  // themselves need to be re-added to the library and re-matched by name.
  function restore(data) {
    if (!data) return;
    clips.length = 0;
    (data.clips || []).forEach(c => clips.push({ ...c }));
    loopTimeline = data.loopTimeline !== false;
    emit();
  }

  function relinkSample(oldSampleId, newSampleId) {
    clips.forEach(c => { if (c.sampleId === oldSampleId) c.sampleId = newSampleId; });
    emit();
  }

  return {
    TRACKS, TIMELINE_BARS, init, isReady: () => ready,
    addSample, addClip, moveClip, trimClip, removeClip, setLoopTimeline,
    onStep, onVisualStep, onChange, serialize, restore, relinkSample,
    getLibrary: () => library.slice(), getClips: () => clips.slice(),
    barsFor
  };
})();
