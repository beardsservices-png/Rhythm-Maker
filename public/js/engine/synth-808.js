// synth-808.js — playable 808 bass voice for BHS Studio.
//
// Three things the Rhythm Shop voices in audio-engine.js can't do, all of which
// a bass instrument needs:
//
//   1. Pitch. Rhythm Shop bakes frequency into each catalog preset. Here the
//      note is the input, so the same voice plays a whole bassline.
//   2. Note-off. Rhythm Shop voices are fire-and-forget on a fixed decay
//      (osc.stop(t + decay)). Holding a key means the release has to happen
//      later, at a time nobody knows when the note starts, so trigger() hands
//      back a handle instead.
//   3. Slide. The signature trap move is gliding from one note into the next
//      rather than retriggering. That's an exponential ramp on a live
//      oscillator, which is only possible while you still hold a reference.
//
// The punch is a fast pitch drop INTO the note, expressed as a ratio above it
// rather than absolute Hz, so a low note and a high note keep the same
// character. That distinction is the whole difference between "a kick that got
// pitched" and an 808 you can play a bassline on.
//
// Deliberately additive: this file does not touch audio-engine.js, so Freeplay
// and Round Robin keep working untouched.

const Synth808 = (() => {
  let ctx = null;
  let master = null;
  let limiter = null;

  const A4 = 440;
  const A4_MIDI = 69;

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function supported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  function midiToFreq(midi) {
    return A4 * Math.pow(2, (midi - A4_MIDI) / 12);
  }

  function midiToName(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function ensureContext() {
    if (!supported()) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();

      // Master limiter. A DynamicsCompressorNode is not a true brickwall — it
      // has no lookahead and will overshoot — but sub bass stacks up fast and
      // this keeps a held chord from clipping the output.
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      limiter.connect(ctx.destination);

      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(limiter);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // tanh saturation. This is what makes an 808 audible on a phone: the
  // fundamental of a low note is below what a small speaker can reproduce, so
  // the harmonics distortion adds are the only reason you hear the note at all.
  function makeSaturator(ac, amount) {
    const shaper = ac.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    const k = Math.max(0.01, amount);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    return shaper;
  }

  const DEFAULTS = {
    punchRatio: 4.0,   // how far above the note the pitch drop starts
    punchTime: 0.035,  // how long the drop takes — this is the "thump"
    drive: 6,          // saturation amount
    attack: 0.004,
    decay: 0.35,
    sustain: 0.55,     // fraction of peak held while the key is down
    release: 0.28,
    gain: 0.85,
    tone: 1600         // lowpass cutoff, keeps it from getting fizzy
  };

  /**
   * Start a note. Returns a handle — the caller decides when it ends.
   *
   * @param {number} midi   MIDI note number (C1 = 24, C2 = 36)
   * @param {object} params overrides for DEFAULTS
   * @returns {{release:Function, slideTo:Function, midi:number, stopped:boolean}}
   */
  function noteOn(midi, params = {}) {
    const ac = ensureContext();
    if (!ac) return null;

    const p = Object.assign({}, DEFAULTS, params);
    const t = ac.currentTime;
    const freq = midiToFreq(midi);

    const osc = ac.createOscillator();
    const amp = ac.createGain();
    const lp = ac.createBiquadFilter();
    const sat = makeSaturator(ac, p.drive);

    osc.type = 'sine';

    // The punch: start above the note and glide down into it fast.
    // Ratio, not absolute Hz — so the character holds across the keyboard.
    osc.frequency.setValueAtTime(freq * p.punchRatio, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + p.punchTime);

    lp.type = 'lowpass';
    lp.frequency.value = p.tone;
    lp.Q.value = 0.7;

    // ADS here; R happens in release() because we don't know when that is yet.
    const peak = p.gain;
    const sustainLevel = Math.max(0.0001, peak * p.sustain);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + p.attack);
    amp.gain.exponentialRampToValueAtTime(sustainLevel, t + p.attack + p.decay);

    osc.connect(sat).connect(lp).connect(amp).connect(master);
    osc.start(t);

    const handle = {
      midi,
      stopped: false,
      _osc: osc,
      _amp: amp,
      _params: p,

      /** Let the note go. Ramps down over `release` and cleans up after. */
      release(when) {
        if (handle.stopped) return;
        handle.stopped = true;
        const now = Math.max(ac.currentTime, when || ac.currentTime);
        const rel = p.release;
        amp.gain.cancelScheduledValues(now);
        amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), now);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + rel);
        osc.stop(now + rel + 0.02);
      },

      /** The 808 slide — glide to another note without retriggering. */
      slideTo(nextMidi, glideTime) {
        if (handle.stopped) return;
        const now = ac.currentTime;
        const target = midiToFreq(nextMidi);
        const g = Math.max(0.01, glideTime == null ? 0.08 : glideTime);
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(Math.max(1, osc.frequency.value), now);
        osc.frequency.exponentialRampToValueAtTime(target, now + g);
        handle.midi = nextMidi;
      }
    };

    return handle;
  }

  /** One-shot, for sequencer use: note on, note off after `hold` seconds. */
  function playFor(midi, hold, params = {}) {
    const h = noteOn(midi, params);
    if (!h) return null;
    const ac = ensureContext();
    h.release(ac.currentTime + Math.max(0.02, hold));
    return h;
  }

  function setMasterGain(v) {
    if (master) master.gain.value = Math.min(1.2, Math.max(0, v));
  }

  return {
    supported,
    ensureContext,
    noteOn,
    playFor,
    setMasterGain,
    midiToFreq,
    midiToName,
    DEFAULTS,
    get context() { return ctx; }
  };
})();
