(function () {
  const MODE = 'freeplay';
  const STEPS = 32;
  let pattern = new Array(STEPS).fill(false);
  let currentFamily = 'kick';
  let currentVoiceId = 'kick_deep';
  let bpm = 110;
  let scheduler = null;

  const gridEl = document.getElementById('grid');
  const missEl = document.getElementById('mississippi');
  const bpmVal = document.getElementById('bpmVal');
  const bpmInput = document.getElementById('bpm');
  const playBtn = document.getElementById('playBtn');
  const randomizeBtn = document.getElementById('randomizeBtn');
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');
  const savedListEl = document.getElementById('savedList');
  const familyPickerEl = document.getElementById('familyPicker');
  const variantPickerEl = document.getElementById('variantPicker');
  const notice = document.getElementById('notice');

  function renderFamilyPicker() {
    familyPickerEl.innerHTML = '';
    RhythmAudio.families().forEach(fam => {
      const b = document.createElement('button');
      b.className = 'family-btn' + (fam.id === currentFamily ? ' active' : '');
      b.textContent = fam.label;
      b.style.borderColor = fam.color;
      b.addEventListener('click', () => {
        currentFamily = fam.id;
        currentVoiceId = fam.variants[0].id;
        renderFamilyPicker();
        renderVariantPicker();
      });
      familyPickerEl.appendChild(b);
    });
  }

  function renderVariantPicker() {
    variantPickerEl.innerHTML = '';
    const fam = RhythmAudio.families().find(f => f.id === currentFamily);
    fam.variants.forEach(v => {
      const b = document.createElement('button');
      b.className = 'variant-btn' + (v.id === currentVoiceId ? ' active' : '');
      b.textContent = v.variant;
      b.addEventListener('click', () => {
        currentVoiceId = v.id;
        renderVariantPicker();
      });
      variantPickerEl.appendChild(b);
    });
  }

  function renderGrid() {
    gridEl.innerHTML = '';
    for (let i = 0; i < STEPS; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (pattern[i] ? ' on' : '');
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-pressed', pattern[i] ? 'true' : 'false');
      cell.setAttribute('aria-label', `Step ${i + 1}`);
      const toggle = () => {
        pattern[i] = !pattern[i];
        cell.classList.toggle('on', pattern[i]);
        cell.setAttribute('aria-pressed', pattern[i] ? 'true' : 'false');
      };
      cell.addEventListener('click', toggle);
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      gridEl.appendChild(cell);
    }
  }

  function randomize() {
    pattern = pattern.map((_, i) => {
      if (i % 8 === 0) return Math.random() < 0.85;
      if (i % 4 === 0) return Math.random() < 0.4;
      if (i % 2 === 0) return Math.random() < 0.2;
      return Math.random() < 0.08;
    });
    renderGrid();
  }

  function clearPattern() {
    pattern = new Array(STEPS).fill(false);
    renderGrid();
  }

  function densityShift(direction, amount) {
    // Used by the assist panel: nudge density up/down without regenerating the whole pattern.
    pattern = pattern.map(on => {
      if (direction === 'more' && !on) return Math.random() < amount;
      if (direction === 'less' && on) return !(Math.random() < amount);
      return on;
    });
    renderGrid();
  }

  function updateMississippi(step) {
    const beat = Math.floor(step / 8) % 4 + 1;
    const sub = step % 8;
    missEl.textContent = sub === 0 ? `${beat} Mississippi` : `${beat}`;
  }

  function onStep(step, time) {
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('playing'));
    const cell = gridEl.children[step];
    if (cell) cell.classList.add('playing');
    updateMississippi(step);
    if (pattern[step]) {
      RhythmAudio.playVoice(currentVoiceId, time);
    }
  }

  function togglePlay() {
    if (!RhythmAudio.supported()) {
      notice.textContent = 'Your browser does not support the Web Audio API — try Chrome, Safari, or Firefox.';
      notice.classList.add('show');
      return;
    }
    if (!scheduler) {
      scheduler = RhythmAudio.createScheduler({
        stepsPerLoop: STEPS,
        getBpm: () => bpm,
        onStep,
        subdivision: 8
      });
    }
    if (scheduler.isRunning()) {
      scheduler.stop();
      playBtn.textContent = 'Play';
      document.querySelectorAll('.cell').forEach(c => c.classList.remove('playing'));
    } else {
      RhythmAudio.ensureContext();
      scheduler.start();
      playBtn.textContent = 'Stop';
    }
  }

  async function renderSavedList() {
    const names = await RhythmStorage.list(MODE);
    savedListEl.innerHTML = '';
    if (!names.length) {
      savedListEl.textContent = 'No saved patterns yet.';
      return;
    }
    names.forEach(name => {
      const b = document.createElement('button');
      b.textContent = name;
      b.title = 'Click to load, shift-click to delete';
      b.addEventListener('click', async (e) => {
        if (e.shiftKey) {
          await RhythmStorage.remove(MODE, name);
          renderSavedList();
          return;
        }
        const data = await RhythmStorage.load(MODE, name);
        if (data) {
          pattern = data.pattern;
          currentVoiceId = data.voiceId || data.instrument || 'kick_deep';
          const v = RhythmAudio.voiceById(currentVoiceId);
          currentFamily = v ? v.family : 'kick';
          bpm = data.bpm;
          bpmInput.value = bpm;
          bpmVal.textContent = bpm;
          renderFamilyPicker();
          renderVariantPicker();
          renderGrid();
        }
      });
      savedListEl.appendChild(b);
    });
  }

  async function save() {
    const name = prompt('Name this pattern:');
    if (!name) return;
    await RhythmStorage.save(MODE, name, { pattern, voiceId: currentVoiceId, bpm });
    renderSavedList();
  }

  bpmInput.addEventListener('input', () => {
    bpm = parseInt(bpmInput.value, 10);
    bpmVal.textContent = bpm;
  });
  playBtn.addEventListener('click', togglePlay);
  randomizeBtn.addEventListener('click', randomize);
  clearBtn.addEventListener('click', clearPattern);
  saveBtn.addEventListener('click', save);

  renderFamilyPicker();
  renderVariantPicker();
  renderGrid();
  renderSavedList();
  randomize();

  // Wire up the "Ask Claude" assist panel — it can nudge density/swing/tempo,
  // it never overwrites the pattern wholesale.
  if (window.initAssistPanel) {
    initAssistPanel({
      getContext() {
        return {
          mode: MODE,
          instrument: currentVoiceId,
          bpm,
          hitCount: pattern.filter(Boolean).length,
          totalSteps: STEPS
        };
      },
      applyActions(actions) {
        actions.forEach(a => {
          if (a.type === 'adjust_density' && (a.target === currentFamily || a.target === 'all')) {
            densityShift(a.direction, Math.min(0.5, Math.max(0.1, a.amount || 0.25)));
          } else if (a.type === 'set_bpm' && a.bpm) {
            bpm = Math.min(200, Math.max(60, a.bpm));
            bpmInput.value = bpm;
            bpmVal.textContent = bpm;
          }
          // toggle_swing has no direct single-instrument grid equivalent in Freeplay's
          // flat 32-step grid; Round Robin's layered grids are where swing applies.
        });
      }
    });
  }
})();
