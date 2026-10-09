// tune.js — pitch correction for a recorded voice (what people call
// auto-tune), done once on the take rather than live.
//
//   1. Track the pitch every ~12 ms (McLeod method, from Practice Mode's
//      pitch-detector.js, on a half-rate copy to keep it quick).
//   2. Work out the nearest note that fits — the song's key if it has one,
//      otherwise any semitone — and how far off the singer is.
//   3. Re-pitch with PSOLA: chop the voice into two-cycle grains, one per
//      vocal-cord pulse, and lay them back down closer together (sharper) or
//      further apart (flatter). Timing and the voice's character stay put;
//      only the pitch moves. Breaths and "s" sounds aren't pitched and pass
//      through untouched.
//
// STRENGTH 0–1 is how far toward the note to pull. SPEED is how fast it gets
// there: "natural" glides (~60 ms, keeps vibrato) and "hard" snaps instantly —
// the robotic T-Pain effect.

const Tune = (() => {
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const MODES = {
    natural: { strength: 0.8, glide: 0.06 },
    hard: { strength: 1, glide: 0.0 }
  };

  /** Pitch per frame (Hz, 0 = not a pitched sound). */
  function track(x, rate, hop) {
    const half = new Float32Array(Math.floor(x.length / 2));
    for (let i = 0; i < half.length; i++) half[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
    const r2 = rate / 2, win = 512, h2 = hop / 2;
    const minLag = Math.floor(r2 / 1100), maxLag = Math.ceil(r2 / 70);
    const frames = Math.ceil(x.length / hop);
    const f0 = new Float32Array(frames);
    const buf = new Float32Array(win);
    for (let k = 0; k < frames; k++) {
      const c = Math.round(k * h2) - win / 2;
      for (let i = 0; i < win; i++) { const j = c + i; buf[i] = j >= 0 && j < half.length ? half[j] : 0; }
      const r = PitchDetector.detectPitch(buf, r2, minLag, maxLag);
      f0[k] = r.freq > 0 && r.clarity > 0.8 ? r.freq : 0;
    }
    // A lone voiced or unvoiced frame is almost always a mis-read.
    for (let k = 1; k < frames - 1; k++) {
      if (f0[k] && !f0[k - 1] && !f0[k + 1]) f0[k] = 0;
    }
    return f0;
  }

  /** The note a pitch should land on (fractional MIDI in, whole MIDI out). */
  function snap(m, key) {
    if (!key) return Math.round(m);
    const pcs = SCALES[key.scale].map(i => (i + key.root) % 12);
    let best = Math.round(m), d = Infinity;
    for (let c = Math.floor(m) - 2; c <= Math.ceil(m) + 2; c++) {
      if (!pcs.includes(((c % 12) + 12) % 12)) continue;
      if (Math.abs(c - m) < d) { d = Math.abs(c - m); best = c; }
    }
    return best;
  }

  /** Per-frame pitch ratio to apply (1 = leave it). */
  function ratios(f0, hopSec, key, mode) {
    const cfg = MODES[mode] || MODES.natural;
    const out = new Float32Array(f0.length).fill(1);
    // Correct toward the note of a lightly smoothed pitch, so vibrato around a
    // note is pulled in rather than flattened into steps.
    let shift = 0;
    const a = cfg.glide > 0 ? 1 - Math.exp(-hopSec / cfg.glide) : 1;
    for (let k = 0; k < f0.length; k++) {
      if (!f0[k]) { shift = 0; continue; }
      let sum = 0, n = 0;
      for (let j = Math.max(0, k - 3); j <= Math.min(f0.length - 1, k + 3); j++) if (f0[j]) { sum += 69 + 12 * Math.log2(f0[j] / 440); n++; }
      const avg = sum / n;
      const m = 69 + 12 * Math.log2(f0[k] / 440);
      const want = (snap(avg, key) - (cfg.glide > 0 ? avg : m)) * cfg.strength;
      shift += (want - shift) * a;
      out[k] = Math.pow(2, shift / 12);
    }
    return out;
  }

  /** PSOLA re-pitch of one channel. */
  function psola(x, rate, f0, ratio, hop) {
    const N = x.length;
    const Pu = Math.round(rate * 0.005);       // grain spacing for unpitched sound
    const frameAt = (i) => Math.min(f0.length - 1, Math.max(0, Math.round(i / hop)));
    // analysis marks: one per pitch period, nudged onto the waveform's peak so
    // the grains line up cycle to cycle
    const marks = [];
    let t = 0, prevVoiced = false;
    while (t < N) {
      const f = f0[frameAt(t)];
      const P = f ? Math.max(16, Math.round(rate / f)) : Pu;
      let at = t;
      if (f && prevVoiced) {
        let best = -Infinity;
        const r = Math.round(P / 4);
        for (let j = Math.max(0, t - r); j <= Math.min(N - 1, t + r); j++) if (x[j] > best) { best = x[j]; at = j; }
      }
      marks.push({ t: at, P, r: f ? ratio[frameAt(at)] : 1 });
      prevVoiced = !!f;
      t = at + P;
    }
    const y = new Float32Array(N), w = new Float32Array(N);
    let k = 0, ts = 0;
    while (ts < N && marks.length) {
      while (k < marks.length - 1 && Math.abs(marks[k + 1].t - ts) <= Math.abs(marks[k].t - ts)) k++;
      const m = marks[k];
      const L = m.P;
      for (let i = -L; i < L; i++) {
        const src = m.t + i, dst = Math.round(ts) + i;
        if (src < 0 || src >= N || dst < 0 || dst >= N) continue;
        const win = 0.5 + 0.5 * Math.cos(Math.PI * i / L);
        y[dst] += x[src] * win;
        w[dst] += win;
      }
      ts += m.P / m.r;
    }
    for (let i = 0; i < N; i++) y[i] = w[i] > 0.15 ? y[i] / w[i] : x[i];
    return y;
  }

  /**
   * Correct a recording. Returns a new AudioBuffer (made with `ac`).
   * opts: { key: {root, scale} | null, mode: 'natural' | 'hard' }
   */
  function process(ac, buffer, opts) {
    const o = opts || {};
    const rate = buffer.sampleRate;
    const hop = Math.round(rate * 0.0116);
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const mono = new Float32Array(buffer.length);
    chans.forEach(ch => { for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / chans.length; });
    const f0 = track(mono, rate, hop);
    const ratio = ratios(f0, hop / rate, o.key || null, o.mode);
    const out = ac.createBuffer(buffer.numberOfChannels, buffer.length, rate);
    chans.forEach((ch, c) => out.copyToChannel(psola(ch, rate, f0, ratio, hop), c));
    const voiced = f0.reduce((n, f) => n + (f ? 1 : 0), 0);
    return { buffer: out, voicedShare: voiced / f0.length };
  }

  return { process, snap, MODES };
})();
