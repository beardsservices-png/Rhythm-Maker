(function () {
  const MODE = 'roundrobin';
  const TOTAL_STEPS = 32;
  const DENSITY_STEPS = [32, 16, 8, 4, 2, 1];

  let layers = [];       // { voiceId, steps, cells: bool[] }
  let sectionB = null;
  let currentSection = 'A';
  let songForm = false;
  let bpm = 100;
  let scheduler = null;
  let formIndex = 0;
  let pendingFamily = null; // family chosen but variant not yet picked, for the add-layer flow
  const FORM = ['A', 'A', 'B', 'A'];

  const layersEl = document.getElementById('layers');
  const addLayerEl = document.getElementById('addLayerControls');
  const playBtn = document.getElementById('playBtn');
  const bpmInput = document.getElementById('bpm');
  const bpmVal = document.getElementById('bpmVal');
  const missEl = document.getElementById('mississippi');
  const genBBtn = document.getElementById('genBBtn');
  const songFormBtn = document.getElementById('songFormBtn');
  const songFormEl = document.getElementById('songFormLabel');
  const notice = document.getElementById('notice');
  const saveBtn = document.getElementById('saveBtn');
  const savedListEl = document.getElementById('savedList');
  const usedVoiceIds = new Set();

  function voiceMeta(id) { return RhythmAudio.voiceById(id); }

  function renderAddLayerControls() {
    addLayerEl.innerHTML = '';
    if (layers.length >= DENSITY_STEPS.length) {
      addLayerEl.textContent = 'Max layers reached (6 of 6).';
      return;
    }
    const label = document.createElement('span');
    label.className = 'song-form';
    label.textContent = `Add layer (${DENSITY_STEPS[layers.length]}-step density):`;
    addLayerEl.appendChild(label);

    if (!pendingFamily) {
      RhythmAudio.families().forEach(fam => {
        const availableVariants = fam.variants.filter(v => !usedVoiceIds.has(v.id));
        if (!availableVariants.length) return;
        const b = document.createElement('button');
        b.textContent = fam.label;
        b.style.borderColor = fam.color;
        b.addEventListener('click', () => { pendingFamily = fam.id; renderAddLayerControls(); });
        addLayerEl.appendChild(b);
      });
    } else {
      const fam = RhythmAudio.families().find(f => f.id === pendingFamily);
      const back = document.createElement('button');
      back.textContent = '← Back';
      back.addEventListener('click', () => { pendingFamily = null; renderAddLayerControls(); });
      addLayerEl.appendChild(back);
      fam.variants.filter(v => !usedVoiceIds.has(v.id)).forEach(v => {
        const b = document.createElement('button');
        b.textContent = v.variant;
        b.addEventListener('click', () => { addLayer(v.id); pendingFamily = null; });
        addLayerEl.appendChild(b);
      });
    }
  }

  function addLayer(voiceId) {
    if (layers.length >= DENSITY_STEPS.length) return;
    const steps = DENSITY_STEPS[layers.length];
    const cells = new Array(steps).fill(false);
    for (let i = 0; i < steps; i++) {
      cells[i] = i === 0 ? true : Math.random() < 0.35;
    }
    layers.push({ voiceId, steps, cells });
    usedVoiceIds.add(voiceId);
    renderLayers();
    renderAddLayerControls();
  }

  function removeLayer(idx) {
    usedVoiceIds.delete(layers[idx].voiceId);
    layers.splice(idx, 1);
    layers.forEach((layer, i) => {
      const targetSteps = DENSITY_STEPS[i];
      if (layer.steps !== targetSteps) {
        layer.cells = resampleCells(layer.cells, layer.steps, targetSteps);
        layer.steps = targetSteps;
      }
    });
    renderLayers();
    renderAddLayerControls();
  }

  function resampleCells(cells, fromSteps, toSteps) {
    const out = new Array(toSteps).fill(false);
    for (let i = 0; i < toSteps; i++) {
      const srcIdx = Math.floor(i * fromSteps / toSteps);
      out[i] = !!cells[srcIdx];
    }
    return out;
  }

  // Play needs at least one layer; Generate Section B needs one too. Both are
  // shown disabled with a reason rather than silently doing nothing.
  function updateControls() {
    const hasLayers = layers.length > 0;
    genBBtn.disabled = !hasLayers;
    playBtn.disabled = !hasLayers;
    playBtn.title = hasLayers ? '' : 'Add at least one layer first';
    playBtn.setAttribute('aria-disabled', hasLayers ? 'false' : 'true');
    if (saveBtn) {
      saveBtn.disabled = !hasLayers;
      saveBtn.title = hasLayers ? '' : 'Add at least one layer first';
    }
  }

  function renderLayers() {
    layersEl.innerHTML = '';
    updateControls();
    if (!layers.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No layers yet — add your first instrument below to start the round robin.';
      layersEl.appendChild(empty);
      return;
    }
    const activeLayers = currentSection === 'B' && sectionB ? sectionB : layers;
    activeLayers.forEach((layer, idx) => {
      const meta = voiceMeta(layer.voiceId);
      const wrap = document.createElement('div');
      wrap.className = 'layer';

      const hdr = document.createElement('div');
      hdr.className = 'layer-hdr';
      const name = document.createElement('span');
      name.className = 'name';
      name.style.color = meta.color;
      name.textContent = `${meta.familyLabel} — ${meta.variant} · ${layer.steps}-step`;
      hdr.appendChild(name);
      if (currentSection === 'A') {
        const rm = document.createElement('button');
        rm.textContent = 'Remove';
        rm.addEventListener('click', () => removeLayer(idx));
        hdr.appendChild(rm);
      }
      wrap.appendChild(hdr);

      const grid = document.createElement('div');
      grid.className = 'layer-grid';
      grid.style.gridTemplateColumns = `repeat(${layer.steps}, 1fr)`;
      layer.cells.forEach((on, i) => {
        const cell = document.createElement('div');
        cell.className = 'cell' + (on ? ' on' : '');
        cell.style.background = on ? meta.color : '';
        cell.style.borderColor = on ? meta.color : '';
        cell.tabIndex = 0;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-pressed', on ? 'true' : 'false');
        cell.setAttribute('aria-label', `${meta.familyLabel} ${meta.variant} step ${i + 1}`);
        const toggle = () => {
          layer.cells[i] = !layer.cells[i];
          renderLayers();
        };
        cell.addEventListener('click', toggle);
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
        grid.appendChild(cell);
      });
      wrap.appendChild(grid);
      layersEl.appendChild(wrap);
    });
  }

  function generateSectionB() {
    if (!layers.length) return;
    sectionB = layers.map(layer => {
      const meta = voiceMeta(layer.voiceId);
      const cells = layer.cells.slice();
      if (meta.family === 'hihat') {
        for (let i = 0; i < cells.length; i++) if (Math.random() < 0.5) cells[i] = true;
      } else if (meta.family === 'bass' || meta.family === 'kick') {
        for (let i = 0; i < cells.length; i++) if (i % 2 === 0) cells[i] = true;
      } else {
        for (let i = 0; i < cells.length; i++) if (Math.random() < 0.4) cells[i] = false;
      }
      return { voiceId: layer.voiceId, steps: layer.steps, cells };
    });
    renderLayers();
  }

  function updateMississippi(step) {
    const beat = Math.floor(step / 8) % 4 + 1;
    const sub = step % 8;
    missEl.textContent = sub === 0 ? `${beat} Mississippi` : `${beat}`;
  }

  function onStep(step, time) {
    document.querySelectorAll('.layer .cell').forEach(c => c.classList.remove('playing'));
    updateMississippi(step);

    const activeLayers = currentSection === 'B' && sectionB ? sectionB : layers;
    const grids = layersEl.querySelectorAll('.layer-grid');

    activeLayers.forEach((layer, li) => {
      const stride = TOTAL_STEPS / layer.steps;
      if (step % stride !== 0) return;
      const layerStep = step / stride;
      if (layer.cells[layerStep]) {
        RhythmAudio.playVoice(layer.voiceId, time);
      }
      const cellEl = grids[li] && grids[li].children[layerStep];
      if (cellEl) cellEl.classList.add('playing');
    });

    if (songForm && step === TOTAL_STEPS - 1) {
      formIndex = (formIndex + 1) % FORM.length;
      currentSection = FORM[formIndex];
      renderLayers();
      updateSongFormLabel();
    }
  }

  function updateSongFormLabel() {
    if (!songForm) { songFormEl.textContent = ''; return; }
    songFormEl.innerHTML = FORM.map((s, i) =>
      `<span class="${i === formIndex ? 'active' : ''}">${s}</span>`
    ).join(' · ');
  }

  function togglePlay() {
    if (!RhythmAudio.supported()) {
      notice.textContent = 'Your browser does not support the Web Audio API — try Chrome, Safari, or Firefox.';
      notice.classList.add('show');
      return;
    }
    if (!layers.length) return;
    if (!scheduler) {
      scheduler = RhythmAudio.createScheduler({
        stepsPerLoop: TOTAL_STEPS,
        getBpm: () => bpm,
        onStep,
        subdivision: 8
      });
    }
    if (scheduler.isRunning()) {
      scheduler.stop();
      playBtn.textContent = 'Play';
      document.querySelectorAll('.layer .cell').forEach(c => c.classList.remove('playing'));
    } else {
      RhythmAudio.ensureContext();
      formIndex = 0;
      currentSection = songForm ? 'A' : currentSection;
      scheduler.start();
      playBtn.textContent = 'Stop';
    }
  }

  function toggleSongForm() {
    songForm = !songForm;
    songFormBtn.classList.toggle('primary', songForm);
    formIndex = 0;
    currentSection = 'A';
    updateSongFormLabel();
    renderLayers();
  }

  function toggleSection() {
    if (!sectionB) return;
    currentSection = currentSection === 'A' ? 'B' : 'A';
    renderLayers();
  }

  // ---- Save / load: full layer set + tempo, persisted via the server volume ----
  function serialize() {
    return {
      bpm,
      songForm,
      layers: layers.map(l => ({ voiceId: l.voiceId, steps: l.steps, cells: l.cells.slice() })),
      sectionB: sectionB ? sectionB.map(l => ({ voiceId: l.voiceId, steps: l.steps, cells: l.cells.slice() })) : null
    };
  }

  function loadState(data) {
    if (!data || !Array.isArray(data.layers)) return;
    if (scheduler && scheduler.isRunning()) { scheduler.stop(); playBtn.textContent = 'Play'; }
    layers = data.layers
      .filter(l => RhythmAudio.voiceById(l.voiceId))
      .slice(0, DENSITY_STEPS.length)
      .map((l, i) => {
        const steps = DENSITY_STEPS[i];
        const cells = Array.isArray(l.cells) ? resampleCells(l.cells, l.cells.length, steps) : new Array(steps).fill(false);
        return { voiceId: l.voiceId, steps, cells };
      });
    usedVoiceIds.clear();
    layers.forEach(l => usedVoiceIds.add(l.voiceId));
    sectionB = Array.isArray(data.sectionB)
      ? data.sectionB.filter(l => RhythmAudio.voiceById(l.voiceId)).map((l, i) => ({
          voiceId: l.voiceId, steps: DENSITY_STEPS[i] || l.steps,
          cells: Array.isArray(l.cells) ? l.cells.slice() : []
        }))
      : null;
    bpm = Math.min(200, Math.max(60, parseInt(data.bpm, 10) || 100));
    bpmInput.value = bpm;
    bpmVal.textContent = bpm;
    songForm = false;
    songFormBtn.classList.remove('primary');
    currentSection = 'A';
    formIndex = 0;
    pendingFamily = null;
    updateSongFormLabel();
    renderLayers();
    renderAddLayerControls();
  }

  async function renderSavedList() {
    const names = await RhythmStorage.list(MODE);
    savedListEl.innerHTML = '';
    if (!names.length) { savedListEl.textContent = 'No saved patterns yet.'; return; }
    names.forEach(name => {
      const b = document.createElement('button');
      b.textContent = name;
      b.title = 'Click to load, shift-click to delete';
      b.addEventListener('click', async (e) => {
        if (e.shiftKey) { await RhythmStorage.remove(MODE, name); renderSavedList(); return; }
        const data = await RhythmStorage.load(MODE, name);
        if (data) loadState(data);
      });
      savedListEl.appendChild(b);
    });
  }

  async function save() {
    if (!layers.length) return;
    const name = prompt('Name this pattern:');
    if (!name) return;
    await RhythmStorage.save(MODE, name, serialize());
    renderSavedList();
  }

  bpmInput.addEventListener('input', () => {
    bpm = parseInt(bpmInput.value, 10);
    bpmVal.textContent = bpm;
  });
  saveBtn.addEventListener('click', save);
  playBtn.addEventListener('click', togglePlay);
  genBBtn.addEventListener('click', generateSectionB);
  songFormBtn.addEventListener('click', toggleSongForm);
  document.getElementById('sectionToggleBtn').addEventListener('click', toggleSection);

  renderLayers();
  renderAddLayerControls();
  renderSavedList();

  if (window.initAssistPanel) {
    initAssistPanel({
      getContext() {
        return {
          mode: MODE,
          bpm,
          layers: layers.map(l => ({ family: voiceMeta(l.voiceId).family, steps: l.steps, hits: l.cells.filter(Boolean).length }))
        };
      },
      applyActions(actions) {
        actions.forEach(a => {
          if (a.type === 'adjust_density') {
            const amount = Math.min(0.5, Math.max(0.1, a.amount || 0.25));
            layers.forEach(layer => {
              const fam = voiceMeta(layer.voiceId).family;
              if (a.target !== 'all' && a.target !== fam) return;
              layer.cells = layer.cells.map(on => {
                if (a.direction === 'more' && !on) return Math.random() < amount;
                if (a.direction === 'less' && on) return !(Math.random() < amount);
                return on;
              });
            });
            renderLayers();
          } else if (a.type === 'toggle_swing') {
            // Simple swing approximation: shift every other active hit slightly
            // by toggling a neighboring cell off to create push/pull feel.
            const amount = Math.min(0.4, Math.max(0.1, a.amount || 0.2));
            layers.forEach(layer => {
              const fam = voiceMeta(layer.voiceId).family;
              if (a.target !== 'all' && a.target !== fam) return;
              for (let i = 1; i < layer.cells.length; i += 2) {
                if (layer.cells[i] && Math.random() < amount) {
                  layer.cells[i] = false;
                  layer.cells[i - 1] = true;
                }
              }
            });
            renderLayers();
          } else if (a.type === 'set_bpm' && a.bpm) {
            bpm = Math.min(200, Math.max(60, a.bpm));
            bpmInput.value = bpm;
            bpmVal.textContent = bpm;
          }
        });
      }
    });
  }
})();
