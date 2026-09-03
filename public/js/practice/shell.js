// shell.js — instrument-agnostic Practice Mode.
// Owns song setup, the note lane, the match loop wiring, success handling and
// settings. Knows nothing about microphones or fingerings — it drives whatever
// instrument module is active through the small interface in mic-instrument.js.

(function () {
  'use strict';

  const STORE_MODE = 'practice';
  const LS_KEY = 'rhythmshop:practice:prefs';

  // ---- preferences (persisted) -------------------------------------------
  const defaults = {
    instrumentId: 'flute',
    mode: 'straight',            // straight | progressive | random
    a4: 440,
    hold: 'normal',             // quick | normal | patient
    forgiveness: 'easy',        // strict | normal | easy
    metronome: false,
    bpm: 80,
    showNames: true,
    countIn: true,
    fluteChart: 'standard',
    fluteHelp: 'chart',
    pianoAnyOctave: false,
  };
  const HOLD_MS = { quick: 280, normal: 460, patient: 850 };
  const TOLERANCE = { strict: 28, normal: 45, easy: 60 };
  const CLARITY = { strict: 0.93, normal: 0.88, easy: 0.83 };

  let prefs = load();
  function load() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
    catch (e) { return Object.assign({}, defaults); }
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
  }

  // ---- tiny audio for chime + metronome (own context, no sync needs) -----
  const Sfx = (() => {
    let ctx = null;
    const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
    function blip(freq, t, dur, gainPeak) {
      const c = ac();
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gainPeak, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      resume() { const c = ac(); if (c.state === 'suspended') c.resume(); },
      chime() { const c = ac(), t = c.currentTime; blip(880, t, 0.18, 0.14); blip(1320, t + 0.09, 0.22, 0.12); },
      tick(strong) { const c = ac(), t = c.currentTime; blip(strong ? 1600 : 1050, t, 0.05, strong ? 0.12 : 0.07); },
      currentTime() { return ac().currentTime; },
    };
  })();

  // ---- metronome ---------------------------------------------------------
  const Metro = (() => {
    let timer = null, nextTime = 0, beat = 0;
    function loop() {
      const now = Sfx.currentTime();
      while (nextTime < now + 0.12) {
        Sfx.tick(beat % 4 === 0);
        setCount(beat % 4);
        beat = (beat + 1) % 4;
        nextTime += 60 / prefs.bpm;
      }
    }
    return {
      start() {
        if (timer) return;
        Sfx.resume();
        beat = 0; nextTime = Sfx.currentTime() + 0.1;
        timer = setInterval(loop, 25);
      },
      stop() { if (timer) clearInterval(timer); timer = null; setCount(-1); },
      running: () => !!timer,
    };
  })();

  // ---- DOM --------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const els = {
    instPicker: $('instPicker'),
    presetSel: $('presetSel'),
    loadPreset: $('loadPresetBtn'),
    toggleBuilder: $('toggleBuilderBtn'),
    builder: $('builder'),
    palette: $('notePalette'),
    builderSeq: $('builderSeq'),
    builderUndo: $('builderUndo'),
    builderClear: $('builderClear'),
    builderUse: $('builderUse'),
    typeInput: $('typeInput'),
    typeUse: $('typeUseBtn'),
    saveSong: $('saveSongBtn'),
    savedList: $('savedList'),
    modeSel: $('modeSel'),
    newDrill: $('newDrillBtn'),
    lane: $('lane'),
    laneWrap: $('laneWrap'),
    targetName: $('targetName'),
    mainDiagram: $('mainDiagram'),
    nextName: $('nextName'),
    nextDiagram: $('nextDiagram'),
    hearing: $('hearingText'),
    needle: $('needle'),
    level: $('levelFill'),
    progress: $('progressFill'),
    streak: $('streak'),
    beatDot: $('beatDot'),
    micBtn: $('micBtn'),
    skipBtn: $('skipBtn'),
    restartBtn: $('restartBtn'),
    banner: $('doneBanner'),
    settingsBtn: $('settingsBtn'),
    settings: $('settingsPanel'),
    instHelp: $('instHelp'),
    notice: $('notice'),
  };

  // ---- state ----------------------------------------------------------
  let inst = null;
  let baseTokens = PracticeSongs.presetById('mary');
  let slices = [baseTokens];
  let sliceIx = 0;
  let tokens = baseTokens;
  let notes = [];
  let index = 0;
  let listening = false;
  let streak = 0;
  let builderNotes = [];
  let lastCompleteAt = 0;

  // ---- instrument wiring --------------------------------------------------
  function applyOptionsToInstrument() {
    inst.setOptions({
      a4: prefs.a4,
      holdMs: HOLD_MS[prefs.hold],
      toleranceCents: TOLERANCE[prefs.forgiveness],
      clarityFloor: CLARITY[prefs.forgiveness],
    });
  }

  function selectInstrument(id, { reload = true } = {}) {
    if (listening) stopListening();
    inst = PracticeInstruments.byId(id) || PracticeInstruments.default();
    prefs.instrumentId = inst.id;
    persist();
    applyOptionsToInstrument();
    if (inst.applyPrefs) inst.applyPrefs(prefs);
    inst.onFrame(onFrame);
    inst.onMatch(onMatch);
    renderInstPicker();
    els.instHelp.textContent = inst.helpText || '';
    els.micBtn.textContent = startLabel();
    els.hearing.textContent = inst.uiMode === 'watch'
      ? 'Press “Start camera” and hold a finger on the lit key.'
      : 'Press “Start listening” and play.';
    buildPalette();
    renderSettings();
    if (reload) { rebuildSlices(); gotoNote(0); }
  }

  function renderInstPicker() {
    els.instPicker.innerHTML = '';
    PracticeInstruments.list.forEach(m => {
      const b = document.createElement('button');
      b.className = 'inst-btn' + (m.id === inst.id ? ' active' : '');
      b.textContent = m.label;
      b.addEventListener('click', () => selectInstrument(m.id));
      els.instPicker.appendChild(b);
    });
  }

  // ---- song loading ----------------------------------------------------
  function rebuildSlices() {
    if (prefs.mode === 'progressive') {
      slices = PracticeSongs.progressiveSlices(baseTokens, 4);
    } else if (prefs.mode === 'random') {
      const pool = PracticeSongs.distinctNotes(baseTokens);
      slices = [PracticeSongs.randomDrill(pool, Math.max(8, Math.min(16, baseTokens.length)))];
    } else {
      slices = [baseTokens];
    }
    sliceIx = 0;
    loadSlice();
  }

  function loadSlice() {
    tokens = slices[sliceIx];
    notes = tokens.map(t => NoteUtils.parseNote(t)).filter(Boolean);
    index = 0;
    els.banner.classList.remove('show');
    renderLane();
    gotoNote(0);
  }

  function loadSong(newTokens) {
    if (!newTokens || !newTokens.length) {
      flash(els.notice, 'Hmm — no playable notes there. Use letters A–G, like "E D C".');
      return;
    }
    baseTokens = newTokens;
    streak = 0; updateStreak();
    rebuildSlices();
  }

  // ---- note lane -------------------------------------------------------
  function renderLane() {
    els.lane.innerHTML = '';
    notes.forEach((n, i) => {
      const pill = document.createElement('div');
      pill.className = 'pill ' + (i < index ? 'done' : i === index ? 'current' : 'upcoming');
      pill.textContent = prefs.showNames ? shortName(n) : '•';
      els.lane.appendChild(pill);
    });
  }
  function shortName(n) {
    return NoteUtils.SHARP_NAMES[n.pc].replace('#', '♯');
  }
  function scrollLaneToCurrent() {
    const pill = els.lane.children[index];
    if (pill) pill.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  // ---- target / play area --------------------------------------------
  function gotoNote(i) {
    index = i;
    inst.resetHold();
    const cur = notes[index], nxt = notes[index + 1] || null;
    els.progress.style.width = '0%';

    if (!cur) { showComplete(); return; }

    els.targetName.textContent = cur.display;
    els.targetName.classList.remove('correct');
    els.nextName.textContent = nxt ? nxt.display : '—';
    inst.setTarget(cur);
    inst.renderDiagram(els.mainDiagram, cur, { role: 'current' });
    if (nxt) inst.renderDiagram(els.nextDiagram, nxt, { role: 'next' });
    else els.nextDiagram.innerHTML = '';

    renderLane();
    scrollLaneToCurrent();
  }

  function advance({ success }) {
    if (success) { streak++; } else { streak = 0; }
    updateStreak();

    if (index + 1 < notes.length) { gotoNote(index + 1); return; }

    // end of this slice
    if (prefs.mode === 'progressive' && sliceIx + 1 < slices.length) {
      sliceIx++;
      flash(els.notice, `Nice! Now the first ${slices[sliceIx].length} notes.`, 'good');
      loadSlice();
      return;
    }
    showComplete();
  }

  function showComplete() {
    els.lane.querySelectorAll('.pill').forEach(p => { p.className = 'pill done'; });
    els.targetName.textContent = '★';
    els.targetName.classList.add('correct');
    els.nextName.textContent = '—';
    els.mainDiagram.innerHTML = '';
    els.nextDiagram.innerHTML = '';
    els.banner.classList.add('show');
    els.progress.style.width = '0%';
  }

  // ---- the match loop (frames pushed from the instrument) ------------
  function onFrame(info) {
    if (info.requestStop) { stopListening(); return; }   // camera panel's ✕ button

    els.level.style.width = Math.round((info.level01 || 0) * 100) + '%';

    const near = info.matching;
    const watch = inst.uiMode === 'watch';
    els.needle.parentElement.style.display = watch ? 'none' : '';

    if (!watch) {
      const c = Math.max(-50, Math.min(50, info.cents || 0));
      els.needle.style.left = (50 + c) + '%';
      els.needle.classList.toggle('correct', near);
    }

    // status readout
    if (info.message !== undefined) {
      els.hearing.textContent = info.message;
    } else if (!info.hasTarget) {
      els.hearing.textContent = 'Pick a song to start.';
    } else if (info.heardFreq > 0) {
      let msg = 'I hear: ' + info.heardDisplay;
      if (near) msg += ' — hold it…';
      else if (Math.abs(info.cents) < 90) msg += (info.cents > 0 ? ' (a little high)' : ' (a little low)');
      els.hearing.textContent = msg;
    } else if (listening) {
      els.hearing.textContent = 'Listening… play the highlighted note.';
    }

    // hold progress + pill state
    els.progress.style.width = Math.round((info.progress01 || 0) * 100) + '%';
    const pill = els.lane.children[index];
    if (pill) pill.classList.toggle('correct', near);
    els.targetName.classList.toggle('correct', near);
  }

  function onMatch() {
    // guard against a double-fire right at completion
    const now = performance.now();
    if (now - lastCompleteAt < 250) return;
    lastCompleteAt = now;

    Sfx.chime();
    const pill = els.lane.children[index];
    if (pill) { pill.classList.add('pop'); }
    setTimeout(() => advance({ success: true }), 320);
  }

  // ---- listening control -------------------------------------------
  const startLabel = () => (inst.uiMode === 'watch' ? 'Start camera' : 'Start listening');
  const stopLabel = () => (inst.uiMode === 'watch' ? 'Stop camera' : 'Stop listening');

  async function startListening() {
    els.micBtn.disabled = true;
    els.micBtn.textContent = 'Turning on…';
    Sfx.resume();
    const res = await inst.start();
    els.micBtn.disabled = false;
    if (!res.ok) {
      els.micBtn.textContent = startLabel();
      flash(els.notice, res.error, 'bad', 8000);
      return;
    }
    listening = true;
    els.micBtn.textContent = stopLabel();
    els.micBtn.classList.add('live');
    if (prefs.metronome) Metro.start();
  }

  function stopListening() {
    listening = false;
    if (inst) inst.stop();
    Metro.stop();
    els.micBtn.textContent = startLabel();
    els.micBtn.classList.remove('live');
    els.hearing.textContent = 'Paused. Press the button to keep going.';
    els.level.style.width = '0%';
    els.progress.style.width = '0%';
  }

  // ---- streak / notices ------------------------------------------
  function updateStreak() {
    if (streak >= 3) {
      els.streak.textContent = '🔥 ' + streak + ' in a row';
      els.streak.classList.add('show');
    } else {
      els.streak.classList.remove('show');
    }
  }
  let noticeTimer = null;
  function flash(el, msg, kind, ms) {
    el.textContent = msg;
    el.className = 'notice show' + (kind ? ' ' + kind : '');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => el.classList.remove('show'), ms || 3500);
  }
  function setCount(beat) {
    const dot = els.beatDot;
    if (!dot) return;
    dot.textContent = beat < 0 ? '·' : String(beat + 1);
    dot.classList.toggle('pulse', beat === 0);
  }

  // ---- song builder --------------------------------------------------
  function buildPalette() {
    els.palette.innerHTML = '';
    // a friendly one-octave palette; chromatic notes tucked after
    const order = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C#', 'D#', 'F#', 'G#', 'A#'];
    order.forEach(name => {
      const b = document.createElement('button');
      b.className = 'pal-btn';
      b.textContent = name.replace('#', '♯');
      b.addEventListener('click', () => { builderNotes.push(name); renderBuilderSeq(); });
      els.palette.appendChild(b);
    });
  }
  function renderBuilderSeq() {
    els.builderSeq.textContent = builderNotes.length
      ? builderNotes.map(n => n.replace('#', '♯')).join('  ')
      : '(tap notes above)';
  }

  // ---- saved songs -------------------------------------------------
  async function renderSaved() {
    const names = await RhythmStorage.list(STORE_MODE);
    els.savedList.innerHTML = '';
    if (!names.length) { els.savedList.textContent = 'No saved songs yet.'; return; }
    names.forEach(name => {
      const b = document.createElement('button');
      b.textContent = name;
      b.title = 'Click to load, shift-click to delete';
      b.addEventListener('click', async (e) => {
        if (e.shiftKey) { await RhythmStorage.remove(STORE_MODE, name); renderSaved(); return; }
        const data = await RhythmStorage.load(STORE_MODE, name);
        if (data && Array.isArray(data.notes)) loadSong(data.notes);
      });
      els.savedList.appendChild(b);
    });
  }
  async function saveCurrentSong() {
    const name = prompt('Name this song:');
    if (!name) return;
    await RhythmStorage.save(STORE_MODE, name.trim().slice(0, 40), { notes: baseTokens });
    renderSaved();
  }

  // ---- settings panel ------------------------------------------------
  function renderSettings() {
    const p = els.settings;
    p.innerHTML = '';
    const row = (label, control) => {
      const l = document.createElement('label');
      l.className = 'set-row';
      l.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
      l.appendChild(control);
      p.appendChild(l);
      return l;
    };
    const select = (opts, val, on) => {
      const s = document.createElement('select');
      opts.forEach(([v, t]) => {
        const o = document.createElement('option'); o.value = v; o.textContent = t;
        s.appendChild(o);
      });
      s.value = val;
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const checkbox = (val, on) => {
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = val;
      c.addEventListener('change', () => on(c.checked));
      return c;
    };

    row('How long to hold each note', select(
      [['quick', 'Quick'], ['normal', 'Normal'], ['patient', 'Patient (easier)']],
      prefs.hold, v => { prefs.hold = v; persist(); applyOptionsToInstrument(); }));

    row('How forgiving on pitch', select(
      [['strict', 'Strict'], ['normal', 'Normal'], ['easy', 'Easy (recommended for beginners)']],
      prefs.forgiveness, v => { prefs.forgiveness = v; persist(); applyOptionsToInstrument(); }));

    row('Tuning reference (A =)', select(
      [['438', '438 Hz'], ['440', '440 Hz (standard)'], ['442', '442 Hz'], ['444', '444 Hz']],
      String(prefs.a4), v => { prefs.a4 = parseInt(v, 10); persist(); applyOptionsToInstrument(); }));

    row('Show note names on the strip', checkbox(prefs.showNames,
      v => { prefs.showNames = v; persist(); renderLane(); }));

    row('Metronome', checkbox(prefs.metronome,
      v => { prefs.metronome = v; persist(); if (v && listening) Metro.start(); if (!v) Metro.stop(); }));

    row('Metronome speed', select(
      [['60', 'Slow (60)'], ['72', '72'], ['80', '80'], ['96', '96'], ['112', 'Faster (112)']],
      String(prefs.bpm), v => { prefs.bpm = parseInt(v, 10); persist(); }));

    if (inst && inst.renderSettings) {
      const hr = document.createElement('div'); hr.className = 'set-sep';
      hr.textContent = inst.label + ' settings';
      p.appendChild(hr);
      inst.renderSettings(p, {
        prefs,
        save: (patch) => { Object.assign(prefs, patch); persist(); },
        redraw: () => gotoNote(index),
      });
    }
  }

  // ---- events -----------------------------------------------------
  els.loadPreset.addEventListener('click', () => loadSong(PracticeSongs.presetById(els.presetSel.value)));
  els.toggleBuilder.addEventListener('click', () => els.builder.classList.toggle('open'));
  els.builderUndo.addEventListener('click', () => { builderNotes.pop(); renderBuilderSeq(); });
  els.builderClear.addEventListener('click', () => { builderNotes = []; renderBuilderSeq(); });
  els.builderUse.addEventListener('click', () => { if (builderNotes.length) loadSong(builderNotes.slice()); });
  els.typeUse.addEventListener('click', () => loadSong(PracticeSongs.parseTokens(els.typeInput.value)));
  els.typeInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadSong(PracticeSongs.parseTokens(els.typeInput.value)); });
  els.saveSong.addEventListener('click', saveCurrentSong);
  els.modeSel.addEventListener('change', () => { prefs.mode = els.modeSel.value; persist(); syncModeUI(); rebuildSlices(); });
  els.newDrill.addEventListener('click', () => { els.banner.classList.remove('show'); streak = 0; updateStreak(); rebuildSlices(); });
  els.micBtn.addEventListener('click', () => (listening ? stopListening() : startListening()));
  els.skipBtn.addEventListener('click', () => advance({ success: false }));
  els.restartBtn.addEventListener('click', () => { els.banner.classList.remove('show'); sliceIx = 0; loadSlice(); streak = 0; updateStreak(); });
  els.settingsBtn.addEventListener('click', () => els.settings.classList.toggle('open'));
  window.addEventListener('practice:redraw', () => gotoNote(index));
  window.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); listening ? stopListening() : startListening(); }
    if (e.key === 'ArrowRight') advance({ success: false });
  });

  function syncModeUI() {
    els.newDrill.hidden = els.modeSel.value !== 'random';
  }

  // ---- init -----------------------------------------------------
  function init() {
    PracticeSongs.PRESETS.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.label;
      els.presetSel.appendChild(o);
    });
    els.presetSel.value = 'mary';
    els.modeSel.value = prefs.mode;
    syncModeUI();
    selectInstrument(prefs.instrumentId, { reload: false });
    loadSong(PracticeSongs.presetById('mary'));
    renderBuilderSeq();
    renderSaved();
  }
  init();
})();
