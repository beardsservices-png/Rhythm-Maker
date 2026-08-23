// audio-engine.js — shared Web Audio synthesis + scheduler for Rhythm Shop
// No sample libraries, no external deps. Layered oscillators + noise + a shared
// reverb send so instruments sit together instead of sounding thin/chiptune.

const RhythmAudio = (() => {
  let ctx = null;
  let noiseBuffer = null;
  let dryBus = null;
  let wetSend = null;
  let convolver = null;
  let compressor = null;

  function supported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  // Build the buses onto whatever context we've been given. Split out of
  // ensureContext so an external context can be adopted without duplicating
  // the graph setup.
  function buildBuses() {
    noiseBuffer = buildNoiseBuffer(ctx);

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    compressor.connect(ctx.destination);

    dryBus = ctx.createGain();
    dryBus.gain.value = 0.85;
    dryBus.connect(compressor);

    convolver = ctx.createConvolver();
    convolver.buffer = buildImpulse(ctx, 1.4, 2.2);
    wetSend = ctx.createGain();
    wetSend.gain.value = 0.16;
    wetSend.connect(convolver);
    convolver.connect(compressor);
  }

  function ensureContext() {
    if (!supported()) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      buildBuses();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /**
   * Share an existing AudioContext instead of creating a private one.
   *
   * BHS Studio plays these drum voices alongside the 808, and two contexts
   * mean two independent clocks — the kit and the bass would drift apart
   * within seconds even though both schedule "correctly". Must be called
   * before anything triggers a voice; returns false if we already built our
   * own, so a caller can tell rather than silently getting two clocks.
   *
   * Rhythm Shop's own pages never call this, so their behaviour is unchanged.
   */
  function adoptContext(externalCtx) {
    if (!externalCtx) return false;
    if (ctx === externalCtx) return true;
    if (ctx) return false;
    ctx = externalCtx;
    buildBuses();
    return true;
  }

  function buildNoiseBuffer(ac) {
    const len = ac.sampleRate * 1.0;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildImpulse(ac, duration, decay) {
    const len = Math.floor(ac.sampleRate * duration);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // While an offline render is running these point at that context's buses,
  // so the same voice code serves both live playback and rendering.
  let activeDry = null;
  let activeWet = null;
  let activeNoise = null;

  function noiseSource(ac) {
    const src = ac.createBufferSource();
    src.buffer = activeNoise || noiseBuffer;
    return src;
  }

  function connectOut(ac, node, sendAmount = 1) {
    const dry = activeDry || dryBus;
    const wet = activeWet || wetSend;
    node.connect(dry);
    if (sendAmount > 0) {
      const send = ac.createGain();
      send.gain.value = sendAmount;
      node.connect(send);
      send.connect(wet);
    }
  }

  function makeSaturator(ac, amount = 8) {
    const shaper = ac.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    return shaper;
  }

  function synthKick(ac, t, out, { start = 150, end = 45, decay = 0.32, click = true } = {}) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(start, t);
    osc.frequency.exponentialRampToValueAtTime(end, t + decay * 0.4);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(gain);
    connectOut(ac, gain, 0.06);
    osc.start(t); osc.stop(t + decay + 0.02);

    if (click) {
      const n = noiseSource(ac);
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 800;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.25, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
      n.connect(hp).connect(ng);
      connectOut(ac, ng, 0);
      n.start(t); n.stop(t + 0.02);
    }
  }

  function synthSnare(ac, t, out, { tone = 180, noiseColor = 1800, decay = 0.18, bright = 0.9 } = {}) {
    const noise = noiseSource(ac);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = noiseColor; bp.Q.value = 0.9;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(bright, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + decay);
    noise.connect(bp).connect(ng);
    connectOut(ac, ng, 0.18);

    const osc = ac.createOscillator();
    const og = ac.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(tone, t);
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + decay * 0.65);
    osc.connect(og);
    connectOut(ac, og, 0.1);

    noise.start(t); noise.stop(t + decay + 0.02);
    osc.start(t); osc.stop(t + decay * 0.7);
  }

  function synthHat(ac, t, out, { open = false, tone = 8500 } = {}) {
    const noise = noiseSource(ac);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = tone;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = tone * 1.4; bp.Q.value = 0.6;
    const g = ac.createGain();
    const dur = open ? 0.34 : 0.065;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(hp).connect(bp).connect(g);
    connectOut(ac, g, 0.1);
    noise.start(t); noise.stop(t + dur + 0.02);
  }

  function synthClap(ac, t, out, { spread = 0.012, wide = false } = {}) {
    for (let i = 0; i < 3; i++) {
      const noise = noiseSource(ac);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = wide ? 1400 : 1700; bp.Q.value = 1.1;
      const g = ac.createGain();
      const start = t + i * spread;
      g.gain.setValueAtTime(0.001, start);
      g.gain.linearRampToValueAtTime(0.55, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.09);
      noise.connect(bp).connect(g);
      connectOut(ac, g, 0.2);
      noise.start(start); noise.stop(start + 0.1);
    }
  }

  function synthTom(ac, t, out, { start = 220, end = 90, decay = 0.28 } = {}) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(start, t);
    osc.frequency.exponentialRampToValueAtTime(end, t + decay * 0.6);
    gain.gain.setValueAtTime(0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(gain);
    connectOut(ac, gain, 0.15);
    osc.start(t); osc.stop(t + decay + 0.02);
  }

  function synthBass(ac, t, out, { freq = 55, decay = 0.4, style = 'sub' } = {}) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const sat = makeSaturator(ac, style === 'reso' ? 6 : 3);
    osc.type = style === 'pluck' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.8, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);

    if (style === 'reso') {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 8;
      lp.frequency.setValueAtTime(1400, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + decay);
      osc.connect(sat).connect(lp).connect(gain);
    } else {
      osc.connect(sat).connect(gain);
    }
    connectOut(ac, gain, 0.08);
    osc.start(t); osc.stop(t + decay + 0.02);
  }

  function synthLead(ac, t, out, { freq = 330, wave = 'sawtooth', decay = 0.3 } = {}) {
    const osc = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const gain = ac.createGain();
    const sat = makeSaturator(ac, 3);
    osc.type = wave; osc.frequency.setValueAtTime(freq, t);
    osc2.type = wave; osc2.frequency.setValueAtTime(freq * 1.004, t);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + decay);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.42, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(sat); osc2.connect(sat);
    sat.connect(lp).connect(gain);
    connectOut(ac, gain, 0.2);
    osc.start(t); osc.stop(t + decay + 0.02);
    osc2.start(t); osc2.stop(t + decay + 0.02);
  }

  function synthPad(ac, t, out, { freq = 220, decay = 0.6, airy = false } = {}) {
    [1, 1.5, 2].forEach((mult, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = airy ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq * mult, t);
      const peak = 0.28 / (i + 1);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
      osc.connect(gain);
      connectOut(ac, gain, 0.3);
      osc.start(t); osc.stop(t + decay + 0.03);
    });
  }

  function synthBell(ac, t, out, { base = 660, spread = 1, decay = 0.55 } = {}) {
    const partials = [1, 2, 2.76 * spread];
    partials.forEach((mult, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * mult, t);
      const amp = 0.32 / (i + 1);
      gain.gain.setValueAtTime(amp, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay - i * 0.08);
      osc.connect(gain);
      connectOut(ac, gain, 0.35);
      osc.start(t); osc.stop(t + decay + 0.05);
    });
  }

  function synthPerc(ac, t, out, { type = 'shaker' } = {}) {
    if (type === 'cowbell') {
      [540, 800].forEach((f) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        const sat = makeSaturator(ac, 2);
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.25, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(sat).connect(gain);
        connectOut(ac, gain, 0.15);
        osc.start(t); osc.stop(t + 0.22);
      });
    } else if (type === 'conga') {
      synthTom(ac, t, out, { start: 320, end: 200, decay: 0.16 });
    } else {
      const noise = noiseSource(ac);
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4000;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      noise.connect(hp).connect(g);
      connectOut(ac, g, 0.12);
      noise.start(t); noise.stop(t + 0.1);
    }
  }

  // Organized as families (the "same instrument") with tone variants
  // (the "different pictures of the same instrument") for the picker UI.
  const CATALOG = [
    { id: 'kick_deep', family: 'kick', familyLabel: 'Kick', variant: 'Deep', color: 'var(--red)', play: (ac, t, o) => synthKick(ac, t, o, { start: 140, end: 42, decay: 0.36 }) },
    { id: 'kick_punchy', family: 'kick', familyLabel: 'Kick', variant: 'Punchy', color: 'var(--red)', play: (ac, t, o) => synthKick(ac, t, o, { start: 180, end: 55, decay: 0.22, click: true }) },
    { id: 'kick_sub', family: 'kick', familyLabel: 'Kick', variant: 'Sub', color: 'var(--red)', play: (ac, t, o) => synthKick(ac, t, o, { start: 90, end: 35, decay: 0.45, click: false }) },

    { id: 'snare_tight', family: 'snare', familyLabel: 'Snare', variant: 'Tight', color: 'var(--amber)', play: (ac, t, o) => synthSnare(ac, t, o, { tone: 200, noiseColor: 2200, decay: 0.14, bright: 0.9 }) },
    { id: 'snare_fat', family: 'snare', familyLabel: 'Snare', variant: 'Fat', color: 'var(--amber)', play: (ac, t, o) => synthSnare(ac, t, o, { tone: 160, noiseColor: 1500, decay: 0.24, bright: 1.0 }) },
    { id: 'snare_rim', family: 'snare', familyLabel: 'Snare', variant: 'Rim', color: 'var(--amber)', play: (ac, t, o) => synthSnare(ac, t, o, { tone: 420, noiseColor: 3000, decay: 0.08, bright: 0.5 }) },

    { id: 'hat_closed', family: 'hihat', familyLabel: 'Hi-Hat', variant: 'Closed', color: 'var(--teal)', play: (ac, t, o) => synthHat(ac, t, o, { open: false, tone: 8500 }) },
    { id: 'hat_open', family: 'hihat', familyLabel: 'Hi-Hat', variant: 'Open', color: 'var(--teal)', play: (ac, t, o) => synthHat(ac, t, o, { open: true, tone: 7500 }) },
    { id: 'hat_pedal', family: 'hihat', familyLabel: 'Hi-Hat', variant: 'Pedal', color: 'var(--teal)', play: (ac, t, o) => synthHat(ac, t, o, { open: false, tone: 6000 }) },

    { id: 'clap_classic', family: 'clap', familyLabel: 'Clap', variant: 'Classic', color: 'var(--blue)', play: (ac, t, o) => synthClap(ac, t, o, { wide: false }) },
    { id: 'clap_wide', family: 'clap', familyLabel: 'Clap', variant: 'Wide', color: 'var(--blue)', play: (ac, t, o) => synthClap(ac, t, o, { wide: true, spread: 0.018 }) },

    { id: 'tom_low', family: 'tom', familyLabel: 'Tom', variant: 'Low', color: 'var(--red)', play: (ac, t, o) => synthTom(ac, t, o, { start: 160, end: 70, decay: 0.32 }) },
    { id: 'tom_high', family: 'tom', familyLabel: 'Tom', variant: 'High', color: 'var(--red)', play: (ac, t, o) => synthTom(ac, t, o, { start: 300, end: 140, decay: 0.22 }) },

    { id: 'bass_sub', family: 'bass', familyLabel: 'Bass', variant: 'Sub', color: 'var(--blue)', play: (ac, t, o) => synthBass(ac, t, o, { freq: 55, decay: 0.42, style: 'sub' }) },
    { id: 'bass_pluck', family: 'bass', familyLabel: 'Bass', variant: 'Pluck', color: 'var(--blue)', play: (ac, t, o) => synthBass(ac, t, o, { freq: 82, decay: 0.22, style: 'pluck' }) },
    { id: 'bass_reso', family: 'bass', familyLabel: 'Bass', variant: 'Reso', color: 'var(--blue)', play: (ac, t, o) => synthBass(ac, t, o, { freq: 65, decay: 0.5, style: 'reso' }) },

    { id: 'lead_saw', family: 'lead', familyLabel: 'Lead', variant: 'Saw', color: 'var(--violet)', play: (ac, t, o) => synthLead(ac, t, o, { freq: 330, wave: 'sawtooth', decay: 0.3 }) },
    { id: 'lead_square', family: 'lead', familyLabel: 'Lead', variant: 'Square', color: 'var(--violet)', play: (ac, t, o) => synthLead(ac, t, o, { freq: 294, wave: 'square', decay: 0.26 }) },
    { id: 'lead_pluck', family: 'lead', familyLabel: 'Lead', variant: 'Pluck', color: 'var(--violet)', play: (ac, t, o) => synthLead(ac, t, o, { freq: 392, wave: 'triangle', decay: 0.16 }) },

    { id: 'pad_warm', family: 'pad', familyLabel: 'Pad', variant: 'Warm', color: 'var(--violet)', play: (ac, t, o) => synthPad(ac, t, o, { freq: 220, decay: 0.7, airy: false }) },
    { id: 'pad_airy', family: 'pad', familyLabel: 'Pad', variant: 'Airy', color: 'var(--violet)', play: (ac, t, o) => synthPad(ac, t, o, { freq: 330, decay: 0.9, airy: true }) },

    { id: 'bell_glass', family: 'bell', familyLabel: 'Bell', variant: 'Glass', color: 'var(--paper)', play: (ac, t, o) => synthBell(ac, t, o, { base: 660, spread: 1, decay: 0.5 }) },
    { id: 'bell_chime', family: 'bell', familyLabel: 'Bell', variant: 'Chime', color: 'var(--paper)', play: (ac, t, o) => synthBell(ac, t, o, { base: 880, spread: 1.3, decay: 0.65 }) },

    { id: 'perc_shaker', family: 'perc', familyLabel: 'Perc', variant: 'Shaker', color: 'var(--teal)', play: (ac, t, o) => synthPerc(ac, t, o, { type: 'shaker' }) },
    { id: 'perc_cowbell', family: 'perc', familyLabel: 'Perc', variant: 'Cowbell', color: 'var(--teal)', play: (ac, t, o) => synthPerc(ac, t, o, { type: 'cowbell' }) },
    { id: 'perc_conga', family: 'perc', familyLabel: 'Perc', variant: 'Conga', color: 'var(--teal)', play: (ac, t, o) => synthPerc(ac, t, o, { type: 'conga' }) }
  ];

  function voiceById(id) {
    return CATALOG.find(v => v.id === id);
  }

  function families() {
    const map = new Map();
    CATALOG.forEach(v => {
      if (!map.has(v.family)) map.set(v.family, { id: v.family, label: v.familyLabel, color: v.color, variants: [] });
      map.get(v.family).variants.push(v);
    });
    return Array.from(map.values());
  }

  /**
   * Build an independent dry/wet/compressor chain on any context.
   * Offline rendering needs its own graph — nodes can't cross contexts — and
   * the noise buffer has to be regenerated at that context's sample rate.
   */
  function createBuses(ac) {
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 3;
    comp.attack.value = 0.003; comp.release.value = 0.15;

    const dry = ac.createGain();
    dry.gain.value = 0.85;
    dry.connect(comp);

    const conv = ac.createConvolver();
    conv.buffer = buildImpulse(ac, 1.4, 2.2);
    const wet = ac.createGain();
    wet.gain.value = 0.16;
    wet.connect(conv);
    conv.connect(comp);

    return { dry, wet, output: comp, noise: buildNoiseBuffer(ac) };
  }

  /**
   * Trigger a voice into a specific set of buses rather than the live ones.
   * playVoice is synchronous all the way down, so swapping the module-level
   * targets around the call is safe and keeps every synth function unchanged.
   */
  function renderVoice(ac, buses, voiceId, t) {
    const v = voiceById(voiceId);
    if (!v) return;
    activeDry = buses.dry; activeWet = buses.wet; activeNoise = buses.noise;
    try {
      v.play(ac, t, buses.dry);
    } finally {
      activeDry = null; activeWet = null; activeNoise = null;
    }
  }

  function playVoice(voiceId, t) {
    const ac = ensureContext();
    if (!ac) return;
    const v = voiceById(voiceId);
    if (!v) return;
    v.play(ac, t, dryBus);
  }

  function createScheduler({ stepsPerLoop, getBpm, onStep, subdivision = 8 }) {
    let timerId = null;
    let running = false;
    let currentStep = 0;
    let nextStepTime = 0;
    const lookahead = 0.1;
    const interval = 25;

    function stepDuration() {
      const bpm = getBpm();
      const secPerBeat = 60 / bpm;
      return secPerBeat / (subdivision / 4);
    }

    function scheduleAhead() {
      const ac = ensureContext();
      if (!ac) return;
      while (nextStepTime < ac.currentTime + lookahead) {
        onStep(currentStep, nextStepTime);
        nextStepTime += stepDuration();
        currentStep = (currentStep + 1) % stepsPerLoop;
      }
    }

    return {
      start() {
        if (running) return;
        const ac = ensureContext();
        if (!ac) return;
        running = true;
        currentStep = 0;
        nextStepTime = ac.currentTime + 0.05;
        timerId = setInterval(scheduleAhead, interval);
      },
      stop() {
        running = false;
        if (timerId) clearInterval(timerId);
        timerId = null;
        currentStep = 0;
      },
      isRunning() { return running; }
    };
  }

  return {
    supported,
    ensureContext,
    adoptContext,
    createBuses,
    renderVoice,
    playVoice,
    createScheduler,
    CATALOG,
    families,
    voiceById
  };
})();
