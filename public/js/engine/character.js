// character.js — one-knob tone shaping for a track: "Warm", "Punchy",
// "Vocal: clean & present" …
//
// Underneath each one is what an engineer would reach for — EQ (low shelf,
// a mid bell, high shelf, high- and low-pass), a compressor with make-up gain,
// a touch of saturation and, for voices, a de-esser — but you only pick a
// flavour and turn AMOUNT up until it sounds right. Amount 0 is the track
// untouched; every setting scales from there, so there's no way to make it
// sound broken by accident.
//
// The chain sits in each mixer strip between the pump (duck) and the fader,
// and the export builds the same chain from the same numbers, so the .wav
// matches what you heard.

const Character = (() => {
  // Each preset at full amount. g = gain in dB, f = Hz.
  const PRESETS = [
    { id: 'none', label: 'Natural (off)', hint: 'The sound as it is.' },
    { id: 'warm', label: 'Warm', hint: 'Rounder lows, softer highs, gently glued — a cosy, vintage feel.',
      low: { f: 180, g: 4 }, high: { f: 6000, g: -4 }, comp: { thr: -18, ratio: 2.5, att: 0.02, rel: 0.25, make: 3 }, sat: 0.35 },
    { id: 'punchy', label: 'Punchy', hint: 'Harder, tighter hits that jump out — great on drums and bass.',
      hp: 30, low: { f: 90, g: 3 }, mid: { f: 380, g: -4, q: 1 }, high: { f: 4500, g: 2 },
      comp: { thr: -22, ratio: 4, att: 0.012, rel: 0.12, make: 5 } },
    { id: 'bright', label: 'Bright & clear', hint: 'More sparkle and air, less mud — cuts through the mix.',
      hp: 90, mid: { f: 300, g: -3, q: 0.9 }, high: { f: 5000, g: 6 }, comp: { thr: -14, ratio: 2, att: 0.01, rel: 0.2, make: 2 } },
    { id: 'heavy', label: 'Big & heavy', hint: 'More weight and grit — makes it sound bigger.',
      low: { f: 100, g: 6 }, mid: { f: 2500, g: 2, q: 0.8 }, comp: { thr: -24, ratio: 4, att: 0.02, rel: 0.2, make: 6 }, sat: 0.6 },
    { id: 'soft', label: 'Soft & smooth', hint: 'Takes the edge off — for keys or pads that feel harsh.',
      mid: { f: 3200, g: -4, q: 1 }, high: { f: 8000, g: -5 }, comp: { thr: -16, ratio: 2, att: 0.03, rel: 0.3, make: 2 } },
    { id: 'far', label: 'Far away', hint: 'Thin and distant — for background parts and intros.',
      hp: 380, lp: 4200, mid: { f: 1200, g: 2, q: 0.7 } },
    { id: 'lofi', label: 'Lo-fi / dusty', hint: 'Old-record sound — muffled and a bit crunchy.',
      hp: 120, lp: 3600, mid: { f: 1000, g: 2, q: 0.6 }, comp: { thr: -20, ratio: 3, att: 0.02, rel: 0.25, make: 4 }, sat: 0.55 },
    { id: 'radio', label: 'Telephone / radio', hint: 'Mids only — an effect for an ad-lib or a build.',
      hp: 600, lp: 3000, mid: { f: 1500, g: 5, q: 1 }, sat: 0.4 },
    { id: 'vocal', label: 'Vocal: clean & present', vocal: true, hint: 'Rumble cut, mud cut, "s" sounds tamed, levels evened, brought forward — the usual starting point for a voice.',
      hp: 90, mid: { f: 320, g: -3, q: 1 }, high: { f: 4500, g: 3 }, deess: { f: 6000, thr: -32 },
      comp: { thr: -24, ratio: 3.5, att: 0.008, rel: 0.15, make: 6 } },
    { id: 'vocal-rap', label: 'Vocal: rap / punchy', vocal: true, hint: 'Tighter and more aggressive — the voice sits right on top of the beat.',
      hp: 110, mid: { f: 2800, g: 3, q: 0.9 }, high: { f: 7000, g: 2 }, deess: { f: 6500, thr: -30 },
      comp: { thr: -28, ratio: 5, att: 0.004, rel: 0.1, make: 9 }, sat: 0.2 },
    { id: 'vocal-smooth', label: 'Vocal: smooth R&B', vocal: true, hint: 'Warm body, silky top, softer "s" — for singing.',
      hp: 80, low: { f: 220, g: 2 }, mid: { f: 3200, g: -2, q: 1 }, high: { f: 10000, g: 3 }, deess: { f: 5500, thr: -34 },
      comp: { thr: -22, ratio: 3, att: 0.015, rel: 0.25, make: 5 } }
  ];
  const byId = (id) => PRESETS.find(p => p.id === id) || PRESETS[0];

  const curves = new Map();
  function satCurve(k) {
    const key = Math.round(k * 100);
    if (curves.has(key)) return curves.get(key);
    const c = new Float32Array(2048);
    const d = 1 + k * 8;
    for (let i = 0; i < c.length; i++) { const x = i / (c.length - 1) * 2 - 1; c[i] = Math.tanh(d * x) / Math.tanh(d); }
    curves.set(key, c);
    return c;
  }

  const lerp = (a, b, k) => a + (b - a) * k;
  const logLerp = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));

  /** The numbers every node gets for a preset at an amount (0–1). */
  function settings(id, amount) {
    const p = byId(id), k = Math.max(0, Math.min(1, amount == null ? 0.6 : amount));
    return {
      hp: p.hp ? logLerp(20, p.hp, k) : 20,
      lp: p.lp ? logLerp(20000, p.lp, k) : 20000,
      low: { f: p.low ? p.low.f : 150, g: p.low ? p.low.g * k : 0 },
      mid: { f: p.mid ? p.mid.f : 1000, g: p.mid ? p.mid.g * k : 0, q: p.mid ? p.mid.q : 1 },
      high: { f: p.high ? p.high.f : 6000, g: p.high ? p.high.g * k : 0 },
      comp: p.comp ? { thr: lerp(0, p.comp.thr, k), ratio: lerp(1, p.comp.ratio, k), att: p.comp.att, rel: p.comp.rel, make: p.comp.make * k }
                   : { thr: 0, ratio: 1, att: 0.01, rel: 0.2, make: 0 },
      sat: (p.sat || 0) * k,
      deess: p.deess ? { f: p.deess.f, thr: lerp(0, p.deess.thr, k), ratio: lerp(1, 8, k) } : null
    };
  }

  /**
   * Build the chain in any context. Returns { input, output, set(amount),
   * dispose() } — or null for "none", meaning: connect straight through.
   */
  function build(ac, id, amount) {
    const p = byId(id);
    if (p.id === 'none') return null;
    const s0 = settings(id, amount);
    const bq = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
    const input = ac.createGain();
    const hp = bq('highpass', s0.hp, 0.7071);
    const low = bq('lowshelf', s0.low.f);
    const mid = bq('peaking', s0.mid.f, s0.mid.q);
    const high = bq('highshelf', s0.high.f);
    const lp = bq('lowpass', s0.lp, 0.7071);
    input.connect(hp).connect(low).connect(mid).connect(high).connect(lp);

    // De-esser: split at the "s" range with a Linkwitz-Riley crossover (the two
    // halves add back up flat), squash only the top half, put them back together.
    let last = lp, de = null;
    if (s0.deess) {
      const sum = ac.createGain();
      const lo1 = bq('lowpass', s0.deess.f, 0.7071), lo2 = bq('lowpass', s0.deess.f, 0.7071);
      const hi1 = bq('highpass', s0.deess.f, 0.7071), hi2 = bq('highpass', s0.deess.f, 0.7071);
      de = ac.createDynamicsCompressor();
      de.knee.value = 3; de.attack.value = 0.002; de.release.value = 0.06;
      lp.connect(lo1).connect(lo2).connect(sum);
      lp.connect(hi1).connect(hi2).connect(de).connect(sum);
      last = sum;
    }

    const comp = ac.createDynamicsCompressor();
    comp.knee.value = 6;
    const make = ac.createGain();
    last.connect(comp).connect(make);

    // Saturation as a parallel blend, so a little goes a long way.
    const output = ac.createGain();
    const dry = ac.createGain(), wet = ac.createGain(), shaper = ac.createWaveShaper();
    shaper.oversample = '2x';
    make.connect(dry).connect(output);
    make.connect(shaper).connect(wet).connect(output);

    function apply(s) {
      hp.frequency.value = s.hp; lp.frequency.value = s.lp;
      low.frequency.value = s.low.f; low.gain.value = s.low.g;
      mid.frequency.value = s.mid.f; mid.gain.value = s.mid.g; mid.Q.value = s.mid.q;
      high.frequency.value = s.high.f; high.gain.value = s.high.g;
      comp.threshold.value = s.comp.thr; comp.ratio.value = s.comp.ratio;
      comp.attack.value = s.comp.att; comp.release.value = s.comp.rel;
      // The compressor turns loud parts down; make-up brings the whole thing
      // back up — but only part-way, so turning Amount up doesn't just mean "louder".
      make.gain.value = Math.pow(10, (s.comp.make * 0.75) / 20);
      if (de && s.deess) { de.threshold.value = s.deess.thr; de.ratio.value = s.deess.ratio; }
      shaper.curve = satCurve(s.sat);
      wet.gain.value = s.sat * 0.6;
      dry.gain.value = 1 - s.sat * 0.35;
    }
    apply(s0);

    return {
      input, output, id: p.id,
      set(amount2) { apply(settings(p.id, amount2)); },
      dispose() { try { input.disconnect(); output.disconnect(); } catch (_) {} }
    };
  }

  return {
    PRESETS, build, settings,
    list: (vocalFirst) => {
      const l = PRESETS.map(p => ({ id: p.id, label: p.label, hint: p.hint, vocal: !!p.vocal }));
      return vocalFirst ? l.filter(p => p.id === 'none').concat(l.filter(p => p.vocal), l.filter(p => !p.vocal && p.id !== 'none')) : l;
    },
    label: (id) => byId(id).label,
    hint: (id) => byId(id).hint
  };
})();
