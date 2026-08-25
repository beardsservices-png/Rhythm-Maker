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

  /**
   * Render the buffer through a corrective chain.
   * Returns { buffer, report } — report is plain English, in dB.
   */
  async function master(buffer, opts = {}) {
    const before = analyze(buffer);
    const moves = decide(before);

    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oac = new OAC(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    const src = oac.createBufferSource();
    src.buffer = buffer;

    const lowShelf = oac.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 200;
    lowShelf.gain.value = moves.low;

    const midPeak = oac.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = 1200;
    midPeak.Q.value = 0.7;
    midPeak.gain.value = moves.mid;

    const highShelf = oac.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 4000;
    highShelf.gain.value = moves.high;

    let node = src.connect(lowShelf).connect(midPeak).connect(highShelf);

    if (moves.compress) {
      const comp = oac.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 6;
      comp.ratio.value = 2.5;      // gentle glue, not squashing
      comp.attack.value = 0.008;   // slow enough to let transients through
      comp.release.value = 0.18;
      node = node.connect(comp);
    }

    const makeup = oac.createGain();
    // The full move toward target, not a fraction of it. Holding back would
    // make sense if a compressor were setting the ceiling — it can overshoot,
    // so you leave it room. Here the ceiling is exact arithmetic applied to
    // the finished samples, so asking for the whole correction is safe: if it
    // turns out too hot, the peak scale below takes it straight back.
    makeup.gain.value = fromDb(Math.max(-12, Math.min(12, moves.gainDb)));
    node = node.connect(makeup);

    node.connect(oac.destination);
    src.start(0);

    const rendered = await oac.startRendering();

    // The final ceiling is set by arithmetic, not by a compressor. A
    // DynamicsCompressorNode has no lookahead and can overshoot, so it can
    // never actually promise a peak — scaling the finished samples can.
    const ceiling = opts.ceiling == null ? 0.97 : opts.ceiling;
    let peak = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const d = rendered.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const x = Math.abs(d[i]);
        if (x > peak) peak = x;
      }
    }
    let limitDb = 0;
    if (peak > ceiling) {
      const g = ceiling / peak;
      limitDb = toDb(g);
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const d = rendered.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] *= g;
      }
    }

    const after = analyze(rendered);

    const notes = [];
    const say = (name, label) => {
      if (moves[name]) notes.push(`${label} ${moves[name] > 0 ? '+' : ''}${moves[name].toFixed(1)}dB`);
    };
    say('low', 'bass');
    say('mid', 'mids');
    say('high', 'treble');
    if (moves.compress) notes.push('gentle compression');
    const lift = after.rmsDb - before.rmsDb;
    if (Math.abs(lift) >= 0.5) notes.push(`level ${lift > 0 ? '+' : ''}${lift.toFixed(1)}dB`);
    if (limitDb < -0.05) notes.push(`peak pulled back ${Math.abs(limitDb).toFixed(1)}dB`);

    return {
      buffer: rendered,
      report: {
        before, after, moves, limitDb,
        summary: notes.length ? notes.join(', ') : 'already balanced — left alone'
      }
    };
  }

  return { analyze, decide, master, TARGET, TARGET_RMS_DB };
})();
