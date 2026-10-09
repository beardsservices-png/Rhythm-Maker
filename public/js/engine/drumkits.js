// drumkits.js — every drum sound in the studio, grouped into kits.
//
// A kit is a set of ROLES (kick, snare, clap, hat …) each with its own synth
// settings. Changing the kit re-voices every drum lane at once; a single lane
// can also borrow a sound from another kit (a Boom Bap snare over a Trap kick),
// because a lane stores { kit, role } rather than a fixed voice.
//
// Two kinds of kit: SYNTH kits (Trap 808, Boom Bap …) build every hit from
// oscillators and noise; RECORDED kits play real drum recordings (samples.js)
// and fall back to the Live kit's synth voice until a file has loaded. Every
// voice renders into a stated context + destination, so the exact same code
// serves live playback (into a mixer strip) and the offline .wav export.

const DrumKits = (() => {
  const ROLES = [
    { id: 'kick',    label: 'Kick' },
    { id: 'snare',   label: 'Snare' },
    { id: 'clap',    label: 'Clap' },
    { id: 'hat',     label: 'Hi-hat' },
    { id: 'openhat', label: 'Open hat' },
    { id: 'perc',    label: 'Perc' },
    { id: 'tom',     label: 'Tom' },
    { id: 'rim',     label: 'Rim' },
    { id: 'crash',   label: 'Crash' },
    { id: 'snap',    label: 'Snap' },
    { id: 'shaker',  label: 'Shaker' },
    { id: 'tamb',    label: 'Tambourine' },
    { id: 'cowbell', label: 'Cowbell' },
    { id: 'conga',   label: 'Conga' },
    { id: 'bongo',   label: 'Bongo' }
  ];

  // The 808's cymbal oscillators — six detuned squares. Run through a
  // band-pass they are what makes a machine hat sound metallic rather than
  // like filtered static.
  const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

  const KITS = {
    trap: {
      label: 'Trap 808',
      kick:    { f0: 125, f1: 44, pitchTime: 0.07, decay: 0.95, click: 0.12, drive: 2.2, gain: 1 },
      snare:   { tone: 200, toneDecay: 0.08, noiseFreq: 2400, noiseQ: 0.8, decay: 0.15, noiseGain: 0.95, toneGain: 0.4 },
      clap:    { freq: 1500, bursts: 3, spread: 0.011, tail: 0.2, gain: 0.7 },
      hat:     { metal: true, tone: 8200, dur: 0.045, gain: 0.32 },
      openhat: { metal: true, tone: 7600, dur: 0.32, gain: 0.3 },
      perc:    { type: 'tamb' },
      tom:     { f0: 170, f1: 78, decay: 0.55, gain: 0.85 },
      rim:     { freq: 1750, decay: 0.035, gain: 0.5 }
    },
    boombap: {
      label: 'Boom Bap',
      kick:    { f0: 165, f1: 50, pitchTime: 0.03, decay: 0.4, click: 0.35, drive: 3, gain: 1, lp: 5200 },
      snare:   { tone: 175, toneDecay: 0.1, noiseFreq: 1500, noiseQ: 0.7, decay: 0.26, noiseGain: 1, toneGain: 0.5, lp: 7000 },
      clap:    { freq: 1300, bursts: 3, spread: 0.018, tail: 0.16, gain: 0.7, lp: 6000 },
      hat:     { metal: false, tone: 7000, dur: 0.06, gain: 0.45, lp: 9000 },
      openhat: { metal: false, tone: 6500, dur: 0.3, gain: 0.4, lp: 9000 },
      perc:    { type: 'shaker' },
      tom:     { f0: 210, f1: 105, decay: 0.3, gain: 0.85 },
      rim:     { freq: 1500, decay: 0.05, gain: 0.5 }
    },
    house: {
      label: 'House 909',
      kick:    { f0: 190, f1: 52, pitchTime: 0.025, decay: 0.48, click: 0.5, drive: 1.6, gain: 1 },
      snare:   { tone: 235, toneDecay: 0.07, noiseFreq: 3200, noiseQ: 0.6, decay: 0.2, noiseGain: 0.9, toneGain: 0.45 },
      clap:    { freq: 1200, bursts: 4, spread: 0.009, tail: 0.26, gain: 0.75 },
      hat:     { metal: true, tone: 9500, dur: 0.05, gain: 0.3 },
      openhat: { metal: true, tone: 9000, dur: 0.42, gain: 0.28 },
      perc:    { type: 'shaker' },
      tom:     { f0: 240, f1: 120, decay: 0.32, gain: 0.8 },
      rim:     { freq: 1900, decay: 0.03, gain: 0.5 }
    },
    lofi: {
      label: 'Lo-Fi Dusty',
      kick:    { f0: 115, f1: 47, pitchTime: 0.04, decay: 0.36, click: 0.1, drive: 2, gain: 1, lp: 2400 },
      snare:   { tone: 165, toneDecay: 0.09, noiseFreq: 1200, noiseQ: 0.9, decay: 0.22, noiseGain: 0.9, toneGain: 0.5, lp: 3800 },
      clap:    { freq: 1100, bursts: 3, spread: 0.015, tail: 0.14, gain: 0.65, lp: 3800 },
      hat:     { metal: false, tone: 6000, dur: 0.05, gain: 0.4, lp: 5200 },
      openhat: { metal: false, tone: 5500, dur: 0.26, gain: 0.35, lp: 5200 },
      perc:    { type: 'shaker', lp: 4500 },
      tom:     { f0: 180, f1: 95, decay: 0.3, gain: 0.8, lp: 3000 },
      rim:     { freq: 1300, decay: 0.05, gain: 0.45, lp: 3500 }
    },
    live: {
      label: 'Live Kit',
      kick:    { f0: 100, f1: 56, pitchTime: 0.04, decay: 0.32, click: 0.7, drive: 1.4, gain: 1 },
      snare:   { tone: 205, toneDecay: 0.12, noiseFreq: 2700, noiseQ: 0.5, decay: 0.32, noiseGain: 1, toneGain: 0.55 },
      clap:    { freq: 1400, bursts: 3, spread: 0.013, tail: 0.18, gain: 0.7 },
      hat:     { metal: true, tone: 10000, dur: 0.08, gain: 0.3, mixNoise: true },
      openhat: { metal: true, tone: 9500, dur: 0.55, gain: 0.26, mixNoise: true },
      perc:    { type: 'conga' },
      tom:     { f0: 150, f1: 112, decay: 0.45, gain: 0.85 },
      rim:     { freq: 1600, decay: 0.045, gain: 0.55 }
    },
    // The studio's original kit, kept so projects made before kits existed
    // load sounding exactly as they did.
    classic: {
      label: 'Classic (original)',
      kick:    { f0: 180, f1: 55, pitchTime: 0.088, decay: 0.22, click: 0.25, gain: 1 },
      snare:   { tone: 160, toneDecay: 0.156, noiseFreq: 1500, noiseQ: 0.9, decay: 0.24, noiseGain: 1, toneGain: 0.45 },
      clap:    { freq: 1700, bursts: 3, spread: 0.012, tail: 0.09, gain: 0.55 },
      hat:     { metal: false, tone: 8500, dur: 0.065, gain: 0.5 },
      openhat: { metal: false, tone: 7500, dur: 0.34, gain: 0.5 },
      perc:    { type: 'shaker' },
      tom:     { f0: 160, f1: 70, decay: 0.32, gain: 0.85 },
      rim:     { freq: 1600, decay: 0.05, gain: 0.5 }
    }
  };

  // The extra hand percussion every synth kit gets, so a lane can be a crash or
  // a shaker whatever kit is picked.
  const SYNTH_EXTRAS = {
    crash:   { metal: true, tone: 6200, dur: 1.4, gain: 0.22, mixNoise: true },
    snap:    { freq: 2300, bursts: 1, spread: 0, tail: 0.07, gain: 0.6 },
    shaker:  { type: 'shaker' },
    tamb:    { type: 'tamb' },
    cowbell: { type: 'cowbell' },
    conga:   { type: 'conga' },
    bongo:   { f0: 430, f1: 350, decay: 0.12, gain: 0.7 }
  };
  Object.values(KITS).forEach(k => Object.keys(SYNTH_EXTRAS).forEach(r => { if (!k[r]) k[r] = Object.assign({}, SYNTH_EXTRAS[r], k.kick && k.kick.lp ? { lp: k.kick.lp + 1500 } : {}); }));

  // Recorded kits: { sample, gain, decay (cut the tail, s), pitch (semitones) }.
  const HAND = { crash: { sample: 'crash', gain: 0.55 }, snap: { sample: 'snap', gain: 0.8 }, shaker: { sample: 'shaker', gain: 0.6 },
                 tamb: { sample: 'tamb', gain: 0.6 }, cowbell: { sample: 'cowbell', gain: 0.55 }, conga: { sample: 'conga', gain: 0.8 },
                 bongo: { sample: 'bongo', gain: 0.75 } };
  KITS.acoustic = Object.assign({
    label: 'Acoustic Kit (recorded)', recorded: true,
    kick:    { sample: 'kick-acoustic', gain: 1 },
    snare:   { sample: 'snare-acoustic', gain: 0.85 },
    clap:    { sample: 'clap-group', gain: 0.7 },
    hat:     { sample: 'hat-closed', gain: 0.5 },
    openhat: { sample: 'hat-open', gain: 0.45, decay: 0.9 },
    perc:    { sample: 'shaker', gain: 0.55 },
    tom:     { sample: 'tom-mid', gain: 0.8 },
    rim:     { sample: 'rim-claves', gain: 0.55 }
  }, HAND);
  KITS.studio = Object.assign({
    label: 'Hip-Hop Studio (recorded)', recorded: true,
    kick:    { sample: 'kick-heavy', gain: 1 },
    snare:   { sample: 'snare-dub', gain: 0.85 },
    clap:    { sample: 'clap-solo', gain: 0.8 },
    hat:     { sample: 'hat-pi', gain: 0.5 },
    openhat: { sample: 'hat-open-pi', gain: 0.45, decay: 0.7 },
    perc:    { sample: 'snap', gain: 0.75 },
    tom:     { sample: 'tom-lo', gain: 0.8 },
    rim:     { sample: 'rim-wood', gain: 0.6 }
  }, HAND);
  KITS.electro = Object.assign({
    label: 'Electronic (recorded)', recorded: true,
    kick:    { sample: 'kick-house', gain: 1 },
    snare:   { sample: 'snare-electro', gain: 0.8 },
    clap:    { sample: 'clap-group', gain: 0.7 },
    hat:     { sample: 'hat-pedal', gain: 0.5 },
    openhat: { sample: 'hat-electro', gain: 0.45 },
    perc:    { sample: 'tamb', gain: 0.55 },
    tom:     { sample: 'tom-electro', gain: 0.75 },
    rim:     { sample: 'rim-wood', gain: 0.6 }
  }, HAND, { crash: { sample: 'crash-big', gain: 0.5, decay: 2.2 } });
  KITS.boom808 = Object.assign({
    label: 'Trap (recorded hits)', recorded: true,
    kick:    { sample: 'kick-808', gain: 1 },
    snare:   { sample: 'snare-hi', gain: 0.8 },
    clap:    { sample: 'clap-solo', gain: 0.8 },
    hat:     { sample: 'hat-pi', gain: 0.45 },
    openhat: { sample: 'hat-open-pi', gain: 0.4, decay: 0.5 },
    perc:    { sample: 'snap', gain: 0.75 },
    tom:     { sample: 'tom-electro', gain: 0.75 },
    rim:     { sample: 'rim-wood', gain: 0.6 }
  }, HAND);

  const KIT_ORDER = ['trap', 'boombap', 'house', 'lofi', 'acoustic', 'studio', 'electro', 'boom808', 'live', 'classic'];

  // ── shared bits, cached per context (offline renders get their own) ──
  const noiseCache = new WeakMap();
  function noiseBuffer(ac) {
    let b = noiseCache.get(ac);
    if (b) return b;
    const len = Math.floor(ac.sampleRate * 1.0);
    b = ac.createBuffer(1, len, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, b);
    return b;
  }
  const curveCache = new Map();
  function saturator(ac, k) {
    const sh = ac.createWaveShaper();
    let c = curveCache.get(k);
    if (!c) {
      c = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 1023 * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
      curveCache.set(k, c);
    }
    sh.curve = c;
    return sh;
  }
  function noise(ac) { const s = ac.createBufferSource(); s.buffer = noiseBuffer(ac); return s; }

  /** Optional lowpass on the way out — how the Lo-Fi kit gets its dust. */
  function outFor(ac, dest, p) {
    if (!p.lp) return dest;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = p.lp; lp.Q.value = 0.5;
    lp.connect(dest);
    return lp;
  }

  function decayEnv(g, t, peak, dur, attack = 0.001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  }

  // ── voices ──
  function kick(ac, dest, t, p, vel) {
    const out = outFor(ac, dest, p);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.f0, t);
    osc.frequency.exponentialRampToValueAtTime(p.f1, t + p.pitchTime);
    decayEnv(g, t, (p.gain || 1) * vel, p.decay, 0.002);
    if (p.drive) osc.connect(saturator(ac, p.drive)).connect(g); else osc.connect(g);
    g.connect(out);
    osc.start(t); osc.stop(t + p.decay + 0.05);
    if (p.click) {
      const n = noise(ac), hp = ac.createBiquadFilter(), ng = ac.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1500;
      decayEnv(ng, t, p.click * vel, 0.012);
      n.connect(hp).connect(ng).connect(out);
      n.start(t); n.stop(t + 0.03);
    }
  }

  function snare(ac, dest, t, p, vel) {
    const out = outFor(ac, dest, p);
    const n = noise(ac), bp = ac.createBiquadFilter(), ng = ac.createGain();
    bp.type = 'bandpass'; bp.frequency.value = p.noiseFreq; bp.Q.value = p.noiseQ;
    decayEnv(ng, t, p.noiseGain * vel, p.decay);
    n.connect(bp).connect(ng).connect(out);
    n.start(t); n.stop(t + p.decay + 0.05);
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(p.tone * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(p.tone, t + 0.02);
    decayEnv(og, t, p.toneGain * vel, p.toneDecay);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + p.toneDecay + 0.05);
  }

  function clap(ac, dest, t, p, vel) {
    const out = outFor(ac, dest, p);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = p.freq; bp.Q.value = 1.1;
    bp.connect(out);
    for (let i = 0; i < p.bursts; i++) {
      const n = noise(ac), g = ac.createGain();
      const s = t + i * p.spread;
      const last = i === p.bursts - 1;
      decayEnv(g, s, p.gain * vel, last ? p.tail : 0.02, 0.003);
      n.connect(g).connect(bp);
      n.start(s); n.stop(s + (last ? p.tail : 0.02) + 0.05);
    }
  }

  function hat(ac, dest, t, p, vel) {
    const out = outFor(ac, dest, p);
    const hp = ac.createBiquadFilter(), bp = ac.createBiquadFilter(), g = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = p.tone * 0.85;
    bp.type = 'bandpass'; bp.frequency.value = p.tone * 1.25; bp.Q.value = 0.7;
    decayEnv(g, t, p.gain * vel, p.dur);
    bp.connect(hp).connect(g).connect(out);
    const stopAt = t + p.dur + 0.05;
    if (p.metal) {
      const scale = p.tone / 8000;
      METAL.forEach(f => {
        const o = ac.createOscillator();
        o.type = 'square'; o.frequency.value = f * scale * 1.5;
        o.connect(bp); o.start(t); o.stop(stopAt);
      });
    }
    if (!p.metal || p.mixNoise) {
      const n = noise(ac);
      if (p.metal) { const ng = ac.createGain(); ng.gain.value = 0.6; n.connect(ng).connect(bp); }
      else n.connect(bp);
      n.start(t); n.stop(stopAt);
    }
  }

  function tom(ac, dest, t, p, vel) {
    const out = outFor(ac, dest, p);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(p.f0, t);
    o.frequency.exponentialRampToValueAtTime(p.f1, t + p.decay * 0.6);
    decayEnv(g, t, (p.gain || 0.85) * vel, p.decay, 0.002);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + p.decay + 0.05);
  }

  function rim(ac, dest, t, p, vel) {
    const out = outFor(ac, dest, p);
    const o = ac.createOscillator(), bp = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = p.freq;
    bp.type = 'bandpass'; bp.frequency.value = p.freq; bp.Q.value = 4;
    decayEnv(g, t, p.gain * vel, p.decay);
    o.connect(bp).connect(g).connect(out);
    o.start(t); o.stop(t + p.decay + 0.05);
  }

  function perc(ac, dest, t, p, vel) {
    const out = outFor(ac, dest, p);
    if (p.type === 'conga') return tom(ac, out, t, { f0: 330, f1: 210, decay: 0.18, gain: 0.8 }, vel);
    if (p.type === 'cowbell') {
      [540, 800].forEach(f => {
        const o = ac.createOscillator(), bp = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'square'; o.frequency.value = f;
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3;
        decayEnv(g, t, 0.3 * vel, 0.22, 0.003);
        o.connect(bp).connect(g).connect(out);
        o.start(t); o.stop(t + 0.3);
      });
      return;
    }
    // shaker / tambourine — high noise with a soft attack
    const tamb = p.type === 'tamb';
    const n = noise(ac), hp = ac.createBiquadFilter(), g = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = tamb ? 6500 : 4000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime((tamb ? 0.38 : 0.3) * vel, t + (tamb ? 0.002 : 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (tamb ? 0.14 : 0.09));
    n.connect(hp).connect(g).connect(out);
    n.start(t); n.stop(t + 0.2);
  }

  const VOICES = { kick, snare, clap, hat, openhat: hat, perc, tom, rim,
                   crash: hat, snap: clap, shaker: perc, tamb: perc, cowbell: perc, conga: perc, bongo: tom };

  /**
   * Play one drum. `sound` is { kit, role }. Velocity 0–1 (sequenced hits
   * are 1; a pad or MIDI key passes how hard it was struck).
   */
  function hit(ac, dest, sound, when, velocity) {
    if (!ac || !dest || !sound) return;
    const kit = KITS[sound.kit] || KITS.trap;
    let p = kit[sound.role];
    const fn = VOICES[sound.role];
    if (!p || !fn) return;
    const v = velocity == null ? 1 : Math.max(0.03, Math.min(1.3, velocity));   // 1.3 = accent
    const t = Math.max(ac.currentTime, when == null ? ac.currentTime : when);
    if (p.sample) {
      if (typeof Samples !== 'undefined' && Samples.oneShot(ac, dest, p.sample, t, v, p)) return;
      // Still downloading: ask for it, and use the Live kit's synth hit this once.
      if (typeof Samples !== 'undefined') Samples.loadDrum(p.sample);
      p = KITS.live[sound.role];
    }
    fn(ac, dest, t, p, v);
  }

  /** The recording a lane plays, or null for a synth hit. */
  function sampleOf(sound) {
    const kit = sound && KITS[sound.kit];
    const p = kit && kit[sound.role];
    return p && p.sample ? p.sample : null;
  }

  function roleLabel(role) {
    const r = ROLES.find(x => x.id === role);
    return r ? r.label : role;
  }

  return {
    ROLES, KITS, KIT_ORDER, hit, roleLabel, sampleOf,
    kits: () => KIT_ORDER.map(id => ({ id, label: KITS[id].label }))
  };
})();
