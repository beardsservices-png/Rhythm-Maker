// looper.js — four-slot live looper, bar-quantised, riding the Transport.
//
// The two things that make this feel like a Boss RC rather than a tape
// recorder:
//
// 1. PUNCH SNAPS TO THE NEAREST BAR, INCLUDING BACKWARDS. Press record a
//    beat late and the take still starts on the bar line you meant, because
//    the worklet has been capturing all along (see recorder-worklet.js) and
//    we simply cut earlier into it. Press it early and it snaps forward.
//    Same on punch-out, and the length is rounded to whole bars so a loop
//    always fits the grid.
//
// 2. LOOPS STAY IN PHASE WITH THE SONG. A slot toggled off and back on
//    resumes where the song is, not where the loop left off — so a loop
//    muted for two bars comes back on the downbeat rather than a bar and a
//    half through. Playback starts on a bar boundary with an offset into the
//    buffer computed from the song position.
//
// LATENCY. Audio recorded through a mic arrives late by the input hardware
// delay plus the context's own base and output latency. Only the last two are
// readable, and outputLatency is unreliable in Safari, so the estimate is a
// starting point and the UI exposes a manual trim on top. Without this,
// overdubs drift progressively later with each layer.

const Looper = (() => {
  const SLOTS = 4;
  const MIN_BARS = 1;

  let ctx = null;
  let stream = null;
  let source = null;
  let node = null;          // the AudioWorkletNode
  let masterOut = null;
  let ready = false;
  let armError = null;

  let latencyOffset = 0;    // seconds, subtracted from the slice window
  let reqId = 0;
  const pending = new Map();

  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    slots.push({
      index: i, state: 'empty',   // empty | recording | playing | stopped
      buffer: null, bars: 0,
      gain: null, srcNode: null, volume: 0.9,
      punchInTime: 0
    });
  }

  const listeners = new Set();
  function emit() {
    const snap = slots.map(s => ({
      index: s.index, state: s.state, bars: s.bars,
      volume: s.volume, hasAudio: !!s.buffer
    }));
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function estimateLatency(ac) {
    const base = typeof ac.baseLatency === 'number' ? ac.baseLatency : 0;
    // Not implemented everywhere — Safari in particular — so guard it.
    const out = typeof ac.outputLatency === 'number' ? ac.outputLatency : 0;
    return base + out;
  }

  /** Ask for the mic and start capturing. Idempotent. */
  async function arm() {
    if (ready) return { ok: true };
    try {
      ctx = Synth808.ensureContext();
      if (!ctx) throw new Error('No audio context');

      // These default ON and are built for speech. Left on, they duck, gate
      // and smear music, and add a variable delay that makes latency
      // compensation impossible to calibrate.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      await ctx.audioWorklet.addModule('js/engine/recorder-worklet.js');

      masterOut = ctx.createGain();
      masterOut.gain.value = 1;
      masterOut.connect(ctx.destination);

      source = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'bhs-recorder', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
      });
      node.port.onmessage = (e) => {
        const msg = e.data;
        const resolve = pending.get(msg.id);
        if (resolve) { pending.delete(msg.id); resolve(msg); }
      };

      // The worklet emits silence; connecting it to a zero gain keeps the node
      // pulled by the graph without adding monitoring (which would feed back
      // through speakers).
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(ctx.destination);

      latencyOffset = estimateLatency(ctx);
      ready = true;
      armError = null;
      emit();
      return { ok: true, latency: latencyOffset };
    } catch (e) {
      armError = e && e.message ? e.message : String(e);
      ready = false;
      emit();
      return { ok: false, error: armError };
    }
  }

  function requestSlice(from, to) {
    return new Promise((resolve) => {
      const id = ++reqId;
      pending.set(id, resolve);
      node.port.postMessage({ type: 'slice', id, from, to });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); resolve({ ok: false, reason: 'timeout' }); }
      }, 2000);
    });
  }

  /** Nearest bar line to `t` — may be behind us, which is the point. */
  function nearestBar(t) {
    const st = Transport.getState();
    const barSec = st.secondsPerStep * st.stepsPerBar;
    const next = Transport.timeAtNextBar(t);
    const prev = next - barSec;
    return (t - prev) < (next - t) ? prev : next;
  }

  function startRecording(i) {
    const s = slots[i];
    if (!ready || s.state === 'recording') return;
    stopSlot(i);
    s.punchInTime = nearestBar(ctx.currentTime);
    s.state = 'recording';
    emit();
  }

  async function stopRecording(i) {
    const s = slots[i];
    if (s.state !== 'recording') return { ok: false, reason: 'not-recording' };

    const st = Transport.getState();
    const barSec = st.secondsPerStep * st.stepsPerBar;

    let punchOut = nearestBar(ctx.currentTime);
    let bars = Math.round((punchOut - s.punchInTime) / barSec);
    if (bars < MIN_BARS) { bars = MIN_BARS; punchOut = s.punchInTime + barSec; }

    // The take is delayed by the round trip, so shift the window later by the
    // same amount to land on the sound the player actually heard.
    const from = s.punchInTime + latencyOffset;
    const to = from + bars * barSec;

    // Wait until the tail has actually been captured before asking for it.
    const waitFor = to - ctx.currentTime;
    if (waitFor > 0) await new Promise(r => setTimeout(r, waitFor * 1000 + 60));

    const res = await requestSlice(from, to);
    if (!res || !res.ok) {
      s.state = s.buffer ? 'stopped' : 'empty';
      emit();
      return { ok: false, reason: res ? res.reason : 'no-response' };
    }

    const buf = ctx.createBuffer(1, res.samples.length, res.sampleRate);
    buf.copyToChannel(res.samples, 0);
    s.buffer = buf;
    s.bars = bars;
    s.state = 'stopped';
    play(i);
    return { ok: true, bars, seconds: buf.duration };
  }

  /**
   * Start the slot on the next bar, at the offset that keeps it in phase with
   * the song — so toggling a loop off and on never knocks it out of time.
   */
  function play(i) {
    const s = slots[i];
    if (!s.buffer) return;
    stopSlot(i);

    const st = Transport.getState();
    const barSec = st.secondsPerStep * st.stepsPerBar;
    const startAt = Transport.isPlaying
      ? Transport.timeAtNextBar(ctx.currentTime)
      : ctx.currentTime + 0.02;

    let offset = 0;
    if (Transport.isPlaying) {
      const barsFromPunch = Math.round((startAt - s.punchInTime) / barSec);
      offset = (((barsFromPunch % s.bars) + s.bars) % s.bars) * barSec;
    }

    const g = ctx.createGain();
    g.gain.value = s.volume;
    g.connect(masterOut || ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.loop = true;
    src.connect(g);
    src.start(startAt, Math.min(offset, Math.max(0, s.buffer.duration - 0.001)));

    s.srcNode = src;
    s.gain = g;
    s.state = 'playing';
    emit();
  }

  function stopSlot(i) {
    const s = slots[i];
    if (s.srcNode) { try { s.srcNode.stop(); } catch (_) {} s.srcNode.disconnect(); s.srcNode = null; }
    if (s.gain) { s.gain.disconnect(); s.gain = null; }
    if (s.state === 'playing') s.state = 'stopped';
    emit();
  }

  function toggle(i) {
    const s = slots[i];
    if (s.state === 'playing') stopSlot(i);
    else if (s.buffer) play(i);
  }

  function clear(i) {
    stopSlot(i);
    const s = slots[i];
    s.buffer = null; s.bars = 0; s.state = 'empty';
    emit();
  }

  function setVolume(i, v) {
    const s = slots[i];
    s.volume = Math.min(1.5, Math.max(0, v));
    if (s.gain) s.gain.gain.value = s.volume;
    emit();
  }

  function setLatencyOffset(sec) { latencyOffset = Math.max(-0.5, Math.min(0.5, sec)); }
  function getLatencyOffset() { return latencyOffset; }
  function isReady() { return ready; }
  function getError() { return armError; }
  function getSlots() { return slots; }

  return {
    SLOTS, arm, startRecording, stopRecording, play, stopSlot, toggle, clear,
    setVolume, setLatencyOffset, getLatencyOffset, isReady, getError,
    onChange, getSlots, nearestBar
  };
})();
