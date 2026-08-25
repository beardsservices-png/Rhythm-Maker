// mixer.js — per-track volume, pan, mute and solo.
//
// Until now every instrument ran at a fixed level straight into the master,
// so "turn the kick down" was impossible. Each part now gets its own strip:
//
//   voice -> [track gain] -> [pan] -> master -> limiter -> speakers
//
// The routing this needs already existed for a different reason. Making
// export work meant teaching both engines to build voices into a stated
// context and destination (RhythmAudio.renderVoice, Synth808.renderNote), so
// the same seam serves live playback into per-track strips — no second code
// path for the voices themselves.
//
// Solo is subtractive rather than a separate flag on the graph: any track
// soloed silences every track that isn't, which is what people expect and
// what makes several solos at once behave sensibly.

const Mixer = (() => {
  let ctx = null;
  let master = null;
  let limiter = null;
  const tracks = new Map();

  const listeners = new Set();
  function emit() {
    const snap = [];
    tracks.forEach((t, id) => snap.push({
      id, label: t.label, volume: t.volume, pan: t.pan,
      muted: t.muted, soloed: t.soloed, audible: isAudible(id)
    }));
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function init(audioCtx) {
    if (ctx) return ctx;
    ctx = audioCtx;

    // Catches the sum of everything. Not a true brickwall — a compressor has
    // no lookahead and can overshoot — but it stops a stack of loud tracks
    // from tearing on the way out.
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 3;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(limiter);
    return ctx;
  }

  function addTrack(id, label, opts = {}) {
    if (!ctx) return null;
    if (tracks.has(id)) return tracks.get(id);

    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner
      ? ctx.createStereoPanner()
      : null;   // very old Safari: fall through to plain gain

    if (pan) { gain.connect(pan); pan.connect(master); }
    else gain.connect(master);

    const t = {
      id, label,
      volume: opts.volume == null ? 0.85 : opts.volume,
      pan: 0, muted: false, soloed: false,
      gain, panner: pan
    };
    gain.gain.value = t.volume;
    tracks.set(id, t);
    applyGains();
    // Must announce itself: the loop strips are added when the mic is armed,
    // long after the mixer UI first rendered, and without this they never
    // appear.
    emit();
    return t;
  }

  /** Where a voice should connect to land on this track. */
  function input(id) {
    const t = tracks.get(id);
    return t ? t.gain : master;
  }

  function anySoloed() {
    for (const t of tracks.values()) if (t.soloed) return true;
    return false;
  }

  function isAudible(id) {
    const t = tracks.get(id);
    if (!t) return false;
    if (t.muted) return false;
    return anySoloed() ? t.soloed : true;
  }

  /** Recompute every track's real gain — solo is only meaningful in context. */
  function applyGains() {
    const solo = anySoloed();
    tracks.forEach(t => {
      const on = t.muted ? false : (solo ? t.soloed : true);
      // A short ramp instead of a jump: an instant gain change on a sounding
      // voice is a click.
      const target = on ? t.volume : 0;
      const now = ctx ? ctx.currentTime : 0;
      t.gain.gain.cancelScheduledValues(now);
      t.gain.gain.setTargetAtTime(target, now, 0.008);
    });
  }

  function setVolume(id, v) {
    const t = tracks.get(id);
    if (!t) return;
    t.volume = Math.min(1.5, Math.max(0, v));
    applyGains();
    emit();
  }

  function setPan(id, v) {
    const t = tracks.get(id);
    if (!t || !t.panner) return;
    t.pan = Math.min(1, Math.max(-1, v));
    t.panner.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.01);
    emit();
  }

  function setMuted(id, on) {
    const t = tracks.get(id);
    if (!t) return;
    t.muted = !!on;
    applyGains();
    emit();
  }

  function setSoloed(id, on) {
    const t = tracks.get(id);
    if (!t) return;
    t.soloed = !!on;
    applyGains();
    emit();
  }

  function clearSolo() {
    tracks.forEach(t => t.soloed = false);
    applyGains();
    emit();
  }

  function setMasterVolume(v) {
    if (!master) return;
    master.gain.setTargetAtTime(Math.min(1.5, Math.max(0, v)), ctx.currentTime, 0.01);
  }
  function getMasterVolume() { return master ? master.gain.value : 0.9; }
  function masterNode() { return master; }

  function serialize() {
    const out = { master: getMasterVolume(), tracks: {} };
    tracks.forEach((t, id) => {
      out.tracks[id] = { volume: t.volume, pan: t.pan, muted: t.muted, soloed: t.soloed };
    });
    return out;
  }

  function restore(data) {
    if (!data) return;
    if (typeof data.master === 'number') setMasterVolume(data.master);
    Object.entries(data.tracks || {}).forEach(([id, s]) => {
      const t = tracks.get(id);
      if (!t) return;
      t.volume = typeof s.volume === 'number' ? s.volume : t.volume;
      t.muted = !!s.muted;
      t.soloed = !!s.soloed;
      if (typeof s.pan === 'number' && t.panner) {
        t.pan = s.pan;
        t.panner.pan.value = s.pan;
      }
    });
    applyGains();
    emit();
  }

  return {
    init, addTrack, input, masterNode,
    setVolume, setPan, setMuted, setSoloed, clearSolo,
    setMasterVolume, getMasterVolume,
    isAudible, onChange, serialize, restore,
    get(id) { return tracks.get(id); },
    ids: () => Array.from(tracks.keys())
  };
})();
