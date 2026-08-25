// studio-drums.js — drum lanes, each with its own A/B/C/D variations.
//
// Every lane is a separate part in the Variations bank, so the hats can move
// to B while the kick stays on A. That independence is the difference between
// two alternating beats and an actual arrangement.
//
// The voices come from Rhythm Shop's audio-engine.js, sharing this page's
// AudioContext via adoptContext — two contexts would mean two clocks and the
// kit would drift away from the bass.

(function () {
  const STEPS = 16;
  const LANES = [
    { id: 'kick_punchy',  label: 'Kick' },
    { id: 'snare_fat',    label: 'Snare' },
    { id: 'hat_closed',   label: 'Hat' },
    { id: 'hat_open',     label: 'Open hat' },
    { id: 'clap_classic', label: 'Clap' },
    { id: 'perc_shaker',  label: 'Shaker' }
  ];
  const partId = (li) => 'drum:' + li;

  const gridEl = document.getElementById('drumGrid');
  if (!gridEl || typeof RhythmAudio === 'undefined') return;

  let muted = LANES.map(() => false);

  LANES.forEach((_, li) => Variations.register(partId(li), () => new Array(STEPS).fill(false)));

  const laneSteps = (li) => Variations.active(partId(li));

  function seed() {
    // A: the basic beat.
    [0, 6, 10].forEach(i => Variations.bank(partId(0), 0)[i] = true);
    [4, 12].forEach(i => Variations.bank(partId(1), 0)[i] = true);
    for (let i = 0; i < STEPS; i += 2) Variations.bank(partId(2), 0)[i] = true;

    // B: same bones, busier — the "similar but different" second version.
    [0, 6, 10, 14].forEach(i => Variations.bank(partId(0), 1)[i] = true);
    [4, 12, 15].forEach(i => Variations.bank(partId(1), 1)[i] = true);
    for (let i = 0; i < STEPS; i++) Variations.bank(partId(2), 1)[i] = true;
    [7, 15].forEach(i => Variations.bank(partId(4), 1)[i] = true);
  }

  function onStep(ev) {
    const i = ((ev.loopStep % STEPS) + STEPS) % STEPS;
    LANES.forEach((lane, li) => {
      if (muted[li]) return;
      const steps = laneSteps(li);
      if (steps && steps[i]) RhythmAudio.playVoice(lane.id, ev.time);
    });
  }

  function onVisualStep(ev) {
    const i = ((ev.loopStep % STEPS) + STEPS) % STEPS;
    gridEl.querySelectorAll('.dcell.playing').forEach(c => c.classList.remove('playing'));
    gridEl.querySelectorAll(`.dcell[data-step="${i}"]`).forEach(c => c.classList.add('playing'));
  }

  function render() {
    gridEl.innerHTML = '';
    LANES.forEach((lane, li) => {
      const row = document.createElement('div');
      row.className = 'drow';

      const name = document.createElement('button');
      name.className = 'dname' + (muted[li] ? ' muted' : '');
      name.textContent = lane.label;
      name.title = 'Click to mute this lane';
      name.addEventListener('click', () => { muted[li] = !muted[li]; render(); });
      row.appendChild(name);

      row.appendChild(Variations.buildPicker(partId(li)));

      const cells = document.createElement('div');
      cells.className = 'dcells';
      const steps = laneSteps(li);
      for (let i = 0; i < STEPS; i++) {
        const c = document.createElement('div');
        c.className = 'dcell' + (steps[i] ? ' on' : '') + (i % 4 === 0 ? ' beat' : '');
        c.dataset.step = String(i);
        c.setAttribute('role', 'button');
        c.tabIndex = 0;
        c.setAttribute('aria-label', `${lane.label} step ${i + 1}`);
        const toggle = () => {
          const cur = laneSteps(li);
          cur[i] = !cur[i];
          c.classList.toggle('on', cur[i]);
          if (cur[i] && !Transport.isPlaying) {
            RhythmAudio.playVoice(lane.id, RhythmAudio.ensureContext().currentTime);
          }
        };
        c.addEventListener('click', toggle);
        c.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
        cells.appendChild(c);
      }
      row.appendChild(cells);
      gridEl.appendChild(row);
    });
  }

  // Repaint every picker on the page when the bank changes, and redraw the
  // grid when the live variation actually flips.
  let lastSig = '';
  Variations.onChange((snap) => {
    const sig = LANES.map((_, li) => (snap[partId(li)] || {}).current).join(',');
    if (sig !== lastSig) { lastSig = sig; render(); }
  });

  document.getElementById('drumClear').addEventListener('click', () => {
    LANES.forEach((_, li) => laneSteps(li).fill(false));
    render();
  });

  const shared = Synth808.ensureContext();
  if (shared) RhythmAudio.adoptContext(shared);

  Transport.onStep(onStep);
  Transport.onVisualStep(onVisualStep);

  window.addEventListener('bhs:collect-drums', (e) => {
    e.detail.parts = LANES.map((_, li) => Variations.serialize(partId(li)));
    e.detail.muted = muted.slice();
  });
  window.addEventListener('bhs:apply-drums', (e) => {
    const coerce = (arr) => {
      const row = new Array(STEPS).fill(false);
      if (Array.isArray(arr)) arr.slice(0, STEPS).forEach((v, i) => row[i] = !!v);
      return row;
    };
    if (Array.isArray(e.detail.parts)) {
      LANES.forEach((_, li) => Variations.restore(partId(li), e.detail.parts[li], coerce));
    } else if (Array.isArray(e.detail.lanes)) {
      // Projects saved before variations existed: their single pattern is A.
      LANES.forEach((_, li) => Variations.restore(
        partId(li), { current: 0, banks: [e.detail.lanes[li]] }, coerce));
    }
    if (Array.isArray(e.detail.muted)) muted = LANES.map((_, li) => !!e.detail.muted[li]);
    render();
  });

  // Claude drives the same lanes the buttons do, so it goes through events
  // rather than reaching into this module's state.
  window.addEventListener('bhs:set-drum-mute', (e) => {
    const li = e.detail.lane;
    if (li >= 0 && li < LANES.length) { muted[li] = !!e.detail.muted; render(); }
  });
  window.addEventListener('bhs:refresh-views', () => render());

  window.addEventListener('bhs:clone-drums', (e) => {
    LANES.forEach((_, li) => Variations.copyTo(partId(li), e.detail.target, a => a.slice()));
  });

  seed();
  render();
})();
