// transport.js — the master clock for BHS Studio.
//
// The lookahead core here is the one from audio-engine.js and it is kept
// deliberately intact: a ~25ms timer that looks ~100ms ahead and schedules
// every event at an absolute audioContext time. That part was already correct
// and rewriting it would only risk breaking it.
//
// What's added around it is everything a DAW needs and a single-pattern
// looper didn't:
//
//   - Musical position. Rhythm Shop's only notion of "where are we" is a step
//     index modulo the pattern length. Bars, beats and a song position have to
//     exist before a timeline or a quantised looper can.
//   - timeAtNextBar(). Quantised punch-in is literally this function, so it
//     belongs to the clock rather than being reinvented inside the looper.
//   - Pause vs stop. Rhythm Shop's stop() resets to step 0, so there is no
//     resume.
//   - Many subscribers. One onStep callback served one grid. A sequencer, a
//     looper and a playhead all need the same clock.
//   - A SEPARATE visual clock. This is the important one. Audio events are
//     scheduled up to a lookahead ahead of now, so using the scheduling
//     callback to paint the UI draws the playhead early — and worse, it puts
//     DOM work inside the audio path, where a stall becomes a dropout. So
//     scheduling pushes onto a queue and requestAnimationFrame drains it
//     against the audio clock. Two clocks, cleanly separated.

