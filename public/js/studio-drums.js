// studio-drums.js — drum machine lanes, sharing the 808's clock.
//
// The voices themselves come from Rhythm Shop's audio-engine.js rather than
// being rewritten: 26 hand-tuned synth drums with per-instrument reverb sends
// already exist there, and they already schedule at an absolute time. What was
// missing is that the engine built its OWN AudioContext, so drums and bass
// would each run a private clock and drift apart within seconds. adoptContext
// hands it the studio's context before anything sounds.
//
// Polyphonic, unlike the bassline: a kit plays several pieces at once, and
// each hit is fire-and-forget with its own decay, so nothing needs holding.

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

  const gridEl = document.getElementById('drumGrid');
  if (!gridEl || typeof RhythmAudio === 'undefined') return;

  // lanes[laneIndex][step] = bool
  let lanes = LANES.map(() => new Array(STEPS).fill(false));
  let muted = LANES.map(() => false);

  function seed() {
    const kick = [0, 6, 10];
    const snare = [4, 12];
    kick.forEach(i => lanes[0][i] = true);
    snare.forEach(i => lanes[1][i] = true);
    for (let i = 0; i < STEPS; i += 2) lanes[2][i] = true;
  }

  // ── audio: inside the scheduler, always at a future time ──
  function onStep(ev) {
    const i = ((ev.loopStep % STEPS) + STEPS) % STEPS;
    lanes.forEach((lane, li) => {
      if (muted[li] || !lane[i]) return;
      RhythmAudio.playVoice(LANES[li].id, ev.time);
    });
  }

  // ── visual: on rAF, once the audio clock has caught up ──
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

      const cells = document.createElement('div');
      cells.className = 'dcells';
      for (let i = 0; i < STEPS; i++) {
        const c = document.createElement('div');
        c.className = 'dcell' + (lanes[li][i] ? ' on' : '') + (i % 4 === 0 ? ' beat' : '');
        c.dataset.step = String(i);
        c.setAttribute('role', 'button');
        c.tabIndex = 0;
        c.setAttribute('aria-label', `${lane.label} step ${i + 1}`);
        const toggle = () => {
          lanes[li][i] = !lanes[li][i];
          c.classList.toggle('on', lanes[li][i]);
          // Audition the hit so editing while stopped still makes a sound.
          if (lanes[li][i] && !Transport.isPlaying) {
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

  document.getElementById('drumClear').addEventListener('click', () => {
    lanes = LANES.map(() => new Array(STEPS).fill(false));
    render();
  });

  // Share the studio's clock. Must happen before any voice sounds, or the
  // engine builds its own context and the kit drifts from the bass.
  const shared = Synth808.ensureContext();
  if (shared) RhythmAudio.adoptContext(shared);

  Transport.onStep(onStep);
  Transport.onVisualStep(onVisualStep);

  window.addEventListener('bhs:collect-drums', (e) => {
    e.detail.lanes = lanes.map(l => l.slice());
    e.detail.muted = muted.slice();
  });
  window.addEventListener('bhs:apply-drums', (e) => {
    const L = e.detail.lanes;
    if (Array.isArray(L)) {
      lanes = LANES.map((_, li) => {
        const row = new Array(STEPS).fill(false);
        if (Array.isArray(L[li])) L[li].slice(0, STEPS).forEach((v, i) => row[i] = !!v);
        return row;
      });
    }
    if (Array.isArray(e.detail.muted)) {
      muted = LANES.map((_, li) => !!e.detail.muted[li]);
    }
    render();
  });

  seed();
  render();
})();
