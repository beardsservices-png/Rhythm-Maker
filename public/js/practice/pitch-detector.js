// pitch-detector.js — monophonic pitch tracking for Practice Mode.
//
// Algorithm: McLeod Pitch Method (NSDF + key-maximum picking). Chosen over the
// plain autocorrelation in the original flute prototype because a 12-year-old
// beginner is breathy and unsteady, and MPM gives two things that matters for
// that: a real 0..1 "clarity" number we can gate on, and far fewer octave
// errors (raw autocorrelation loves to report the note an octave too low).
//
// Standalone — no DOM. MicSource owns getUserMedia + the analyser loop;
// detectPitch is pure; HoldGate turns "is it matching right now" into "they
// held it long enough." The Rhythm Maker DAW can reuse any of the three.

const PitchDetector = (() => {

  // ---- Pure: one analysis window -> { freq, clarity, rms } -------------------
  function detectPitch(buf, sampleRate, minLag, maxLag) {
    const n = buf.length;
    maxLag = Math.min(maxLag | 0, n - 2);
    minLag = Math.max(2, minLag | 0);

    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i];
    const rms = Math.sqrt(sumSq / n);
    if (rms < 0.006) return { freq: 0, clarity: 0, rms };

    // Normalised square difference function, 0..maxLag.
    const nsdf = new Float32Array(maxLag + 1);
    for (let tau = 0; tau <= maxLag; tau++) {
      let ac = 0, m = 0;
      for (let i = 0; i < n - tau; i++) {
        const a = buf[i], b = buf[i + tau];
        ac += a * b;
        m += a * a + b * b;
      }
      nsdf[tau] = m > 0 ? (2 * ac) / m : 0;
    }

    // Key maxima: the single highest point in each positive hump of the NSDF,
    // after the tau=0 lobe has crossed zero.
    const maxima = [];
    let tau = 1;
    while (tau <= maxLag && nsdf[tau] > 0) tau++;      // skip zero-lag lobe
    while (tau <= maxLag) {
      while (tau <= maxLag && nsdf[tau] <= 0) tau++;   // into the next hump
      if (tau > maxLag) break;
      let peak = tau, peakVal = nsdf[tau];
      while (tau <= maxLag && nsdf[tau] > 0) {
        if (nsdf[tau] > peakVal) { peakVal = nsdf[tau]; peak = tau; }
        tau++;
      }
      if (peak >= minLag) maxima.push(peak);
    }
    if (!maxima.length) return { freq: 0, clarity: 0, rms };

    let globalMax = 0;
    for (const t of maxima) if (nsdf[t] > globalMax) globalMax = nsdf[t];
    if (globalMax < 0.5) return { freq: 0, clarity: globalMax, rms };

    // First key maximum within 90% of the tallest one — this is the step that
    // stops us picking a sub-octave whose peak is a hair taller.
    const threshold = 0.9 * globalMax;
    let chosen = maxima[0];
    for (const t of maxima) { if (nsdf[t] >= threshold) { chosen = t; break; } }

    // Parabolic interpolation for sub-sample period accuracy.
    const x0 = nsdf[chosen - 1], x1 = nsdf[chosen], x2 = nsdf[chosen + 1];
    const a = (x0 + x2 - 2 * x1) / 2;
    const b = (x2 - x0) / 2;
    let period = chosen, clarity = x1;
    if (a < 0) {
      const shift = -b / (2 * a);
      if (Math.abs(shift) <= 1) { period = chosen + shift; clarity = x1 - (b * b) / (8 * a); }
    }
    if (period <= 0) return { freq: 0, clarity: 0, rms };
    return { freq: sampleRate / period, clarity: Math.max(0, Math.min(1, clarity)), rms };
  }

  // ---- Median-of-recent smoothing, so the tuner needle doesn't jitter -------
  function createSmoother(size = 5) {
    const hist = [];
    return {
      push(freq) {
        hist.push(freq);
        if (hist.length > size) hist.shift();
        const sorted = hist.slice().sort((p, q) => p - q);
        return sorted[sorted.length >> 1];
      },
      reset() { hist.length = 0; },
    };
  }

  // ---- "Matching right now" -> "held it long enough" -----------------------
  // graceMs lets the tone crack or waver briefly without dropping progress —
  // beginners never sustain a clean note, and resetting on every wobble makes
  // the game feel broken.
  function createHoldGate({ holdMs = 450, graceMs = 140 } = {}) {
    let since = 0, lastMatch = 0, complete = false;
    return {
      setHoldMs(ms) { holdMs = Math.max(80, ms); },
      reset() { since = 0; lastMatch = 0; complete = false; },
      update(matched, now) {
        if (matched) {
          lastMatch = now;
          if (since === 0) since = now;
        } else if (since !== 0 && now - lastMatch > graceMs) {
          since = 0;
        }
        const progress = since === 0 ? 0 : Math.min(1, (now - since) / holdMs);
        const justCompleted = !complete && progress >= 1;
        if (justCompleted) complete = true;
        return { progress, justCompleted, complete };
      },
    };
  }

  // ---- Microphone source + RAF analysis loop ------------------------------
  function micErrorMessage(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'The microphone is blocked. Click the 🎤 or 🔒 icon next to the web address, ' +
             'choose “Allow” for the microphone, then press Start again.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No microphone found. Plug one in (or check your computer’s sound settings) and try again.';
    }
    if (name === 'NotReadableError') {
      return 'Another program is using the microphone. Close it (Zoom, Meet, Teams…) and try again.';
    }
    return 'Could not turn the microphone on. Try Chrome or Firefox, and make sure the page is on https.';
  }

  function createMicSource({ fftSize = 2048, onBuffer }) {
    let ctx = null, stream = null, analyser = null, raf = 0, buf = null, running = false;

    async function start() {
      if (running) return { ok: true };
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return { ok: false, error: 'This browser has no Web Audio — try Chrome, Edge, or Firefox.' };
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { ok: false, error: 'This browser can’t reach the microphone. Try Chrome or Firefox on a computer.' };
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (err) {
        return { ok: false, error: micErrorMessage(err) };
      }
      ctx = new AC();
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* keep going */ } }
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = 0;
      src.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      running = true;

      const tick = () => {
        if (!running) return;
        analyser.getFloatTimeDomainData(buf);
        onBuffer(buf, ctx.sampleRate, performance.now());
        raf = requestAnimationFrame(tick);
      };
      tick();
      return { ok: true };
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ctx) ctx.close().catch(() => {});
      ctx = stream = analyser = buf = null;
    }

    return {
      start, stop,
      isRunning: () => running,
      get sampleRate() { return ctx ? ctx.sampleRate : 44100; },
      getContext: () => ctx,
    };
  }

  return { detectPitch, createSmoother, createHoldGate, createMicSource, micErrorMessage };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PitchDetector;
