// studio-sequencer.js — bassline sequencer for the 808, driven by Transport.
//
// Monophonic on purpose. A bass part is one note at a time, and monophony is
// what makes slide meaningful: with one voice, "slide" is glide the note
// that's already sounding into the next one, which is the whole trap idiom.
// A polyphonic grid would have to decide which voice slides.
//
// Note lifetime is worked out one step ahead at SCHEDULE time, not play time.
// The transport hands over events ~100ms early, so when a step is scheduled
// the following step is already known — which is what lets a note either be
// released at the end of its step or held and glided into the next.

(function () {
  const STEPS = 16;                 // one bar of sixteenths
  const LOW_MIDI = 24;              // C1
  const ROWS = 25;                  // two octaves inclusive, high row first
  const GATE = 0.92;                // fraction of the step a note sounds for

  // The bassline is a part in the variation bank like each drum lane, so it
  // can move to B while the drums stay on A.
  const PART = 'bass';
  Variations.register(PART, () => new Array(STEPS).fill(null));
  const pat = () => Variations.active(PART);

  let params = Object.assign({}, Synth808.DEFAULTS);
  let held = null;                  // the sequencer's currently sounding note

  const gridEl = document.getElementById('seqGrid');
  const playBtn = document.getElementById('seqPlay');
  const bpmInput = document.getElementById('seqBpm');
  const bpmVal = document.getElementById('seqBpmVal');
  const posEl = document.getElementById('seqPos');

  function rowMidi(row) { return LOW_MIDI + (ROWS - 1 - row); }

  // ── audio: runs inside the scheduler, always against a future time ──
  function onStep(ev) {
    const i = ((ev.loopStep % STEPS) + STEPS) % STEPS;
    const pattern = pat();
    const note = pattern[i];
    const stepDur = Transport.getState().secondsPerStep;

    if (!note) {
      if (held && !held.stopped) { held.release(ev.time); held = null; }
      return;
    }

    if (note.slide && held && !held.stopped) {
      // Glide the sounding note rather than restarting it.
      held.slideTo(note.midi, Math.min(0.12, stepDur * 0.7), ev.time);
    } else {
      if (held && !held.stopped) held.release(ev.time);
      held = Synth808.noteOn(note.midi, params, ev.time);
    }

    // Hold through the next step only if that step slides into this one.
    const next = pattern[(i + 1) % STEPS];
    const tieForward = next && next.slide;
    if (!tieForward && held) held.release(ev.time + stepDur * GATE);
  }

  // ── visual: runs on rAF, only once the audio clock has caught up ──
  function onVisualStep(ev) {
    const i = ((ev.loopStep % STEPS) + STEPS) % STEPS;
    gridEl.querySelectorAll('.col.playing').forEach(c => c.classList.remove('playing'));
    const col = gridEl.querySelector(`.col[data-step="${i}"]`);
    if (col) col.classList.add('playing');
    posEl.textContent = `${ev.bar + 1}.${ev.beat + 1}`;
  }

  function setStep(i, midi) {
    const pattern = pat();
    const cur = pattern[i];
    if (cur && cur.midi === midi) {
      pattern[i] = null;                       // clicking the same cell clears
    } else {
      pattern[i] = { midi, slide: cur ? cur.slide : false };
    }
    render();
  }

  function toggleSlide(i) {
    const pattern = pat();
    if (!pattern[i]) return;
    pattern[i].slide = !pattern[i].slide;
    render();
  }

  function render() {
    const pattern = pat();
    gridEl.innerHTML = '';
    for (let i = 0; i < STEPS; i++) {
      const col = document.createElement('div');
      col.className = 'col' + (i % 4 === 0 ? ' beat' : '');
      col.dataset.step = String(i);

      for (let r = 0; r < ROWS; r++) {
        const midi = rowMidi(r);
        const pc = ((midi % 12) + 12) % 12;
        const isBlack = [1, 3, 6, 8, 10].includes(pc);
        const on = pattern[i] && pattern[i].midi === midi;

        const cell = document.createElement('div');
        cell.className = 'scell' + (isBlack ? ' blk' : '') + (on ? ' on' : '');
        if (on && pattern[i].slide) cell.classList.add('slid');
        cell.title = Synth808.midiToName(midi);
        cell.addEventListener('click', () => setStep(i, midi));
        col.appendChild(cell);
      }

      const sl = document.createElement('button');
      sl.className = 'slidebtn' + (pattern[i] && pattern[i].slide ? ' on' : '');
      sl.textContent = 'S';
      sl.title = 'Slide into this note from the one before';
      sl.disabled = !pattern[i];
      sl.addEventListener('click', () => toggleSlide(i));
      col.appendChild(sl);

      gridEl.appendChild(col);
    }
  }

  function stopAll() {
    if (held && !held.stopped) held.release();
    held = null;
    gridEl.querySelectorAll('.col.playing').forEach(c => c.classList.remove('playing'));
    posEl.textContent = '—';
  }

  // A starting riff, so the page makes a sound the first time you press play.
  function seedPattern() {
    // A slide only works from a note that is still sounding, so each slide
    // here sits on the step immediately after one — otherwise it just
    // retriggers and the feature never shows itself.
    const riff = [
      [0, 36, false], [3, 36, false], [4, 43, true], [7, 41, false],
      [10, 39, false], [12, 36, false], [13, 31, true]
    ];
    const a = Variations.bank(PART, 0);
    riff.forEach(([i, midi, slide]) => { a[i] = { midi, slide }; });

    // A second version of the same line — same root, different movement.
    const b = Variations.bank(PART, 1);
    [[0,36,false],[2,36,false],[4,36,false],[6,43,true],[8,41,false],
     [10,41,false],[12,39,false],[14,34,true]]
      .forEach(([i, midi, slide]) => { b[i] = { midi, slide }; });
  }

  playBtn.addEventListener('click', () => {
    if (!Synth808.supported()) return;
    Synth808.ensureContext();
    Transport.toggle();
    if (!Transport.isPlaying) stopAll();
  });

  bpmInput.addEventListener('input', () => {
    const v = parseInt(bpmInput.value, 10);
    bpmVal.textContent = v;
    Transport.setBpm(v);
  });

  document.getElementById('seqClear').addEventListener('click', () => {
    pat().fill(null);
    render();
  });

  // Queued variation switches land on the bar line, before anything plays.
  Transport.onStep((ev) => Variations.tick(ev));
  Transport.onStep(onStep);
  Transport.onVisualStep(onVisualStep);

  window.addEventListener('bhs:refresh-views', () => render());

  window.addEventListener('bhs:clone-bass', (e) => {
    Variations.copyTo(PART, e.detail.target, a => a.map(n => n ? { midi: n.midi, slide: n.slide } : null));
  });

  let lastVar = 0;
  Variations.onChange((snap) => {
    if (snap[PART] && snap[PART].current !== lastVar) { lastVar = snap[PART].current; render(); }
  });
  Transport.onStateChange(s => {
    playBtn.textContent = s.playing ? 'Stop' : 'Play';
    playBtn.classList.toggle('primary', s.playing);
  });

  Transport.setLoop(0, STEPS, true);
  Transport.setBpm(parseInt(bpmInput.value, 10));

  // The keyboard page shares this voice, so knob moves there apply here too.
  window.addEventListener('bhs808params', (e) => { params = e.detail; });

  // Save/load talks to this module through events rather than reaching into it.
  window.addEventListener('bhs:collect-sequencer', (e) => {
    e.detail.part = Variations.serialize(PART);
  });
  window.addEventListener('bhs:apply-sequencer', (e) => {
    const coerce = (arr) => {
      const row = new Array(STEPS).fill(null);
      if (Array.isArray(arr)) arr.slice(0, STEPS).forEach((n, i) => {
        if (n && typeof n.midi === 'number') row[i] = { midi: n.midi, slide: !!n.slide };
      });
      return row;
    };
    if (e.detail.part) {
      Variations.restore(PART, e.detail.part, coerce);
    } else if (Array.isArray(e.detail.pattern)) {
      // Pre-variations projects: their one pattern becomes A.
      Variations.restore(PART, { current: 0, banks: [e.detail.pattern] }, coerce);
    }
    render();
    if (e.detail.bpm) {
      bpmInput.value = String(e.detail.bpm);
      bpmVal.textContent = String(e.detail.bpm);
    }
  });

  seedPattern();
  const varHost = document.getElementById('bassVar');
  if (varHost) varHost.appendChild(Variations.buildPicker(PART));
  render();
})();
