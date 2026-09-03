// mic-instrument.js — shared base for any instrument whose "is the target note
// playing?" question is answered by listening. Flute and piano both build on
// this; a future recorder / trumpet / voice module only needs a frequency band
// and a diagram renderer.
//
// The instrument config supplies:
//   id, label, sensors
//   band: { minFreq, maxFreq }   detection range in Hz
//   fftSize                      analysis window (bigger = better low notes, more CPU)
//   octaveExact                  true = the played octave must match the diagram
//   defaultOctave                octave to assume for octave-free song tokens
//   renderDiagram(el, note, ctx) draw the fingering / keyboard picture
//   renderSettings(el)           optional extra settings rows

function createMicInstrument(config) {
  // One handler each (last wins) — modules are singletons reused across
  // instrument switches, so replacing avoids stacking stale callbacks.
  const cb = { match: null, frame: null };
  const emit = (name, arg) => { if (cb[name]) { try { cb[name](arg); } catch (e) { console.error(e); } } };

  let target = null;      // NoteUtils note object, octave filled in
  let mic = null;
  const smoother = PitchDetector.createSmoother(5);
  const hold = PitchDetector.createHoldGate({ holdMs: 450, graceMs: 150 });

  const opts = {
    a4: NoteUtils.DEFAULT_A4,
    toleranceCents: 55,       // beginners play pitchy — reward the right note
    clarityFloor: 0.86,       // MPM clarity below this = "not a clear note"
    octaveLock: config.octaveExact,   // piano can turn this off in settings
    holdMs: 450,
  };

  function setOptions(patch) {
    Object.assign(opts, patch || {});
    opts.a4 = NoteUtils.clampA4(opts.a4);
    hold.setHoldMs(opts.holdMs);
  }

  function resolve(note) {
    if (!note) return null;
    return note.octave != null ? note : Object.assign({}, note, { octave: config.defaultOctave });
  }

  function setTarget(note) {
    target = resolve(note);
    hold.reset();
    smoother.reset();
  }

  function onBuffer(buf, sampleRate, now) {
    const minLag = sampleRate / config.band.maxFreq;
    const maxLag = sampleRate / config.band.minFreq;
    const { freq, clarity, rms } = PitchDetector.detectPitch(buf, sampleRate, minLag, maxLag);

    const level01 = Math.min(1, rms / 0.14);
    const inBand = freq >= config.band.minFreq * 0.9 && freq <= config.band.maxFreq * 1.06;
    const clear = freq > 0 && clarity >= opts.clarityFloor && inBand;

    let heardFreq = 0;
    if (clear) heardFreq = smoother.push(freq);
    else smoother.reset();

    const octaveExact = config.octaveExact && opts.octaveLock;
    let matching = false, cents = 0, heardDisplay = '';

    if (heardFreq > 0) {
      const n = NoteUtils.freqToNote(heardFreq, opts.a4);
      heardDisplay = NoteUtils.DISPLAY_NAMES[n.pc];
      if (target) {
        cents = NoteUtils.centsOff(heardFreq, target, {
          octaveExact, a4: opts.a4, fallbackOctave: config.defaultOctave,
        });
        matching = Math.abs(cents) <= opts.toleranceCents;
      }
    }

    const gate = hold.update(matching, now);
    emit('frame', {
      hasTarget: !!target,
      level01,
      clarity,
      heardFreq,
      heardDisplay,
      cents,            // signed cents from target; clamp for display
      matching,
      progress01: gate.progress,
    });
    if (gate.justCompleted) emit('match', {});
  }

  async function start() {
    if (mic && mic.isRunning()) return { ok: true };
    mic = PitchDetector.createMicSource({ fftSize: config.fftSize || 2048, onBuffer });
    return mic.start();
  }

  function stop() {
    if (mic) mic.stop();
    mic = null;
    hold.reset();
    smoother.reset();
  }

  return {
    id: config.id,
    label: config.label,
    sensors: config.sensors || ['mic'],
    octaveExact: !!config.octaveExact,
    defaultOctave: config.defaultOctave,
    supportsOctaveLock: !!config.octaveExact,

    start, stop, setTarget, setOptions,
    resetHold: () => hold.reset(),
    onMatch: (fn) => { cb.match = fn; },
    onFrame: (fn) => { cb.frame = fn; },

    renderDiagram: (el, note, ctx) => config.renderDiagram(el, resolve(note), ctx || {}),
    renderSettings: config.renderSettings || null,
    helpText: config.helpText || '',
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createMicInstrument;
