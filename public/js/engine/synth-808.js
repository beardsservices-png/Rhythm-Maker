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
   * `when` is what makes this sequencable: the transport schedules a lookahead
   * ahead of now, so a note has to be able to start at a stated audio-clock
   * time rather than "right now".
   *
   * @param {number} midi   MIDI note number (C1 = 24, C2 = 36)
   * @param {object} params overrides for DEFAULTS
   * @param {number} [when] audio-clock start time; defaults to now
   * @returns {{release:Function, slideTo:Function, midi:number, stopped:boolean}}
   */
  function noteOn(midi, params = {}, when) {
    const ac = ensureContext();
    if (!ac) return null;

    const p = Object.assign({}, DEFAULTS, params);
    const t = Math.max(ac.currentTime, when == null ? ac.currentTime : when);
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
        // Never release before the note has started, or the ramp runs
        // backwards and the note sticks on.
        const at = Math.max(t + p.attack, when == null ? ac.currentTime : when);
        const rel = p.release;
        amp.gain.cancelScheduledValues(at);
        amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), at);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + rel);
        osc.stop(at + rel + 0.02);
      },

      /** The 808 slide — glide to another note without retriggering. */
      slideTo(nextMidi, glideTime, when) {
        if (handle.stopped) return;
        const at = Math.max(t + p.punchTime, when == null ? ac.currentTime : when);
        const target = midiToFreq(nextMidi);
        const g = Math.max(0.01, glideTime == null ? 0.08 : glideTime);
        osc.frequency.cancelScheduledValues(at);
        osc.frequency.setValueAtTime(Math.max(1, midiToFreq(handle.midi)), at);
        osc.frequency.exponentialRampToValueAtTime(target, at + g);
        handle.midi = nextMidi;
      }
    };

    return handle;
  }

  /** One-shot, for sequencer use: note on, note off after `hold` seconds. */
  function playFor(midi, hold, params = {}, when) {
    const ac = ensureContext();
    if (!ac) return null;
    const start = when == null ? ac.currentTime : when;
    const h = noteOn(midi, params, start);
    if (!h) return null;
    h.release(start + Math.max(0.02, hold));
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
