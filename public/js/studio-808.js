// studio-808.js — playable 808 keyboard.
//
// Voice allocation matters here in a way it never did in Rhythm Shop: those
// voices self-terminate on a fixed decay, so nothing could pile up. Held notes
// can, so this tracks live handles per MIDI note and caps polyphony.

(function () {
  const LOW_MIDI = 24;          // C1 — 32.7 Hz, proper 808 territory
  const OCTAVES = 3;
  const MAX_VOICES = 6;

  // Tracker-style QWERTY layout: two rows, one octave each.
  const KEYMAP = {
    z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
    q: 12, 2: 13, w: 14, 3: 15, e: 16, 4: 17, r: 18, 5: 19, t: 20, 6: 21, y: 22, 7: 23, u: 24
  };

  const BLACK = [1, 3, 6, 8, 10];

  let octaveShift = 0;
  let slideMode = false;
  let params = Object.assign({}, Synth808.DEFAULTS);

  const live = new Map();   // midi -> handle
  let lastHandle = null;    // for slide mode

  const kbEl = document.getElementById('keyboard');
  const notice = document.getElementById('notice');
  const nowNote = document.getElementById('nowNote');
  const slideBtn = document.getElementById('slideBtn');
  const octLabel = document.getElementById('octLabel');

  const CONTROLS = [
    { id: 'punchRatio', label: 'Punch', min: 1, max: 10, step: 0.1, fmt: v => v.toFixed(1) + '×',
      hint: 'How far above the note the pitch drop starts' },
    { id: 'punchTime', label: 'Punch time', min: 0.005, max: 0.15, step: 0.005, fmt: v => Math.round(v * 1000) + 'ms',
      hint: 'How fast it drops in' },
    { id: 'decay', label: 'Decay', min: 0.05, max: 2, step: 0.05, fmt: v => v.toFixed(2) + 's',
      hint: 'Fall from the initial hit down to the held level' },
    { id: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%',
      hint: 'Level held while the key is down' },
    { id: 'release', label: 'Release', min: 0.02, max: 1.5, step: 0.02, fmt: v => v.toFixed(2) + 's',
      hint: 'Fade after you let go' },
    { id: 'drive', label: 'Drive', min: 1, max: 20, step: 0.5, fmt: v => v.toFixed(1),
      hint: 'Saturation — this is what makes it audible on phone speakers' },
    { id: 'tone', label: 'Tone', min: 200, max: 6000, step: 50, fmt: v => Math.round(v) + 'Hz',
      hint: 'Lowpass cutoff' }
  ];

  // The sequencer plays the same voice, so it listens for knob moves.
  function publishParams() {
    window.dispatchEvent(new CustomEvent('bhs808params', { detail: Object.assign({}, params) }));
  }

  function noteOn(midi) {
    if (!Synth808.supported()) {
      notice.textContent = 'Your browser does not support the Web Audio API — try Chrome, Safari, or Firefox.';
      notice.classList.add('show');
      return;
    }
    if (live.has(midi)) return;

    // Slide mode: glide the note already sounding instead of starting a new one.
    if (slideMode && lastHandle && !lastHandle.stopped) {
      const from = lastHandle.midi;
      lastHandle.slideTo(midi, 0.09);
      live.delete(from);
      live.set(midi, lastHandle);
      paint(from, false);
      paint(midi, true);
      showNote(midi, true);
      return;
    }

    if (live.size >= MAX_VOICES) {
      const oldest = live.keys().next().value;
      const h = live.get(oldest);
      if (h) h.release();
      live.delete(oldest);
      paint(oldest, false);
    }

    const handle = Synth808.noteOn(midi, params);
    if (!handle) return;
    live.set(midi, handle);
    lastHandle = handle;
    paint(midi, true);
    showNote(midi, false);
  }

  function noteOff(midi) {
    const handle = live.get(midi);
    if (!handle) return;
    // In slide mode the handle may have moved on to another note already.
    if (handle.midi === midi) handle.release();
    live.delete(midi);
    paint(midi, false);
    if (!live.size) nowNote.textContent = '—';
  }

  function showNote(midi, slid) {
    const hz = Synth808.midiToFreq(midi);
    nowNote.textContent = `${Synth808.midiToName(midi)} · ${hz.toFixed(1)} Hz${slid ? ' · slide' : ''}`;
  }

  function paint(midi, on) {
    const el = kbEl.querySelector(`[data-midi="${midi}"]`);
    if (el) el.classList.toggle('down', on);
  }

  function renderKeyboard() {
    kbEl.innerHTML = '';
    const total = OCTAVES * 12;
    const base = LOW_MIDI + octaveShift * 12;

    for (let i = 0; i <= total; i++) {
      const midi = base + i;
      const pc = ((midi % 12) + 12) % 12;
      const isBlack = BLACK.includes(pc);
      const key = document.createElement('div');
      key.className = 'key' + (isBlack ? ' black' : ' white');
      key.dataset.midi = String(midi);
      key.setAttribute('role', 'button');
      key.setAttribute('aria-label', Synth808.midiToName(midi));
      key.tabIndex = 0;

      if (pc === 0) {
        const lab = document.createElement('span');
        lab.className = 'klabel';
        lab.textContent = Synth808.midiToName(midi);
        key.appendChild(lab);
      }

      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // Capture keeps a drag from losing the key, but it throws if the
        // pointer is already gone — never let that swallow the note.
        try { key.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        noteOn(midi);
      });
      key.addEventListener('pointerup', () => noteOff(midi));
      key.addEventListener('pointercancel', () => noteOff(midi));
      key.addEventListener('pointerleave', (e) => { if (e.buttons) noteOff(midi); });
      key.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); noteOn(midi); }
      });
      key.addEventListener('keyup', (e) => {
        if (e.key === 'Enter' || e.key === ' ') noteOff(midi);
      });

      kbEl.appendChild(key);
    }
    octLabel.textContent = `${Synth808.midiToName(base)} – ${Synth808.midiToName(base + total)}`;
  }

  function renderControls() {
    const wrap = document.getElementById('controls');
    wrap.innerHTML = '';
    CONTROLS.forEach(c => {
      const field = document.createElement('div');
      field.className = 'knob';

      const label = document.createElement('label');
      label.setAttribute('for', 'c_' + c.id);
      label.innerHTML = `${c.label} <span class="kval" id="v_${c.id}">${c.fmt(params[c.id])}</span>`;

      const input = document.createElement('input');
      input.type = 'range';
      input.id = 'c_' + c.id;
      input.min = String(c.min);
      input.max = String(c.max);
      input.step = String(c.step);
      input.value = String(params[c.id]);
      input.title = c.hint;
      input.addEventListener('input', () => {
        params[c.id] = parseFloat(input.value);
        document.getElementById('v_' + c.id).textContent = c.fmt(params[c.id]);
        publishParams();
      });

      const hint = document.createElement('span');
      hint.className = 'khint';
      hint.textContent = c.hint;

      field.appendChild(label);
      field.appendChild(input);
      field.appendChild(hint);
      wrap.appendChild(field);
    });
  }

  // ── computer keyboard ───────────────────────────────────────────────
  const heldKeys = new Set();

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();

    if (k === 'arrowleft') { e.preventDefault(); shiftOctave(-1); return; }
    if (k === 'arrowright') { e.preventDefault(); shiftOctave(1); return; }
    if (k === 'shift' && !e.repeat) { setSlide(true); return; }

    if (!(k in KEYMAP) || e.repeat || heldKeys.has(k)) return;
    e.preventDefault();
    heldKeys.add(k);
    noteOn(LOW_MIDI + octaveShift * 12 + KEYMAP[k]);
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'shift') { setSlide(false); return; }
    if (!(k in KEYMAP)) return;
    heldKeys.delete(k);
    noteOff(LOW_MIDI + octaveShift * 12 + KEYMAP[k]);
  });

  // Releasing everything on blur avoids a note hanging forever if the tab
  // loses focus mid-keypress.
  window.addEventListener('blur', () => {
    heldKeys.clear();
    Array.from(live.keys()).forEach(noteOff);
  });

  function shiftOctave(d) {
    const next = Math.max(-1, Math.min(3, octaveShift + d));
    if (next === octaveShift) return;
    Array.from(live.keys()).forEach(noteOff);
    octaveShift = next;
    renderKeyboard();
  }

  function setSlide(on) {
    slideMode = on;
    slideBtn.classList.toggle('primary', on);
    slideBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  slideBtn.addEventListener('click', () => setSlide(!slideMode));
  document.getElementById('octDown').addEventListener('click', () => shiftOctave(-1));
  document.getElementById('octUp').addEventListener('click', () => shiftOctave(1));
  document.getElementById('resetBtn').addEventListener('click', () => {
    params = Object.assign({}, Synth808.DEFAULTS);
    renderControls();
    publishParams();
  });

  renderKeyboard();
  renderControls();
  publishParams();
})();
