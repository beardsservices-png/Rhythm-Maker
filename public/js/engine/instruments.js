// instruments.js — the melodic sounds you can add as tracks and play on the
// on-screen piano: the 808 plus a rack of synthesised keys, strings, pads,
// leads and basses.
//
// Every instrument is a recipe that builds one note into a stated context and
// destination, so the same code plays the keyboard live, the sequencer's
// patterns, and the offline .wav export. A note returns a HANDLE — the caller
// decides when it ends — with release(), slideTo() and setBend().
//
// Each instrument exposes a few KNOBS. They are deliberately few and named in
// plain words (Tone, Attack, Release …): the dock under the keyboard shows them
// for whatever you're playing, and a wall of twenty sliders is exactly what
// made the old page hard to use mid-take.

const Instruments = (() => {
  const A4 = 440, A4_MIDI = 69;
  const mtof = (m) => A4 * Math.pow(2, (m - A4_MIDI) / 12);

  const K = {
    tone:    { id: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%', hint: 'Dark ↔ bright' },
    attack:  { id: 'attack', label: 'Attack', min: 0.001, max: 2, step: 0.001, fmt: v => v < 0.1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's', hint: 'How fast each note fades in' },
    release: { id: 'release', label: 'Release', min: 0.02, max: 3, step: 0.01, fmt: v => v.toFixed(2) + 's', hint: 'How long it rings after you let go' },
    vibrato: { id: 'vibrato', label: 'Vibrato', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%', hint: 'Pitch wobble' },
    width:   { id: 'width', label: 'Detune', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%', hint: 'Thicker, wider sound' }
  };

  const KNOBS_808 = [
    { id: 'punchRatio', label: 'Punch', min: 1, max: 10, step: 0.1, fmt: v => v.toFixed(1) + '×', hint: 'How far above the note the pitch drop starts' },
    { id: 'punchTime', label: 'Punch time', min: 0.005, max: 0.15, step: 0.005, fmt: v => Math.round(v * 1000) + 'ms', hint: 'How fast it drops in' },
    { id: 'decay', label: 'Decay', min: 0.05, max: 2, step: 0.05, fmt: v => v.toFixed(2) + 's', hint: 'Fall from the hit to the held level' },
    { id: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%', hint: 'Level held while the key is down' },
    { id: 'release', label: 'Release', min: 0.02, max: 1.5, step: 0.02, fmt: v => v.toFixed(2) + 's', hint: 'Fade after you let go' },
    { id: 'drive', label: 'Drive', min: 1, max: 20, step: 0.5, fmt: v => v.toFixed(1), hint: 'Saturation — what makes it heard on phone speakers' },
    { id: 'tone', label: 'Tone', min: 200, max: 6000, step: 50, fmt: v => Math.round(v) + 'Hz', hint: 'Lowpass cutoff' }
  ];

  // ── building blocks ────────────────────────────────────────────────
  function osc(ac, type, freq, t, detuneCents) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detuneCents) o.detune.setValueAtTime(detuneCents, t);
    return o;
  }
  function gain(ac, v) { const g = ac.createGain(); g.gain.value = v; return g; }
  function lowpass(ac, f, q) {
    const l = ac.createBiquadFilter();
    l.type = 'lowpass'; l.frequency.value = f; l.Q.value = q == null ? 0.7 : q;
    return l;
  }
  const noiseCache = new WeakMap();
  function noise(ac) {
    let b = noiseCache.get(ac);
    if (!b) {
      b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache.set(ac, b);
    }
    const s = ac.createBufferSource(); s.buffer = b; return s;
  }
  /** Vibrato: one LFO into the detune of every oscillator in the note. */
  function vibrato(ac, t, amount, oscs, sources, delay = 0.25) {
    if (!amount) return;
    const lfo = ac.createOscillator(), depth = ac.createGain();
    lfo.frequency.value = 5.2;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(amount * 22, t + delay + 0.3);
    lfo.connect(depth);
    oscs.forEach(o => depth.connect(o.detune));
    sources.push(lfo);          // started (and stopped) with the note's other sources
  }

  // A recipe returns { out, freqs: [{param, ratio}], sources, env } where env
  // describes the amplitude shape so release() can pick up from wherever the
  // note has got to.

  const PRESETS = [
    {
      id: '808', label: '808 Bass', group: 'Synth bass', mono: true, slide: true, range: [24, 60],
      knobs: KNOBS_808, defaults: null   // filled from Synth808.DEFAULTS
    },
    {
      id: 'piano', label: 'Synth Piano', group: 'Synth keys', range: [36, 84],
      knobs: [K.tone, K.release], defaults: { tone: 0.55, release: 0.35, gain: 0.5 },
      build(ac, t, f, p, vel) {
        // Partials sit slightly sharp of whole multiples (string stiffness) and
        // the high ones die first — that pairing is most of "piano" vs "organ".
        const sum = gain(ac, 1);
        const sources = [], freqs = [];
        const base = Math.min(8, Math.max(0.9, 4.5 * Math.pow(110 / f, 0.4)));
        for (let n = 1; n <= 8; n++) {
          const ratio = n * Math.sqrt(1 + 0.0004 * n * n);
          if (f * ratio > 16000) break;
          const o = osc(ac, 'sine', f * ratio, t);
          const g = ac.createGain();
          const amp = (1 / Math.pow(n, 1.3)) * (n === 1 ? 1 : 0.4 + 0.6 * vel);
          g.gain.setValueAtTime(amp, t);
          g.gain.exponentialRampToValueAtTime(amp * 0.0005, t + base / (1 + 0.55 * (n - 1)));
          o.connect(g).connect(sum);
          sources.push(o); freqs.push({ param: o.frequency, ratio });
        }
        const lp = lowpass(ac, Math.min(16000, f * (3 + 14 * p.tone * (0.5 + vel))), 0.5);
        sum.connect(lp);
        // The hammer.
        const n = noise(ac), bp = ac.createBiquadFilter(), ng = ac.createGain();
        bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 6); bp.Q.value = 1;
        ng.gain.setValueAtTime(0.08 * vel, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        n.connect(bp).connect(ng).connect(lp);
        n.start(t); n.stop(t + 0.05);
        return { out: lp, freqs, sources, env: { a: 0.002, d: base * 1.2, s: 0.5, natural: true } };
      }
    },
    {
      id: 'epiano', label: 'FM E-Piano', group: 'Synth keys', range: [36, 84],
      knobs: [K.tone, K.release, K.vibrato], defaults: { tone: 0.5, release: 0.4, vibrato: 0, gain: 0.55 },
      build(ac, t, f, p, vel) {
        const car = osc(ac, 'sine', f, t), mod = osc(ac, 'sine', f, t), idx = ac.createGain();
        const peakIdx = f * (0.8 + 2.6 * p.tone * (0.4 + 0.6 * vel));
        idx.gain.setValueAtTime(peakIdx, t);
        idx.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.15), t + 1.2);
        mod.connect(idx).connect(car.frequency);
        const tine = osc(ac, 'sine', f * 7.1, t), tg = gain(ac, 0);
        tg.gain.setValueAtTime(0.06 * vel, t); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        const out = gain(ac, 1);
        car.connect(out); tine.connect(tg).connect(out);
        const sources = [car, mod, tine];
        vibrato(ac, t, p.vibrato, [car, mod], sources, 0.05);
        return { out, sources, freqs: [{ param: car.frequency, ratio: 1 }, { param: mod.frequency, ratio: 1 }, { param: tine.frequency, ratio: 7.1 }],
                 env: { a: 0.003, d: 3.2, s: 0.08, natural: true } };
      }
    },
    {
      id: 'organ', label: 'Organ', group: 'Synth keys', range: [36, 84],
      knobs: [K.tone, K.vibrato, K.release], defaults: { tone: 0.55, vibrato: 0.35, release: 0.08, gain: 0.32 },
      build(ac, t, f, p) {
        const bars = [[0.5, 0.7], [1, 1], [1.5, 0.35], [2, 0.7], [3, 0.4 * p.tone], [4, 0.45 * p.tone], [6, 0.25 * p.tone], [8, 0.2 * p.tone]];
        const out = gain(ac, 1), sources = [], freqs = [];
        bars.forEach(([r, g]) => {
          if (g <= 0 || f * r > 15000) return;
          const o = osc(ac, 'sine', f * r, t), og = gain(ac, g * 0.5);
          o.connect(og).connect(out); sources.push(o); freqs.push({ param: o.frequency, ratio: r });
        });
        vibrato(ac, t, p.vibrato * 0.6, sources.slice(), sources, 0);
        return { out, sources, freqs, env: { a: 0.006, d: 0.05, s: 0.95 } };
      }
    },
    {
      id: 'strings', label: 'Synth Strings', group: 'Synth orchestra', range: [36, 88],
      knobs: [K.tone, K.attack, K.release, K.vibrato], defaults: { tone: 0.5, attack: 0.28, release: 0.6, vibrato: 0.35, gain: 0.32 },
      build(ac, t, f, p) {
        const out = lowpass(ac, 900 + p.tone * 5500, 0.4), sources = [], freqs = [];
        [-9, 0, 8].forEach((c, i) => {
          const o = osc(ac, 'sawtooth', f, t, c), g = gain(ac, i === 1 ? 0.45 : 0.35);
          o.connect(g).connect(out); sources.push(o); freqs.push({ param: o.frequency, ratio: 1 });
        });
        vibrato(ac, t, p.vibrato * 0.7, sources.slice(), sources, 0.35);
        return { out, sources, freqs, env: { a: p.attack, d: 0.3, s: 0.85 } };
      }
    },
    {
      id: 'pad', label: 'Warm Pad', group: 'Synth', range: [36, 88],
      knobs: [K.tone, K.attack, K.release, K.width], defaults: { tone: 0.45, attack: 0.7, release: 1.4, width: 0.5, gain: 0.3 },
      build(ac, t, f, p) {
        const lp = lowpass(ac, 250, 0.8);
        lp.frequency.setValueAtTime(250, t);
        lp.frequency.linearRampToValueAtTime(400 + p.tone * 4000, t + Math.max(0.2, p.attack * 1.6));
        const sources = [], freqs = [];
        const spread = 4 + p.width * 18;
        [[-spread, 'sawtooth', 1, 0.3], [spread, 'sawtooth', 1, 0.3], [0, 'triangle', 0.5, 0.45]].forEach(([c, type, r, g]) => {
          const o = osc(ac, type, f * r, t, c), og = gain(ac, g);
          o.connect(og).connect(lp); sources.push(o); freqs.push({ param: o.frequency, ratio: r });
        });
        return { out: lp, sources, freqs, env: { a: p.attack, d: 0.5, s: 0.9 } };
      }
    },
    {
      id: 'lead', label: 'Synth Lead', group: 'Synth', range: [48, 96],
      knobs: [K.tone, K.release, K.vibrato, K.width], defaults: { tone: 0.6, release: 0.12, vibrato: 0.2, width: 0.3, gain: 0.3 },
      build(ac, t, f, p, vel) {
        const lp = lowpass(ac, 1000, 3.5);
        const top = Math.min(14000, f * 2 + p.tone * 6000 * (0.5 + vel * 0.5));
        lp.frequency.setValueAtTime(top, t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, top * 0.35), t + 0.35);
        const a = osc(ac, 'sawtooth', f, t, -p.width * 10), b = osc(ac, 'square', f, t, p.width * 10);
        const ga = gain(ac, 0.5), gb = gain(ac, 0.3);
        a.connect(ga).connect(lp); b.connect(gb).connect(lp);
        const sources = [a, b];
        vibrato(ac, t, p.vibrato, [a, b], sources, 0.3);
        return { out: lp, sources, freqs: [{ param: a.frequency, ratio: 1 }, { param: b.frequency, ratio: 1 }], env: { a: 0.006, d: 0.2, s: 0.8 } };
      }
    },
    {
      id: 'pluck', label: 'Pluck', group: 'Synth', range: [48, 96],
      knobs: [K.tone, K.release], defaults: { tone: 0.6, release: 0.25, gain: 0.45 },
      build(ac, t, f, p, vel) {
        const lp = lowpass(ac, 1000, 2);
        const top = Math.min(15000, 1500 + p.tone * 9000 * (0.4 + 0.6 * vel));
        lp.frequency.setValueAtTime(top, t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.2), t + 0.22);
        const a = osc(ac, 'sawtooth', f, t), b = osc(ac, 'square', f * 2, t, 4), gb = gain(ac, 0.2);
        a.connect(lp); b.connect(gb).connect(lp);
        return { out: lp, sources: [a, b], freqs: [{ param: a.frequency, ratio: 1 }, { param: b.frequency, ratio: 2 }],
                 env: { a: 0.002, d: 0.9, s: 0.001, natural: true } };
      }
    },
    {
      id: 'bell', label: 'Bell', group: 'Synth keys', range: [48, 96],
      knobs: [K.tone, K.release], defaults: { tone: 0.5, release: 1.2, gain: 0.35 },
      build(ac, t, f, p, vel) {
        const car = osc(ac, 'sine', f, t), mod = osc(ac, 'sine', f * 3.5, t), idx = gain(ac, 0);
        idx.gain.setValueAtTime(f * (1 + 4 * p.tone) * (0.5 + 0.5 * vel), t);
        idx.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.05), t + 2.5);
        mod.connect(idx).connect(car.frequency);
        return { out: car, sources: [car, mod], freqs: [{ param: car.frequency, ratio: 1 }, { param: mod.frequency, ratio: 3.5 }],
                 env: { a: 0.002, d: 3.5, s: 0.001, natural: true } };
      }
    },
    {
      id: 'synthbass', label: 'Synth Bass', group: 'Synth bass', range: [24, 60],
      knobs: [K.tone, K.release, K.width], defaults: { tone: 0.4, release: 0.1, width: 0.2, gain: 0.32 },
      build(ac, t, f, p, vel) {
        const lp = lowpass(ac, 400, 6);
        const top = 180 + p.tone * 2600 * (0.5 + 0.5 * vel);
        lp.frequency.setValueAtTime(top, t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, top * 0.3), t + 0.25);
        const a = osc(ac, 'sawtooth', f, t, -p.width * 12), b = osc(ac, 'sawtooth', f, t, p.width * 12), sub = osc(ac, 'sine', f / 2, t);
        const gs = gain(ac, 0.6);
        a.connect(lp); b.connect(lp); sub.connect(gs).connect(lp);
        return { out: lp, sources: [a, b, sub],
                 freqs: [{ param: a.frequency, ratio: 1 }, { param: b.frequency, ratio: 1 }, { param: sub.frequency, ratio: 0.5 }],
                 env: { a: 0.004, d: 0.3, s: 0.7 } };
      }
    },
    {
      id: 'brass', label: 'Synth Brass', group: 'Synth orchestra', range: [40, 84],
      knobs: [K.tone, K.attack, K.release, K.vibrato], defaults: { tone: 0.55, attack: 0.05, release: 0.18, vibrato: 0.2, gain: 0.32 },
      build(ac, t, f, p) {
        const lp = lowpass(ac, f, 1.2);
        lp.frequency.setValueAtTime(f * 1.2, t);
        lp.frequency.linearRampToValueAtTime(Math.min(12000, f * (3 + p.tone * 8)), t + Math.max(0.03, p.attack) + 0.06);
        const a = osc(ac, 'sawtooth', f, t, -5), b = osc(ac, 'sawtooth', f, t, 5);
        const g = gain(ac, 0.5); a.connect(g); b.connect(g); g.connect(lp);
        const sources = [a, b];
        vibrato(ac, t, p.vibrato, [a, b], sources, 0.3);
        return { out: lp, sources, freqs: [{ param: a.frequency, ratio: 1 }, { param: b.frequency, ratio: 1 }], env: { a: p.attack, d: 0.2, s: 0.85 } };
      }
    },
    {
      id: 'flute', label: 'Synth Flute', group: 'Synth orchestra', range: [60, 96],
      knobs: [K.tone, K.attack, K.release, K.vibrato], defaults: { tone: 0.4, attack: 0.06, release: 0.12, vibrato: 0.45, gain: 0.45 },
      build(ac, t, f, p) {
        const out = gain(ac, 1);
        const a = osc(ac, 'sine', f, t), b = osc(ac, 'triangle', f * 2, t), gb = gain(ac, 0.08 + p.tone * 0.15);
        a.connect(out); b.connect(gb).connect(out);
        const n = noise(ac), bp = ac.createBiquadFilter(), ng = gain(ac, 0.05 + p.tone * 0.05);
        n.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = Math.min(12000, f * 2); bp.Q.value = 2;
        n.connect(bp).connect(ng).connect(out);
        const sources = [a, b, n];
        vibrato(ac, t, p.vibrato, [a, b], sources, 0.35);
        return { out, sources, freqs: [{ param: a.frequency, ratio: 1 }, { param: b.frequency, ratio: 2 }], env: { a: p.attack, d: 0.2, s: 0.9 } };
      }
    }
  ];

  // ── recorded instruments (samples.js) ──
  // Real recordings, with a synth stand-in that plays until the files load.
  // Listed first in every picker: they're what most songs should reach for.
  const REC = (id, label, group, fallback, defaults, knobs) => ({
    id, label, group, fallback, sampled: true, knobs: knobs || [K.tone, K.release], defaults
  });
  const SAMPLED = [
    REC('real-piano', 'Grand Piano', 'Keys (recorded)', 'piano', { tone: 0.8, release: 0.5, gain: 0.75 }),
    REC('real-epiano', 'Electric Piano (Rhodes)', 'Keys (recorded)', 'epiano', { tone: 0.7, release: 0.35, gain: 0.8 }),
    REC('real-vibes', 'Vibraphone', 'Keys (recorded)', 'bell', { tone: 0.75, release: 0.8, gain: 0.7 }),
    REC('real-marimba', 'Marimba', 'Keys (recorded)', 'pluck', { tone: 0.8, release: 0.3, gain: 0.75 }),
    REC('real-kalimba', 'Kalimba', 'Keys (recorded)', 'pluck', { tone: 0.8, release: 0.4, gain: 0.75 }),
    REC('real-strings', 'Strings', 'Strings (recorded)', 'strings', { tone: 0.7, attack: 0.12, release: 0.5, gain: 0.65 }, [K.tone, K.attack, K.release]),
    REC('real-violin', 'Violin', 'Strings (recorded)', 'strings', { tone: 0.75, attack: 0.05, release: 0.35, gain: 0.65 }, [K.tone, K.attack, K.release]),
    REC('real-cello', 'Cello', 'Strings (recorded)', 'strings', { tone: 0.7, attack: 0.06, release: 0.4, gain: 0.7 }, [K.tone, K.attack, K.release]),
    REC('real-harp', 'Harp', 'Strings (recorded)', 'pluck', { tone: 0.8, release: 0.8, gain: 0.75 }),
    REC('real-trumpet', 'Trumpet', 'Brass & wind (recorded)', 'brass', { tone: 0.75, attack: 0.02, release: 0.2, gain: 0.6 }, [K.tone, K.attack, K.release]),
    REC('real-trombone', 'Trombone', 'Brass & wind (recorded)', 'brass', { tone: 0.75, attack: 0.02, release: 0.2, gain: 0.65 }, [K.tone, K.attack, K.release]),
    REC('real-horn', 'French Horn', 'Brass & wind (recorded)', 'brass', { tone: 0.7, attack: 0.04, release: 0.3, gain: 0.65 }, [K.tone, K.attack, K.release]),
    REC('real-sax', 'Saxophone', 'Brass & wind (recorded)', 'lead', { tone: 0.75, attack: 0.01, release: 0.2, gain: 0.6 }, [K.tone, K.attack, K.release]),
    REC('real-flute', 'Flute', 'Brass & wind (recorded)', 'flute', { tone: 0.75, attack: 0.03, release: 0.25, gain: 0.6 }, [K.tone, K.attack, K.release]),
    REC('real-guitar', 'Acoustic Guitar', 'Guitar & bass (recorded)', 'pluck', { tone: 0.8, release: 0.4, gain: 0.75 }),
    REC('real-nylon', 'Nylon Guitar', 'Guitar & bass (recorded)', 'pluck', { tone: 0.8, release: 0.4, gain: 0.75 }),
    REC('real-ebass', 'Electric Bass', 'Guitar & bass (recorded)', 'synthbass', { tone: 0.7, release: 0.15, gain: 0.8 }),
    REC('real-upright', 'Upright Bass', 'Guitar & bass (recorded)', 'synthbass', { tone: 0.7, release: 0.2, gain: 0.85 })
  ];
  SAMPLED.forEach(p => {
    const notes = typeof SAMPLE_MANIFEST !== 'undefined' && SAMPLE_MANIFEST.instruments[p.id];
    let lo = notes ? Math.max(24, notes[0] - 5) : 36, hi = notes ? Math.min(100, notes[notes.length - 1] + 5) : 84;
    // The piano roll shows the whole range, so keep it to four octaves around the useful middle.
    if (hi - lo > 48) { lo = Math.max(lo, 36); hi = Math.min(hi, lo + 48); }
    p.range = [lo, hi];
  });
  // 808 stays first (it's the default bass); recordings next; synths after.
  PRESETS.splice(1, 0, ...SAMPLED);

  const byId = (id) => PRESETS.find(p => p.id === id) || PRESETS[0];

  function defaults(id) {
    if (id === '808') return Object.assign({}, typeof Synth808 !== 'undefined' ? Synth808.DEFAULTS : {});
    return Object.assign({}, byId(id).defaults);
  }

  /**
   * Start a note. Returns a handle, or null.
   * @param when   audio-clock start time (defaults to now)
   * @param velocity 0–1
   */
  function noteOn(ac, dest, id, midi, velocity, when, params) {
    if (!ac || !dest) return null;
    const vel = velocity == null ? 0.85 : Math.max(0, Math.min(1, velocity));
    let preset = byId(id);
    let p = Object.assign(defaults(preset.id), params || {});

    if (preset.sampled) {
      const h = typeof Samples !== 'undefined' ? Samples.noteOn(ac, dest, preset.id, midi, vel, when, p) : null;
      if (h) return h;
      // Not downloaded yet: fetch it, and play the synth stand-in meanwhile.
      if (typeof Samples !== 'undefined') Samples.loadInstrument(preset.id);
      preset = byId(preset.fallback);
      p = Object.assign(defaults(preset.id), { tone: p.tone });
    }

    if (preset.id === '808') {
      // Same velocity curve the old 808 keyboard used: squared, with a floor,
      // so soft playing is quieter without vanishing.
      const vp = Object.assign({}, p, { gain: (p.gain || 0.85) * (0.25 + 0.75 * vel * vel) });
      return Synth808.renderNote(ac, dest, midi, vp, when);
    }

    const t = Math.max(ac.currentTime, when == null ? ac.currentTime : when);
    const f = mtof(midi);
    const v = preset.build(ac, t, f, p, vel);
    const amp = ac.createGain();
    const peak = (p.gain || 0.4) * (0.3 + 0.7 * vel);
    const e = v.env;
    const a = Math.max(0.001, e.a);
    const sustainLevel = Math.max(0.0001, peak * e.s);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.exponentialRampToValueAtTime(sustainLevel, t + a + Math.max(0.01, e.d));
    v.out.connect(amp).connect(dest);
    v.sources.forEach(s => s.start(t));
    // A natural-decay sound (piano, pluck, bell) ends by itself even if no
    // note-off ever arrives.
    if (e.natural) v.sources.forEach(s => { try { s.stop(t + a + e.d + 0.1); } catch (_) {} });

    // Where the envelope is at a given moment — needed to release smoothly in
    // browsers without cancelAndHoldAtTime (Firefox).
    function levelAt(time) {
      if (time <= t) return 0.0001;
      if (time < t + a) return Math.max(0.0001, peak * (time - t) / a);
      const k = Math.min(1, (time - t - a) / Math.max(0.01, e.d));
      return peak * Math.pow(sustainLevel / peak, k);
    }

    const handle = {
      midi, stopped: false,
      release(when2) {
        if (handle.stopped) return;
        handle.stopped = true;
        const at = Math.max(t + 0.004, when2 == null ? ac.currentTime : when2);
        const rel = Math.max(0.02, p.release || 0.1);
        const g = amp.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
        else { g.cancelScheduledValues(at); g.setValueAtTime(levelAt(at), at); }
        g.exponentialRampToValueAtTime(0.0001, at + rel);
        v.sources.forEach(s => { try { s.stop(at + rel + 0.05); } catch (_) {} });
      },
      /** Stop now, whatever was scheduled — what pressing Stop needs. */
      cut(when2) {
        handle.stopped = true;
        const at = Math.max(ac.currentTime, when2 == null ? ac.currentTime : when2);
        const g = amp.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
        else { g.cancelScheduledValues(at); g.setValueAtTime(levelAt(at), at); }
        g.linearRampToValueAtTime(0, at + 0.02);
        v.sources.forEach(s => { try { s.stop(at + 0.03); } catch (_) {} });
      },
      setBend(semis, when2) {
        if (handle.stopped) return;
        const at = Math.max(t, when2 == null ? ac.currentTime : when2);
        const base = mtof(handle.midi + (semis || 0));
        v.freqs.forEach(fr => { fr.param.cancelScheduledValues(at); fr.param.setTargetAtTime(base * fr.ratio, at, 0.012); });
      },
      slideTo(nextMidi, glide, when2) {
        if (handle.stopped) return;
        const at = Math.max(t, when2 == null ? ac.currentTime : when2);
        const g = Math.max(0.01, glide == null ? 0.08 : glide);
        v.freqs.forEach(fr => {
          fr.param.cancelScheduledValues(at);
          fr.param.setValueAtTime(mtof(handle.midi) * fr.ratio, at);
          fr.param.exponentialRampToValueAtTime(mtof(nextMidi) * fr.ratio, at + g);
        });
        handle.midi = nextMidi;
      }
    };
    return handle;
  }

  return {
    list: () => PRESETS.map(p => ({ id: p.id, label: p.label, group: p.group })),
    get: byId,
    label: (id) => byId(id).label,
    knobs: (id) => byId(id).knobs,
    range: (id) => byId(id).range,
    isMono: (id) => !!byId(id).mono,
    isSampled: (id) => !!byId(id).sampled,
    hasSlide: (id) => !!byId(id).slide,
    defaults, noteOn, mtof
  };
})();
