// hand-piano.js — piano practice with no sound, using the webcam.
//
// For practising which key is which (and finger independence) on a table, an
// unplugged keyboard, or anywhere you can't make noise. It is a *pointing*
// game, not press detection: an on-screen keyboard is laid over the camera
// picture, and you hold a fingertip over the lit key. Deliberately forgiving —
// MediaPipe gives 2-D landmarks, and the audience is a beginner.
//
// MediaPipe Tasks Vision is loaded from a CDN, and only when this instrument is
// actually picked — the microphone modes stay dependency-free.

const HandPianoInstrument = (() => {
  const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs';
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const LS_MIRROR = 'rhythmshop:practice:handMirror';
  const TIPS = [8, 12, 16, 20];          // index / middle / ring / pinky fingertips
  const VIEW_LO = 4, VIEW_HI = 6;        // C4..C6, same as the on-screen keyboard
  const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];

  const cb = { match: null, frame: null };
  const emit = (n, a) => { if (cb[n]) { try { cb[n](a); } catch (e) { console.error(e); } } };
  const hold = PitchDetector.createHoldGate({ holdMs: 380, graceMs: 220 });

  let landmarker = null, video = null, stream = null, raf = 0, running = false;
  let panel = null, overlay = null, loadingMsg = '';
  let target = null, targetMidi = null;
  let mirror = true;
  try { mirror = localStorage.getItem(LS_MIRROR) !== '0'; } catch (e) {}
  const opts = { holdMs: 380 };

  // white-key index (0..14) for a midi note in the C4..C6 view, or null
  function whiteIndex(midi) {
    let n = 0;
    for (let oct = VIEW_LO; oct <= VIEW_HI; oct++) {
      for (const pc of WHITE_PC) {
        if (oct === VIEW_HI && pc !== 0) break;
        if ((oct + 1) * 12 + pc === midi) return n;
        n++;
      }
    }
    return null;
  }
  const WHITE_COUNT = 15;                 // C4..C6 inclusive
  const MARGIN = 0.06;                    // keep keys off the frame edges

  function targetFrac(midi) {
    // map the target key to a horizontal fraction of the frame
    const wi = whiteIndex(midi);
    const i = wi == null ? 7 : wi;
    const span = 1 - 2 * MARGIN;
    return MARGIN + (i + 0.5) / WHITE_COUNT * span;
  }
  const zoneHalf = (1 - 2 * MARGIN) / WHITE_COUNT * 0.75;

  // ---- MediaPipe load (lazy, cached) ----
  async function ensureLandmarker(onStatus) {
    if (landmarker) return landmarker;
    onStatus('Loading the hand tracker (first time only)…');
    let vision;
    try {
      vision = await import(/* @vite-ignore */ MP_URL);
    } catch (e) {
      throw new Error('Could not load the hand tracker — check the internet connection.');
    }
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      numHands: 2,
      runningMode: 'VIDEO',
    });
    try { landmarker = await make('GPU'); }
    catch (e) { landmarker = await make('CPU'); }
    return landmarker;
  }

  // ---- floating camera panel ----
  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'hand-cam';
    panel.innerHTML = `
      <div class="hand-cam-head"><span>Camera</span>
        <label><input type="checkbox" id="handMirror"> mirror</label>
        <button id="handClose" title="Turn camera off">✕</button></div>
      <div class="hand-cam-stage"><video id="handVideo" playsinline muted></video>
        <svg id="handOverlay" viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div>
      <div class="hand-cam-msg" id="handMsg">Point a finger at the lit key.</div>
      <p class="hand-cam-tip">Put the laptop <b>behind</b> where your hands are, screen tilted down toward
      them, about two feet away — you should see both hands in the picture.</p>`;
    document.body.appendChild(panel);
    video = panel.querySelector('#handVideo');
    overlay = panel.querySelector('#handOverlay');
    const mb = panel.querySelector('#handMirror');
    mb.checked = mirror;
    mb.addEventListener('change', () => {
      mirror = mb.checked;
      try { localStorage.setItem(LS_MIRROR, mirror ? '1' : '0'); } catch (e) {}
      video.style.transform = mirror ? 'scaleX(-1)' : 'none';
    });
    panel.querySelector('#handClose').addEventListener('click', () => emit('frame', { requestStop: true }));
    video.style.transform = mirror ? 'scaleX(-1)' : 'none';
  }
  function teardownPanel() {
    if (panel) panel.remove();
    panel = overlay = video = null;
  }

  function drawOverlay(tips, pressedKey) {
    if (!overlay) return;
    const span = 1 - 2 * MARGIN;
    let html = '';
    for (let i = 0; i < WHITE_COUNT; i++) {
      const x = (MARGIN + i / WHITE_COUNT * span) * 100;
      const w = span / WHITE_COUNT * 100;
      const isTarget = whiteIndex(targetMidi) === i;
      const fill = isTarget ? (pressedKey ? 'rgba(107,191,122,0.55)' : 'rgba(217,154,58,0.45)') : 'rgba(233,225,204,0.06)';
      html += `<rect x="${x}" y="55" width="${w - 0.6}" height="42" fill="${fill}" stroke="rgba(233,225,204,0.25)" stroke-width="0.4"/>`;
    }
    tips.forEach(t => {
      html += `<circle cx="${t.x * 100}" cy="${t.y * 100}" r="2.4" fill="${t.pressed ? '#6bbf7a' : '#d99a3a'}"/>`;
    });
    overlay.innerHTML = html;
  }

  // ---- detection loop ----
  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (!landmarker || !video || video.readyState < 2) return;

    let res;
    try { res = landmarker.detectForVideo(video, performance.now()); }
    catch (e) { return; }

    const hands = (res && res.landmarks) || [];
    const tips = [];
    let matching = false;
    const tf = targetMidi != null ? targetFrac(targetMidi) : null;

    hands.forEach(lm => {
      TIPS.forEach(tip => {
        const mcp = lm[tip - 3];
        let x = lm[tip].x;
        if (mirror) x = 1 - x;
        const pressed = lm[tip].y > (mcp ? mcp.y : 1) + 0.01;   // fingertip below its knuckle
        tips.push({ x, y: lm[tip].y, pressed });
        if (tf != null && pressed && Math.abs(x - tf) < zoneHalf) matching = true;
      });
    });

    drawOverlay(tips, matching);
    const gate = hold.update(matching, performance.now());

    let msg;
    if (!hands.length) msg = 'I can’t see your hands — move them into the picture.';
    else if (!target) msg = 'Pick a song to start.';
    else if (matching) msg = 'Hold it there…';
    else msg = 'Point a finger at the lit key.';
    const mEl = panel && panel.querySelector('#handMsg');
    if (mEl) mEl.textContent = msg;

    emit('frame', {
      hasTarget: !!target,
      matching,
      progress01: gate.progress,
      level01: Math.min(1, hands.length / 2),
      message: msg,
    });
    if (gate.justCompleted) emit('match', {});
  }

  // ---- interface ----
  async function start() {
    if (running) return { ok: true };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, error: 'This browser can’t use the camera. Try Chrome or Firefox on a computer.' };
    }
    try {
      buildPanel();
      await ensureLandmarker(m => { const e = panel && panel.querySelector('#handMsg'); if (e) e.textContent = m; });
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      video.srcObject = stream;
      await video.play();
      running = true;
      hold.reset();
      loop();
      return { ok: true };
    } catch (err) {
      teardownPanel();
      const name = err && err.name;
      if (name === 'NotAllowedError') return { ok: false, error: 'The camera is blocked. Click the 🎥 icon by the web address, allow it, and press Start again.' };
      if (name === 'NotFoundError') return { ok: false, error: 'No camera found.' };
      return { ok: false, error: err.message || 'Could not turn the camera on.' };
    }
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    hold.reset();
    teardownPanel();
  }

  function setTarget(note) {
    target = note && note.octave != null ? note : (note ? Object.assign({}, note, { octave: VIEW_LO }) : null);
    targetMidi = target ? NoteUtils.midiOf(target, VIEW_LO) : null;
    hold.reset();
  }

  function renderSettings(box) {
    const p = document.createElement('p');
    p.className = 'set-note';
    p.textContent = 'No sound needed. An on-screen keyboard sits over the camera picture — hold a fingertip ' +
                    'on the lit key. Best with the laptop behind your hands, screen tilted down toward them.';
    box.appendChild(p);
  }

  return {
    id: 'piano-hands',
    label: 'Piano — watch my hands (beta)',
    sensors: ['camera'],
    uiMode: 'watch',
    octaveExact: true,
    defaultOctave: VIEW_LO,
    start, stop, setTarget,
    setOptions: (patch) => { Object.assign(opts, patch || {}); if (opts.holdMs) hold.setHoldMs(opts.holdMs); },
    resetHold: () => hold.reset(),
    onMatch: (fn) => { cb.match = fn; },
    onFrame: (fn) => { cb.frame = fn; },
    renderDiagram: (el, note, ctx) => PianoInstrument.renderDiagram(el, note, ctx),
    renderSettings,
    helpText: 'Silent practice with the webcam — hold a finger over the lit key. Point, don’t press. ' +
              'Put the laptop behind your hands, screen tilted down, about two feet away.',
  };
})();