const Transport = (() => {
  const LOOKAHEAD = 0.1;      // seconds of audio scheduled in advance
  const TICK_MS = 25;         // how often we top that up

  // Referenced by name, not off `window`: a top-level `const` creates a script
  // -scope binding and never becomes a property of the global object, so
  // `window.Synth808` is undefined even though `Synth808` resolves fine.
  let getContext = () => (typeof Synth808 !== 'undefined' ? Synth808.ensureContext() : null);

  let bpm = 90;
  let beatsPerBar = 4;
  let stepsPerBeat = 4;       // 4 = sixteenth notes

  let playing = false;
  let timerId = null;

  let currentStep = 0;        // absolute step since play started (song position)
  let nextStepTime = 0;
  let startStep = 0;          // where the playhead resumes from

  let loopEnabled = true;
  let loopStart = 0;          // in steps
  let loopLength = 16;

  const audioSubs = new Set();
  const visualSubs = new Set();
  const stateSubs = new Set();

  let visualQueue = [];
  let rafId = null;

  // ── musical maths ──────────────────────────────────────────────────
  function secondsPerStep() { return 60 / bpm / stepsPerBeat; }
  function stepsPerBar() { return beatsPerBar * stepsPerBeat; }

  function positionOf(step) {
    const spb = stepsPerBar();
    return {
      step,
      bar: Math.floor(step / spb),
      beat: Math.floor((step % spb) / stepsPerBeat),
      stepInBar: step % spb,
      stepInBeat: step % stepsPerBeat
    };
  }

  /** Audio-clock time of a step index, relative to the scheduler's cursor. */
  function timeOfStep(step) {
    return nextStepTime + (step - currentStep) * secondsPerStep();
  }

  /**
   * When does the next bar line land? This is what quantised punch-in needs:
   * hit record late and the looper snaps to the boundary this returns.
   */
  function timeAtNextBar(from) {
    const ac = getContext();
    if (!ac) return 0;
    const now = from == null ? ac.currentTime : from;
    if (!playing) return now;
    const spb = stepsPerBar();
    const stepsIn = currentStep % spb;
    let stepsToGo = (spb - stepsIn) % spb;
    let t = timeOfStep(currentStep + stepsToGo);
    while (t < now) { stepsToGo += spb; t = timeOfStep(currentStep + stepsToGo); }
    return t;
  }

  function timeAtNextBeat(from) {
    const ac = getContext();
    if (!ac) return 0;
    const now = from == null ? ac.currentTime : from;
    if (!playing) return now;
    let stepsToGo = (stepsPerBeat - (currentStep % stepsPerBeat)) % stepsPerBeat;
    let t = timeOfStep(currentStep + stepsToGo);
    while (t < now) { stepsToGo += stepsPerBeat; t = timeOfStep(currentStep + stepsToGo); }
    return t;
  }

  // ── the scheduler ──────────────────────────────────────────────────
  function scheduleAhead() {
    const ac = getContext();
    if (!ac) return;

    while (nextStepTime < ac.currentTime + LOOKAHEAD) {
      const pos = positionOf(currentStep);
      const loopStep = loopEnabled
        ? loopStart + ((currentStep - loopStart) % loopLength + loopLength) % loopLength
        : currentStep;

      const ev = Object.assign({}, pos, { loopStep, time: nextStepTime });

      // Audio subscribers get the future time and schedule against it.
      audioSubs.forEach(fn => { try { fn(ev); } catch (e) { console.error(e); } });

      // Visual subscribers get the same event, but not until it's audible.
      if (visualSubs.size) visualQueue.push(ev);

      nextStepTime += secondsPerStep();
      currentStep += 1;

      if (loopEnabled && currentStep >= loopStart + loopLength) {
        currentStep = loopStart;
      }
    }
  }

  // The visual clock. Drains the queue only once the audio clock has actually
  // reached each event, so the playhead lands with the sound rather than ahead
  // of it by a lookahead window.
  function visualTick() {
    const ac = getContext();
    if (ac && visualQueue.length) {
      const now = ac.currentTime;
      let last = null;
      while (visualQueue.length && visualQueue[0].time <= now) last = visualQueue.shift();
      if (last) visualSubs.forEach(fn => { try { fn(last); } catch (e) { console.error(e); } });
    }
    rafId = requestAnimationFrame(visualTick);
  }

  function emitState() {
    const s = getState();
    stateSubs.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } });
  }

  // ── controls ───────────────────────────────────────────────────────
  function play() {
    if (playing) return;
    const ac = getContext();
    if (!ac) return;
    playing = true;
    currentStep = startStep;
    nextStepTime = ac.currentTime + 0.06;
    visualQueue = [];
    timerId = setInterval(scheduleAhead, TICK_MS);
    if (!rafId) rafId = requestAnimationFrame(visualTick);
    scheduleAhead();
    emitState();
  }

  /** Stop the clock but remember the position, so play() resumes. */
  function pause() {
    if (!playing) return;
    playing = false;
    startStep = currentStep;
    clearInterval(timerId); timerId = null;
    visualQueue = [];
    emitState();
  }

  /** Stop and rewind. */
  function stop() {
    playing = false;
    clearInterval(timerId); timerId = null;
    visualQueue = [];
    startStep = loopEnabled ? loopStart : 0;
    currentStep = startStep;
    emitState();
  }

  function toggle() { playing ? pause() : play(); }

  function seekTo(step) {
    startStep = Math.max(0, step | 0);
    if (!playing) currentStep = startStep;
    emitState();
  }

  // ── config ─────────────────────────────────────────────────────────
  function setBpm(v) { bpm = Math.min(300, Math.max(20, v)); emitState(); }
  function setTimeSignature(beats, unit) {
    beatsPerBar = Math.max(1, beats | 0);
    if (unit) stepsPerBeat = Math.max(1, unit | 0);
    emitState();
  }
  function setLoop(startStepIdx, lengthSteps, enabled) {
    loopStart = Math.max(0, startStepIdx | 0);
    loopLength = Math.max(1, lengthSteps | 0);
    if (enabled != null) loopEnabled = !!enabled;
    emitState();
  }

  function getState() {
    return {
      playing, bpm, beatsPerBar, stepsPerBeat,
      loopEnabled, loopStart, loopLength,
      secondsPerStep: secondsPerStep(),
      stepsPerBar: stepsPerBar(),
      position: positionOf(playing ? currentStep : startStep)
    };
  }

  // ── subscriptions ──────────────────────────────────────────────────
  // Each returns its own unsubscribe, so callers never have to hold onto the
  // original function reference to detach.
  function onStep(fn) { audioSubs.add(fn); return () => audioSubs.delete(fn); }
  function onVisualStep(fn) { visualSubs.add(fn); return () => visualSubs.delete(fn); }
  function onStateChange(fn) { stateSubs.add(fn); return () => stateSubs.delete(fn); }

  function setContextProvider(fn) { getContext = fn; }

  return {
    play, pause, stop, toggle, seekTo,
    setBpm, setTimeSignature, setLoop, setContextProvider,
    onStep, onVisualStep, onStateChange,
    getState, timeAtNextBar, timeAtNextBeat,
    get isPlaying() { return playing; }
  };
})();
