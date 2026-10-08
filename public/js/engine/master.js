// master.js — measure the finished mix, then correct it.
//
// This is what "AI mastering" services actually do underneath: analyse the
// mix, decide a few corrective moves, apply them, and land on a target
// loudness. The useful part is the measurement, not the branding — so nothing
// here guesses. Every move is derived from a number taken off the audio, and
// the report says exactly what changed and by how much.
//
// Deliberately conservative. Corrections cap at ±4 dB per band: a mastering
// pass should improve a mix, and a big EQ move on a mix that was already fine
// does more harm than leaving it alone. If a band is close to target it isn't
// touched at all.

const Mastering = (() => {

  const toDb = (x) => 20 * Math.log10(Math.max(1e-9, x));
  const fromDb = (db) => Math.pow(10, db / 20);

  /**
   * Split energy into low/mid/high with simple one-pole filters.
   *
   * An FFT would be more precise, but the question here is only "is this
   * bass-heavy or harsh", and a one-pole answers that in one cheap pass over
   * the samples instead of an extra offline render per band.
   */
  function bandEnergy(data, sampleRate) {
    const kLow = Math.exp(-2 * Math.PI * 200 / sampleRate);
    const kHigh = Math.exp(-2 * Math.PI * 4000 / sampleRate);
    let lp1 = 0, lp2 = 0;
    let low = 0, mid = 0, high = 0;

    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      lp1 = x * (1 - kLow) + lp1 * kLow;      // below 200Hz
      lp2 = x * (1 - kHigh) + lp2 * kHigh;    // below 4kHz
      const l = lp1;
      const m = lp2 - lp1;                    // 200Hz - 4kHz
      const h = x - lp2;                      // above 4kHz
      low += l * l; mid += m * m; high += h * h;
    }
    const total = low + mid + high || 1;
    return { low: low / total, mid: mid / total, high: high / total };
  }

  function analyze(buffer) {
    const n = buffer.length;
    let peak = 0, sumSq = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        sumSq += d[i] * d[i];
      }
    }
    const rms = Math.sqrt(sumSq / (n * buffer.numberOfChannels));
    const bands = bandEnergy(buffer.getChannelData(0), buffer.sampleRate);

    return {
      peak, peakDb: toDb(peak),
      rms, rmsDb: toDb(rms),
      // Crest factor — the gap between peak and average. A big gap means a
      // dynamic mix with room to be brought up; a small one is already dense.
      crestDb: toDb(peak) - toDb(rms),
      bands
    };
  }

  // Rough targets for a modern electronic mix. Not laws — starting points
  // that keep a track from being obviously bass-heavy or obviously harsh.
  const TARGET = { low: 0.46, mid: 0.40, high: 0.14 };
  const TARGET_RMS_DB = -14;   // roughly where streaming services land
  const MAX_CORRECTION_DB = 4;

  function decide(a) {
    const moves = {};
    const band = (name, freqLabel) => {
      const have = a.bands[name];
      const want = TARGET[name];
      // Ratio in dB. Deadband of 1dB: if it's close, leave it alone.
      const db = toDb(Math.sqrt(want / Math.max(1e-6, have)));
      const clamped = Math.max(-MAX_CORRECTION_DB, Math.min(MAX_CORRECTION_DB, db));
      moves[name] = Math.abs(clamped) < 1 ? 0 : clamped;
    };
    band('low'); band('mid'); band('high');

    // Compression only earns its place on a mix that's actually dynamic.
    // Squashing an already-dense track just makes it smaller.
    moves.compress = a.crestDb > 14;
    moves.gainDb = TARGET_RMS_DB - a.rmsDb;
    return moves;
  }

  // ── styles: what "mastered" should sound like ──
  //
  // clean — only corrective EQ and level (the original behaviour).
  // deep  — the "depth" people ask for: weight in the low end (sub kept mono so
  //         it hits hard on speakers), a touch of harmonic warmth, a wider stereo
  //         image above the bass, gentle glue compression and a bit of air.
  // loud  — the same, pushed harder for a competitive, in-your-face level.
  const STYLES = {
    clean: { label: 'Clean', target: -14, low: 0, air: 0, warmth: 0, width: 1, glue: null },
    deep:  { label: 'Deep & warm', target: -12, low: 2.5, air: 1, warmth: 0.18, width: 1.3,
             glue: { threshold: -16, ratio: 2, attack: 0.02, release: 0.25 } },
    loud:  { label: 'Loud', target: -9.5, low: 1.5, air: 2, warmth: 0.25, width: 1.15,
             glue: { threshold: -18, ratio: 3, attack: 0.01, release: 0.18 } }
  };

  const satCurve = (() => {
    const c = new Float32Array(2048);
    for (let i = 0; i < c.length; i++) { const x = i / (c.length - 1) * 2 - 1; c[i] = Math.tanh(1.8 * x) / Math.tanh(1.8); }
    return c;
  })();

  /**
   * Lookahead brickwall limiter on the finished samples (stereo-linked).
   * Forward min-filter of the gain each sample needs, then a box filter of the
   * same length — which guarantees the gain is already down when the peak
   * arrives — then a smooth release. Returns the deepest reduction in dB.
   */
  function limit(buffer, ceiling) {
    const n = buffer.length, sr = buffer.sampleRate;
    const L = Math.max(1, Math.round(sr * 0.005));
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const req = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let p = 0; for (const d of chans) { const a = Math.abs(d[i]); if (a > p) p = a; }
      req[i] = p > ceiling ? ceiling / p : 1;
    }
    // forward-looking min over [i, i+L-1] with a monotonic deque
    const m = new Float32Array(n);
    const dq = new Int32Array(n); let h = 0, t = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (t > h && req[dq[t - 1]] >= req[i]) t--;
      dq[t++] = i;
      while (dq[h] > i + L - 1) h++;
      m[i] = req[dq[h]];
    }
    // trailing box filter, then release
    const rel = Math.exp(-1 / (sr * 0.12));
    let sum = 0, g = 1, minG = 1;
    for (let i = 0; i < n; i++) {
      sum += m[i]; if (i >= L) sum -= m[i - L];
      const boxed = sum / Math.min(i + 1, L);
      g = boxed < g ? boxed : boxed - (boxed - g) * rel;
      if (g < minG) minG = g;
      for (const d of chans) d[i] = Math.max(-ceiling, Math.min(ceiling, d[i] * g));
    }
    return toDb(minG);
  }

  /**
   * Render the buffer through the mastering chain.
   * opts.style: 'clean' | 'deep' | 'loud' (default 'deep').
   * Returns { buffer, report } — report is plain English, in dB.
   */
  async function master(buffer, opts = {}) {
    const style = STYLES[opts.style] || STYLES.deep;
    const before = analyze(buffer);
    const moves = decide(before);

    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ch = buffer.numberOfChannels;
    const oac = new OAC(ch, buffer.length, buffer.sampleRate);
    const src = oac.createBufferSource();
    src.buffer = buffer;

    const biquad = (type, f, gain, q) => {
      const b = oac.createBiquadFilter(); b.type = type; b.frequency.value = f;
      if (gain != null) b.gain.value = gain; if (q != null) b.Q.value = q; return b;
    };
    // corrective EQ (measured) + the style's colour
    let node = src
      .connect(biquad('lowshelf', 200, moves.low))
      .connect(biquad('peaking', 1200, moves.mid, 0.7))
      .connect(biquad('highshelf', 4000, moves.high));
    if (style.low) node = node.connect(biquad('lowshelf', 95, style.low));
    if (style.air) node = node.connect(biquad('highshelf', 11000, style.air));

    // warmth: a little saturated signal blended under the clean one
    if (style.warmth) {
      const sum = oac.createGain();
      const dry = oac.createGain(); dry.gain.value = 1 - style.warmth * 0.5;
      const pre = oac.createGain(); pre.gain.value = 1.6;
      const sh = oac.createWaveShaper(); sh.curve = satCurve; sh.oversample = '4x';
      const wet = oac.createGain(); wet.gain.value = style.warmth;
      node.connect(dry).connect(sum);
      node.connect(pre).connect(sh).connect(wet).connect(sum);
      node = sum;
    }

    // width: mid/side, widening only the sides above ~150 Hz so the bass stays centred
    if (ch === 2 && style.width !== 1) {
      const split = oac.createChannelSplitter(2), merge = oac.createChannelMerger(2);
      node.connect(split);
      const mid = oac.createGain(), side = oac.createGain();
      const lToMid = oac.createGain(); lToMid.gain.value = 0.5;
      const rToMid = oac.createGain(); rToMid.gain.value = 0.5;
      const lToSide = oac.createGain(); lToSide.gain.value = 0.5;
      const rToSide = oac.createGain(); rToSide.gain.value = -0.5;
      split.connect(lToMid, 0); split.connect(rToMid, 1);
      split.connect(lToSide, 0); split.connect(rToSide, 1);
      lToMid.connect(mid); rToMid.connect(mid);
      lToSide.connect(side); rToSide.connect(side);
      const sideHp = biquad('highpass', 150, null, 0.7);
      const sideAmt = oac.createGain(); sideAmt.gain.value = style.width;
      side.connect(sideHp).connect(sideAmt);
      const sideNeg = oac.createGain(); sideNeg.gain.value = -1;
      // L = M + S, R = M − S
      mid.connect(merge, 0, 0); sideAmt.connect(merge, 0, 0);
      mid.connect(merge, 0, 1); sideAmt.connect(sideNeg).connect(merge, 0, 1);
      node = merge;
    }

    const glue = style.glue || (moves.compress ? { threshold: -18, ratio: 2.5, attack: 0.008, release: 0.18 } : null);
    if (glue) {
      const comp = oac.createDynamicsCompressor();
      comp.threshold.value = glue.threshold; comp.knee.value = 6; comp.ratio.value = glue.ratio;
      comp.attack.value = glue.attack; comp.release.value = glue.release;
      node = node.connect(comp);
    }
    node.connect(oac.destination);
    src.start(0);
    const rendered = await oac.startRendering();

    // Level: bring it to the style's loudness, then a true lookahead limiter
    // holds the peaks under the ceiling. If the limiter ate some of the level,
    // one more nudge makes up the shortfall.
    const ceiling = opts.ceiling == null ? 0.89 : opts.ceiling;     // about −1 dB
    const scaleAll = (b, g) => { for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } };
    const copyOf = (b) => { const o = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate }); for (let c = 0; c < b.numberOfChannels; c++) o.copyToChannel(b.getChannelData(c), c); return o; };
    const mid = analyze(rendered);
    let gainDb = Math.max(-12, Math.min(18, style.target - mid.rmsDb));
    let out = copyOf(rendered);
    scaleAll(out, fromDb(gainDb));
    let limitDb = limit(out, ceiling);
    const short = style.target - analyze(out).rmsDb;
    if (short > 1 && gainDb < 18) {
      gainDb = Math.min(18, gainDb + Math.min(6, short));
      out = copyOf(rendered);
      scaleAll(out, fromDb(gainDb));
      limitDb = limit(out, ceiling);
    }

    const after = analyze(out);
    const notes = [];
    const say = (name, label) => { if (moves[name]) notes.push(`${label} ${moves[name] > 0 ? '+' : ''}${moves[name].toFixed(1)}dB`); };
    say('low', 'bass'); say('mid', 'mids'); say('high', 'treble');
    if (style.low) notes.push(`low-end weight +${style.low}dB`);
    if (style.warmth) notes.push('warmth');
    if (style.width !== 1) notes.push(`stereo ${Math.round((style.width - 1) * 100)}% wider (bass kept centred)`);
    if (style.air) notes.push(`air +${style.air}dB`);
    if (glue) notes.push('glue compression');
    const lift = after.rmsDb - before.rmsDb;
    if (Math.abs(lift) >= 0.5) notes.push(`level ${lift > 0 ? '+' : ''}${lift.toFixed(1)}dB`);
    if (limitDb < -0.3) notes.push(`limiter caught peaks by ${Math.abs(limitDb).toFixed(1)}dB`);

    return {
      buffer: out,
      report: {
        style: style.label, before, after, moves, limitDb,
        summary: `${style.label}: ` + (notes.length ? notes.join(', ') : 'already balanced — left alone')
      }
    };
  }

  return { analyze, decide, master, limit, STYLES, TARGET, TARGET_RMS_DB };
})();
