// recorder.js — record a bar-quantised take from one of three sources:
//
//   'keys'  what you play by hand on the keyboard or pads (the beat isn't in it)
//   'mix'   everything you hear — bounce the whole beat to one audio track
//   'mic'   the microphone, for vocals or a real instrument
//
// The old looper only knew the mic, and only after you'd "armed" a slot. Now
// any of the three records at any time from one button, and every take
// becomes an audio TRACK — with a waveform, its own mixer strip, and a row in
// the arrangement — rather than a slot off to the side.
//
// PUNCH SNAPS TO THE NEAREST BAR, INCLUDING BACKWARDS. Capture runs
// continuously into a ring buffer (recorder-worklet.js), so pressing Record a
// beat late still starts the take on the bar line you meant. Stop snaps the
// same way and the length is whole bars, so a take always loops in time.
//
// LATENCY. Mic audio arrives late by the input/output latency; the browser
// only reports part of that, so there's a manual trim on top. The studio's own
// sources are captured on the audio clock itself, so they need none.

const Recorder = (() => {
  let ctx = null;
  let node = null;
  let recIn = null;
  let source = 'keys';
  let connected = null;       // the node currently feeding recIn
  let connectedAt = 0;        // audio time that source started feeding the ring
  let mic = null;             // { stream, src }
  let micTrim = 0;            // seconds, user-adjustable
  let micLatency = 0;         // estimated
  let reqId = 0;
  const pending = new Map();

  let state = 'idle';         // idle | recording | finishing
  let punchIn = 0;
  let autoBars = 0;
  let autoTimer = null;

  const listeners = new Set();
  function emit(extra) {
    const snap = Object.assign({ state, source, punchIn }, extra || {});
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async function ensureNode() {
    ctx = Sequencer.init();
    if (!ctx) throw new Error('Audio is not available in this browser.');
    if (node) return;
    await ctx.audioWorklet.addModule('js/engine/recorder-worklet.js');
    recIn = ctx.createGain();
    node = new AudioWorkletNode(ctx, 'bhs-recorder', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    });
    node.port.onmessage = (e) => {
      const r = pending.get(e.data.id);
      if (r) { pending.delete(e.data.id); r(e.data); }
    };
    // The worklet outputs silence; a zero gain keeps it pulled by the graph
    // without monitoring the input (which would feed back on speakers).
    const sink = ctx.createGain();
    sink.gain.value = 0;
    recIn.connect(node).connect(sink).connect(ctx.destination);
  }

  async function connectSource(which) {
    await ensureNode();
    let n = null;
    if (which === 'mic') {
      if (!mic) {
        // These default ON and are built for speech: they duck, gate and add
        // a variable delay that makes latency compensation impossible.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        mic = { stream, src: ctx.createMediaStreamSource(stream) };
        micLatency = (ctx.baseLatency || 0) + (typeof ctx.outputLatency === 'number' ? ctx.outputLatency : 0);
      }
      n = mic.src;
    } else if (which === 'mix') {
      n = Mixer.masterNode();
    } else {
      n = Sequencer.liveBus();
    }
    if (connected && connected !== n) { try { connected.disconnect(recIn); } catch (_) {} }
    if (connected !== n) { n.connect(recIn); connectedAt = ctx.currentTime; }
    connected = n;
  }

  /** Choose the source. For the mic this asks permission, so call it from a click. */
  async function setSource(which) {
    if (state !== 'idle') return { ok: false, error: 'Stop recording first.' };
    source = ['keys', 'mix', 'mic'].includes(which) ? which : 'keys';
    try {
      await connectSource(source);
      emit();
      return { ok: true };
    } catch (e) {
      emit();
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  function barSec() {
    const st = Transport.getState();
    return st.secondsPerStep * st.stepsPerBar;
  }

  /** Nearest bar line to t — may be behind us, which is the point. */
  function nearestBar(t) {
    const next = Transport.timeAtNextBar(t);
    const prev = next - barSec();
    return (t - prev) < (next - t) ? prev : next;
  }

  /**
   * Start a take. Starts the song too if it's stopped, so you can press one
   * button and play. `bars` > 0 stops it automatically after that many bars.
   */
  async function start(bars) {
    if (state !== 'idle') return { ok: false, error: 'Already recording.' };
    try { await connectSource(source); } catch (e) { return { ok: false, error: e.message || String(e) }; }
    if (!Transport.isPlaying) Transport.play();
    punchIn = nearestBar(ctx.currentTime);
    // Snapping backwards only works if the ring was already listening then.
    if (punchIn < connectedAt + 0.02) punchIn = Transport.timeAtNextBar(ctx.currentTime);
    state = 'recording';
    autoBars = bars | 0;
    if (autoBars > 0) {
      const endAt = punchIn + autoBars * barSec();
      clearInterval(autoTimer);
      autoTimer = setInterval(() => {
        if (state === 'recording' && ctx.currentTime >= endAt - 0.03) stop();
      }, 30);
    }
    emit();
    return { ok: true };
  }

  function requestSlice(from, to) {
    return new Promise((resolve) => {
      const id = ++reqId;
      pending.set(id, resolve);
      node.port.postMessage({ type: 'slice', id, from, to });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, reason: 'timeout' }); } }, 3000);
    });
  }

  /** Finish the take. Resolves { ok, buffer, bars, source } or { ok:false, reason }. */
  async function stop() {
    if (state !== 'recording') return { ok: false, reason: 'not-recording' };
    clearInterval(autoTimer);
    state = 'finishing';
    emit();
    const bs = barSec();
    let bars = autoBars > 0 ? autoBars : Math.round((nearestBar(ctx.currentTime) - punchIn) / bs);
    if (bars < 1) bars = 1;
    const lat = source === 'mic' ? micLatency + micTrim : 0;
    const from = punchIn + lat;
    const to = from + bars * bs;
    const wait = to - ctx.currentTime;
    if (wait > 0) await new Promise(r => setTimeout(r, wait * 1000 + 80));
    // The audio thread can trail the clock slightly under load; if the end of
    // the take isn't in the ring yet, give it a moment rather than failing.
    let res = await requestSlice(from, to);
    for (let i = 0; i < 15 && res && !res.ok && res.reason === 'future'; i++) {
      await new Promise(r => setTimeout(r, 100));
      res = await requestSlice(from, to);
    }
    state = 'idle';
    if (!res || !res.ok) {
      emit({ error: res ? res.reason : 'no-response' });
      return { ok: false, reason: res ? res.reason : 'no-response' };
    }
    const buffer = ctx.createBuffer(1, res.samples.length, res.sampleRate);
    buffer.copyToChannel(res.samples, 0);
    const take = { ok: true, buffer, bars, source };
    emit({ done: true, take });
    return take;
  }

  /** Start listening early (from the first click) so a late punch can snap back. */
  async function prime() {
    if (source === 'mic' && !mic) return;
    try { await connectSource(source); } catch (_) { /* not fatal — start() retries */ }
  }

  function cancel() {
    clearInterval(autoTimer);
    state = 'idle';
    emit();
  }

  return {
    setSource, start, stop, cancel, prime, onChange, nearestBar,
    getSource: () => source,
    getState: () => state,
    setMicTrim: (s) => { micTrim = Math.max(-0.5, Math.min(0.5, s)); },
    getMicTrim: () => micTrim,
    getMicLatency: () => micLatency
  };
})();
