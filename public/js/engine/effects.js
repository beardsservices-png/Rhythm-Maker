// effects.js — shared reverb and delay, fed by per-track sends.
//
// Sends rather than inserts. An insert chain would mean a private reverb on
// every track — eight convolvers doing the same expensive convolution, and
// eight sets of controls to keep in agreement. One reverb that eight tracks
// feed at different amounts is both cheaper and how a mixing desk actually
// works: it's what makes parts sound like they're in the same room, because
// they literally share one.
//
//   track gain -> pan -> master                (dry)
//              -> reverb send -> reverb bus -> master
//              -> delay send  -> delay bus  -> master
//
// The delay is tempo-synced. A delay set in milliseconds fights the song
// every time the tempo changes; set in beat divisions it stays musical, and
// dotted-eighth in particular is the repeat you hear on most modern records.
//
// The impulse response is generated, not loaded — no asset to source, and
// size/decay become live controls rather than a fixed file.

const Effects = (() => {
  let ctx = null;
  let out = null;

  let convolver = null, reverbBus = null, reverbTone = null;
  let delayNode = null, delayBus = null, feedback = null, delayTone = null;

  let params = {
    reverbSize: 1.8,      // seconds of tail
    reverbDecay: 2.4,     // higher = faster fade
    reverbTone: 4200,     // lowpass on the tail; darker sits behind the mix
    delayDivision: 0.75,  // in beats — 0.75 is a dotted eighth
    delayFeedback: 0.38,
    delayTone: 2600
  };

  const listeners = new Set();
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() {
    const snap = Object.assign({}, params);
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }

  /** Exponentially decaying noise — a serviceable room without an IR file. */
  function buildImpulse(seconds, decay) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function init(audioCtx, destination) {
    if (ctx) return;
    ctx = audioCtx;
    out = destination;

    // ── reverb ──
    reverbBus = ctx.createGain();
    reverbBus.gain.value = 1;
    convolver = ctx.createConvolver();
    convolver.buffer = buildImpulse(params.reverbSize, params.reverbDecay);
    reverbTone = ctx.createBiquadFilter();
    reverbTone.type = 'lowpass';
    reverbTone.frequency.value = params.reverbTone;
    reverbBus.connect(convolver).connect(reverbTone).connect(out);

    // ── delay ──
    delayBus = ctx.createGain();
    delayBus.gain.value = 1;
    delayNode = ctx.createDelay(2.0);
    feedback = ctx.createGain();
    feedback.gain.value = params.delayFeedback;
    delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = params.delayTone;

    // Feedback runs through the filter, so each repeat is darker than the
    // last. Without it the repeats stay bright and quickly turn to mush.
    delayBus.connect(delayNode);
    delayNode.connect(delayTone).connect(out);
    delayTone.connect(feedback).connect(delayNode);

    syncDelayToTempo();
  }

  /** Convert the beat division into seconds at the current tempo. */
  function syncDelayToTempo() {
    if (!delayNode || typeof Transport === 'undefined') return;
    const st = Transport.getState();
    const secPerBeat = 60 / st.bpm;
    const t = Math.min(1.99, Math.max(0.01, secPerBeat * params.delayDivision));
    delayNode.delayTime.setTargetAtTime(t, ctx.currentTime, 0.02);
  }

  function reverbInput() { return reverbBus; }
  function delayInput() { return delayBus; }
  function ready() { return !!ctx; }

  const LIMITS = {
    reverbSize: [0.2, 6], reverbDecay: [0.3, 8], reverbTone: [200, 16000],
    delayDivision: [0.125, 4], delayFeedback: [0, 0.92], delayTone: [200, 16000]
  };

  function set(key, value) {
    if (!(key in params)) return;
    // Clamp what's STORED, not just what reaches the node — an unclamped
    // value would be written into a saved project and come back later.
    const lim = LIMITS[key];
    params[key] = lim ? Math.min(lim[1], Math.max(lim[0], value)) : value;
    value = params[key];
    if (!ctx) return;
    switch (key) {
      case 'reverbSize':
      case 'reverbDecay':
        convolver.buffer = buildImpulse(params.reverbSize, params.reverbDecay);
        break;
      case 'reverbTone':
        reverbTone.frequency.setTargetAtTime(value, ctx.currentTime, 0.02);
        break;
      case 'delayDivision':
        syncDelayToTempo();
        break;
      case 'delayFeedback':
        // Capped at 0.92 by LIMITS: at 1.0 a feedback loop never decays and
        // builds until it clips.
        feedback.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
        break;
      case 'delayTone':
        delayTone.frequency.setTargetAtTime(value, ctx.currentTime, 0.02);
        break;
    }
    emit();
  }

  function getParams() { return Object.assign({}, params); }

  function serialize() { return Object.assign({}, params); }
  function restore(data) {
    if (!data) return;
    Object.keys(params).forEach(k => {
      if (typeof data[k] === 'number') set(k, data[k]);
    });
    emit();
  }

  const DIVISIONS = [
    { label: '1/16', beats: 0.25 },
    { label: '1/8', beats: 0.5 },
    { label: '1/8 dotted', beats: 0.75 },
    { label: '1/4', beats: 1 },
    { label: '1/4 dotted', beats: 1.5 },
    { label: '1/2', beats: 2 }
  ];

  return {
    init, ready, reverbInput, delayInput,
    set, getParams, serialize, restore, onChange,
    syncDelayToTempo, DIVISIONS
  };
})();
