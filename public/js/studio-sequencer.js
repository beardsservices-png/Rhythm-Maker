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

  // pattern[i] = null | { midi, slide }
  let pattern = new Array(STEPS).fill(null);
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
    const cur = pattern[i];
    if (cur && cur.midi === midi) {
      pattern[i] = null;                       // clicking the same cell clears
    } else {
      pattern[i] = { midi, slide: cur ? cur.slide : false };
    }
    render();
  }

  function toggleSlide(i) {
    if (!pattern[i]) return;
    pattern[i].slide = !pattern[i].slide;
    render();
  }

  function render() {
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
    riff.forEach(([i, midi, slide]) => { pattern[i] = { midi, slide }; });
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
    pattern = new Array(STEPS).fill(null);
    render();
  });

  Transport.onStep(onStep);
  Transport.onVisualStep(onVisualStep);
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
    e.detail.pattern = pattern.map(n => n ? { midi: n.midi, slide: !!n.slide } : null);
  });
  window.addEventListener('bhs:apply-sequencer', (e) => {
    const p = e.detail.pattern;
    if (Array.isArray(p)) {
      pattern = new Array(STEPS).fill(null);
      p.slice(0, STEPS).forEach((n, i) => {
        if (n && typeof n.midi === 'number') pattern[i] = { midi: n.midi, slide: !!n.slide };
      });
      render();
    }
    if (e.detail.bpm) {
      bpmInput.value = String(e.detail.bpm);
      bpmVal.textContent = String(e.detail.bpm);
    }
  });

  seedPattern();
  render();
})();
