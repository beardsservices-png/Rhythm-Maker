// samples.js — the recorded instruments and drum hits.
//
// The synth recipes in instruments.js and drumkits.js are fine for 808s, pads
// and leads, but a piano, strings or a real snare made from oscillators sounds
// like a toy next to a recording. These are real recordings (free to share —
// see SAMPLE_MANIFEST.credits), a few notes per instrument; the notes in
// between are the nearest recording played a little faster or slower.
//
// Loading is lazy: an instrument's files are fetched the first time a track
// uses it. Until they arrive the caller plays its synth stand-in, so pressing
// Play never waits on the network and never goes silent. Decoded buffers work
// in any audio context, so the offline export uses the very same recordings.

const Samples = (() => {
  const BASE = 'samples/';
  const M = typeof SAMPLE_MANIFEST !== 'undefined' ? SAMPLE_MANIFEST : { instruments: {}, drums: {}, credits: [] };
  const buffers = new Map();      // key -> AudioBuffer
  const loading = new Map();      // key -> Promise
  const listeners = new Set();

  function ctx() { return typeof Synth808 !== 'undefined' ? Synth808.ensureContext() : null; }

  function decode(ac, data) {
    // Older Safari only has the callback form.
    return new Promise((res, rej) => {
      const p = ac.decodeAudioData(data, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  function fetchOne(key, url) {
    if (buffers.has(key)) return Promise.resolve(buffers.get(key));
    if (loading.has(key)) return loading.get(key);
    const ac = ctx();
    if (!ac || typeof fetch === 'undefined') return Promise.resolve(null);
    const p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.arrayBuffer(); })
      .then(data => decode(ac, data))
      .then(buf => { buffers.set(key, buf); loading.delete(key); return buf; })
      .catch(e => { loading.delete(key); console.warn('sample', key, e && e.message); return null; });
    loading.set(key, p);
    return p;
  }

  const instKey = (id, midi) => id + '/' + midi;
  const drumKey = (name) => 'drums/' + name;

  function hasInstrument(id) { return !!M.instruments[id]; }
  function instrumentReady(id) {
    const notes = M.instruments[id];
    return !!notes && notes.every(m => buffers.has(instKey(id, m)));
  }
  /** Fetch every note of an instrument. Resolves true once all are in. */
  function loadInstrument(id) {
    const notes = M.instruments[id];
    if (!notes) return Promise.resolve(false);
    return Promise.all(notes.map(m => fetchOne(instKey(id, m), BASE + id + '/' + m + '.mp3')))
      .then(list => { const ok = list.every(Boolean); if (ok) emit(id); return ok; });
  }

  function hasDrum(name) { return M.drums[name] != null; }
  function drumReady(name) { return buffers.has(drumKey(name)); }
  function loadDrum(name) {
    if (!hasDrum(name)) return Promise.resolve(false);
    return fetchOne(drumKey(name), BASE + 'drums/' + name + '.mp3').then(b => { if (b) emit(name); return !!b; });
  }

  function emit(what) { listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); }
  function onLoad(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** Nearest recorded note to `midi` (ties go to the one below — shifting up sounds more natural). */
  function nearest(id, midi) {
    const notes = M.instruments[id];
    let best = notes[0];
    notes.forEach(m => { if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m < best)) best = m; });
    return best;
  }

  /**
   * Start a recorded note. Same handle shape as Instruments.noteOn:
   * release(), cut(), setBend(), slideTo(). Returns null if not loaded.
   * params: tone 0–1 (brightness), attack, release (s), gain.
   */
  function noteOn(ac, dest, id, midi, vel, when, params) {
    if (!instrumentReady(id)) return null;
    const p = params || {};
    const root = nearest(id, midi);
    const buf = buffers.get(instKey(id, root));
    const t = Math.max(ac.currentTime, when == null ? ac.currentTime : when);
    const rate = (m) => Math.pow(2, (m - root) / 12);

    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate(midi), t);
    // Softer notes are darker as well as quieter, like the real thing.
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    const tone = p.tone == null ? 0.7 : p.tone;
    lp.frequency.value = Math.min(20000, 600 + Math.pow(tone, 1.6) * 19000 * (0.35 + 0.65 * vel));
    lp.Q.value = 0.5;
    const amp = ac.createGain();
    const peak = (p.gain == null ? 0.7 : p.gain) * (0.2 + 0.8 * vel * vel);
    const atk = Math.max(0.002, p.attack || 0.002);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + atk);
    src.connect(lp).connect(amp).connect(dest);
    src.start(t);
    const naturalEnd = t + buf.duration / rate(midi);
    src.stop(naturalEnd + 0.05);

    function levelAt(time) { return time < t + atk ? Math.max(0.0001, peak * (time - t) / atk) : peak; }
    const handle = {
      midi, stopped: false,
      release(when2) {
        if (handle.stopped) return;
        handle.stopped = true;
        const at = Math.max(t + 0.005, when2 == null ? ac.currentTime : when2);
        if (at >= naturalEnd) return;
        const rel = Math.max(0.03, p.release == null ? 0.3 : p.release);
        const g = amp.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
        else { g.cancelScheduledValues(at); g.setValueAtTime(levelAt(at), at); }
        g.setTargetAtTime(0.0001, at, rel / 4);
        try { src.stop(Math.min(naturalEnd + 0.05, at + rel + 0.1)); } catch (_) {}
      },
      cut(when2) {
        handle.stopped = true;
        const at = Math.max(ac.currentTime, when2 == null ? ac.currentTime : when2);
        const g = amp.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
        else { g.cancelScheduledValues(at); g.setValueAtTime(levelAt(at), at); }
        g.linearRampToValueAtTime(0, at + 0.02);
        try { src.stop(at + 0.03); } catch (_) {}
      },
      setBend(semis, when2) {
        if (handle.stopped) return;
        const at = Math.max(t, when2 == null ? ac.currentTime : when2);
        src.playbackRate.cancelScheduledValues(at);
        src.playbackRate.setTargetAtTime(rate(handle.midi + (semis || 0)), at, 0.012);
      },
      slideTo(next, glide, when2) {
        if (handle.stopped) return;
        const at = Math.max(t, when2 == null ? ac.currentTime : when2);
        src.playbackRate.cancelScheduledValues(at);
        src.playbackRate.setValueAtTime(rate(handle.midi), at);
        src.playbackRate.exponentialRampToValueAtTime(rate(next), at + Math.max(0.01, glide == null ? 0.08 : glide));
        handle.midi = next;
      }
    };
    return handle;
  }

  /**
   * One drum hit. opts: gain, pitch (semitones), decay (seconds; cuts a long
   * tail short), lp (Hz). Returns false when the hit isn't loaded yet.
   */
  function oneShot(ac, dest, name, when, vel, opts) {
    const buf = buffers.get(drumKey(name));
    if (!buf) return false;
    const o = opts || {};
    const t = Math.max(ac.currentTime, when == null ? ac.currentTime : when);
    const src = ac.createBufferSource();
    src.buffer = buf;
    if (o.pitch) src.playbackRate.value = Math.pow(2, o.pitch / 12);
    const g = ac.createGain();
    const level = (o.gain == null ? 1 : o.gain) * Math.max(0.03, vel == null ? 1 : vel);
    g.gain.setValueAtTime(level, t);
    let out = g;
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.5; g.connect(f); out = f; }
    out.connect(dest);
    src.connect(g);
    src.start(t);
    if (o.decay && o.decay < buf.duration) {
      g.gain.setValueAtTime(level, t + o.decay * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
      src.stop(t + o.decay + 0.02);
    }
    return true;
  }

  /** Fetch everything a song's tracks play. Resolves when all of it is in. */
  function preloadFor(tracks) {
    const jobs = [];
    (tracks || []).forEach(t => {
      if (t.kind === 'synth' && hasInstrument(t.instrument)) jobs.push(loadInstrument(t.instrument));
      if (t.kind === 'drum' && typeof DrumKits !== 'undefined') {
        const s = DrumKits.sampleOf(t.sound);
        if (s) jobs.push(loadDrum(s));
      }
    });
    return Promise.all(jobs);
  }

  return {
    preloadFor, hasInstrument, instrumentReady, loadInstrument,
    hasDrum, drumReady, loadDrum, noteOn, oneShot, onLoad,
    credits: () => M.credits.slice(),
    instruments: () => Object.keys(M.instruments),
    drums: () => Object.keys(M.drums)
  };
})();
