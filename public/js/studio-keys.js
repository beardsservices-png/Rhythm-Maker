// studio-keys.js — the dock pinned to the bottom of the screen: a keyboard (or
// drum pads) and the knobs for whatever it's playing.
//
// It's pinned on purpose. On the old page the 808 keys and knobs sat at the
// top and the drums halfway down, so you couldn't reach both mid-take. Now the
// dock never scrolls away, whatever you're editing above it.
//
// "Play" picks any instrument track (808, piano, strings …) or Drum pads, and
// "Sound" changes that track's instrument. "Write notes" records what you play
// into the pattern, snapped to the nearest sixteenth, while the song runs.
//
// Also exposes a tiny Keys API so the MIDI keyboard plays through exactly the
// same path (voice limits, slide, the on-screen key lighting up, recording).

const Keys = (() => {
  const $ = (id) => document.getElementById(id);
  const kbEl = $('keyboard');
  const knobsEl = $('knobs');
  const targetSel = $('keysTarget');
  const soundSel = $('keysSound');
  const kitSel = $('keysKit');
  const nowEl = $('nowNote');
  const slideBtn = $('slideBtn');
  const recBtn = $('recNotes');
  const SPB = Project.STEPS_PER_BAR;
  const MAX_VOICES = 10;
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (m) => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const BLACK = [1, 3, 6, 8, 10];
  const KEYMAP = {
    z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
    q: 12, 2: 13, w: 14, 3: 15, e: 16, 4: 17, r: 18, 5: 19, t: 20, 6: 21, y: 22, 7: 23, u: 24
  };
  const PADKEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'];

  let target = null;              // track id, or 'drums'
  const octaveBase = new Map();   // trackId -> lowest midi shown
  let slide = false;
  let recOn = false;
  let bend = 0;
  const live = new Map();         // midi -> { h, track }
  let lastHandle = null;
  const takes = new Map();        // midi -> pending recorded note

  function synthTracks() { return Project.tracks().filter(t => t.kind === 'synth'); }
  function drumTracks() { return Project.tracks().filter(t => t.kind === 'drum'); }
  function cur() { return target === 'drums' ? null : Project.track(target); }

  function baseFor(t) {
    if (octaveBase.has(t.id)) return octaveBase.get(t.id);
    const lo = Instruments.range(t.instrument)[0];
    const b = t.instrument === '808' ? 24 : Math.max(36, Math.ceil(lo / 12) * 12 + (lo < 48 ? 12 : 0));
    return b;
  }

  // ── sound out ──
  function noteOn(midi, velocity) {
    const t = cur();
    if (!t) return false;
    const ac = App.ensureAudio(); if (!ac) return false;
    if (live.has(midi)) return true;
    const vel = velocity == null ? 0.85 : velocity;

    if (slide && lastHandle && !lastHandle.h.stopped && lastHandle.track === t.id) {
      const from = lastHandle.h.midi;
      lastHandle.h.slideTo(midi, 0.09);
      live.forEach((v, k) => { if (v === lastHandle) live.delete(k); });
      live.set(midi, lastHandle);
      paintKey(from, false); paintKey(midi, true);
      show(midi, true);
      return true;
    }
    if (live.size >= MAX_VOICES) {
      const oldest = live.keys().next().value;
      noteOff(oldest);
    }
    const h = Instruments.noteOn(ac, Sequencer.liveInput(t.id), t.instrument, midi, vel, ac.currentTime, t.params);
    if (!h) return false;
    if (bend) h.setBend(bend);
    const rec = { h, track: t.id };
    live.set(midi, rec);
    lastHandle = rec;
    paintKey(midi, true);
    show(midi, false);
    startTake(t, midi, vel);
    return true;
  }

  function noteOff(midi) {
    const v = live.get(midi);
    if (!v) return;
    if (v.h.midi === midi || !slide) v.h.release();
    live.delete(midi);
    paintKey(midi, false);
    endTake(midi);
    if (!live.size) nowEl.textContent = '—';
  }

  function allOff() { Array.from(live.keys()).forEach(noteOff); }

  function setBend(semis) {
    bend = semis || 0;
    live.forEach(v => { if (!v.h.stopped) v.h.setBend(bend); });
  }

  function hitDrum(trackId, velocity) {
    const t = Project.track(trackId);
    if (!t || t.kind !== 'drum') return false;
    const ac = App.ensureAudio(); if (!ac) return false;
    DrumKits.hit(ac, Sequencer.liveInput(t.id), t.sound, ac.currentTime, velocity == null ? 0.9 : velocity);
    const pad = kbEl.querySelector(`.pad[data-id="${t.id}"]`);
    if (pad) { pad.classList.add('down'); setTimeout(() => pad.classList.remove('down'), 110); }
    if (recOn && Transport.isPlaying) {
      const e = Sequencer.stepAt(ac.currentTime);
      if (e) {
        const p = Sequencer.trackPosition(t, e);
        const v = p.v >= 0 ? p.v : t.edit;
        const steps = Project.pattern(t.id, v).slice();
        steps[p.idx % (t.bars * SPB)] = true;
        Project.setPatternSteps(t.id, v, steps);
      }
    }
    return true;
  }

  // ── write notes into the pattern while it plays ──
  function startTake(t, midi, vel) {
    if (!recOn || !Transport.isPlaying) return;
    const ac = Sequencer.context();
    const e = Sequencer.stepAt(ac.currentTime);
    if (!e) return;
    const p = Sequencer.trackPosition(t, e);
    takes.set(midi, { track: t.id, v: p.v >= 0 ? p.v : t.edit, s: p.idx % (t.bars * SPB), at: ac.currentTime, stepDur: e.stepDur, vel });
  }

  function endTake(midi) {
    const k = takes.get(midi);
    if (!k) return;
    takes.delete(midi);
    const t = Project.track(k.track);
    if (!t) return;
    const ac = Sequencer.context();
    const steps = t.bars * SPB;
    const l = Math.max(1, Math.min(steps - k.s, Math.round((ac.currentTime - k.at) / k.stepDur)));
    let notes = Project.pattern(t.id, k.v).filter(n => !(n.s === k.s && n.m === midi));
    if (Instruments.isMono(t.instrument)) notes = notes.filter(n => n.s !== k.s);
    notes.push({ s: k.s, m: midi, l, sl: false });
    Project.setNotes(t.id, k.v, notes);
  }

  function show(midi, slid) {
    nowEl.textContent = `${noteName(midi)}${slid ? ' · slide' : ''}`;
  }

  // ── drawing ──
  function paintKey(midi, on) {
    const k = kbEl.querySelector(`.key[data-midi="${midi}"]`);
    if (k) k.classList.toggle('down', on);
  }

  function renderKeyboard() {
    kbEl.innerHTML = '';
    kbEl.className = 'keyboard';
    const t = cur();
    if (!t) return renderPads();
    const base = baseFor(t);
    const total = 24;
    const whites = [];
    for (let i = 0; i <= total; i++) if (!BLACK.includes((base + i) % 12)) whites.push(base + i);
    const ww = 100 / whites.length;
    const letters = Object.entries(KEYMAP).reduce((m, [k, v]) => { m[v] = k.toUpperCase(); return m; }, {});
    for (let i = 0; i <= total; i++) {
      const midi = base + i;
      const black = BLACK.includes(midi % 12);
      const key = document.createElement('div');
      key.className = 'key ' + (black ? 'black' : 'white');
      key.dataset.midi = String(midi);
      key.setAttribute('role', 'button');
      key.setAttribute('aria-label', noteName(midi));
      if (black) {
        const wi = whites.findIndex(w => w > midi);
        key.style.left = `calc(${wi * ww}% - ${ww * 0.32}%)`;
        key.style.width = (ww * 0.64) + '%';
      } else {
        key.style.width = ww + '%';
        const lab = document.createElement('span');
        lab.className = 'klabel';
        lab.innerHTML = (midi % 12 === 0 ? `<b>${noteName(midi)}</b>` : '') + `<i>${letters[i] || ''}</i>`;
        key.appendChild(lab);
      }
      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { key.setPointerCapture(e.pointerId); } catch (_) {}
        noteOn(midi, 0.85);
      });
      key.addEventListener('pointerup', () => noteOff(midi));
      key.addEventListener('pointercancel', () => noteOff(midi));
      kbEl.appendChild(key);
    }
    $('octLabel').textContent = `${noteName(base)}–${noteName(base + total)}`;
  }

  function renderPads() {
    kbEl.className = 'keyboard pads';
    drumTracks().forEach((t, i) => {
      const p = document.createElement('button');
      p.className = 'pad k-drum';
      p.dataset.id = t.id;
      p.innerHTML = `<span>${t.name}</span><i>${(PADKEYS[i] || '').toUpperCase()}</i>`;
      p.addEventListener('pointerdown', (e) => { e.preventDefault(); hitDrum(t.id, 0.9); });
      kbEl.appendChild(p);
    });
    $('octLabel').textContent = 'pads';
  }

  function renderKnobs() {
    knobsEl.innerHTML = '';
    const t = cur();
    if (!t) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Each pad is a drum lane. With "Write notes" on and the song playing, hits are written into the lane\'s pattern.';
      knobsEl.appendChild(p);
      return;
    }
    Instruments.knobs(t.instrument).forEach(k => {
      const f = document.createElement('label');
      f.className = 'knob';
      f.title = k.hint;
      const v = t.params[k.id];
      f.innerHTML = `<span>${k.label} <b>${k.fmt(v)}</b></span>`;
      const r = document.createElement('input');
      r.type = 'range'; r.min = k.min; r.max = k.max; r.step = k.step; r.value = v;
      r.addEventListener('input', () => {
        const val = parseFloat(r.value);
        Project.setParam(t.id, k.id, val);
        f.querySelector('b').textContent = k.fmt(val);
      });
      f.appendChild(r);
      knobsEl.appendChild(f);
    });
    const reset = document.createElement('button');
    reset.className = 'mini';
    reset.textContent = 'Reset';
    reset.title = 'Put this sound\'s knobs back to default';
    reset.addEventListener('click', () => {
      Instruments.knobs(t.instrument).forEach(k => Project.setParam(t.id, k.id, Instruments.defaults(t.instrument)[k.id]));
      renderKnobs();
    });
    knobsEl.appendChild(reset);
  }

  function renderHead() {
    targetSel.innerHTML = '';
    synthTracks().forEach(t => {
      const o = document.createElement('option');
      o.value = t.id; o.textContent = t.name;
      targetSel.appendChild(o);
    });
    if (drumTracks().length) {
      const o = document.createElement('option');
      o.value = 'drums'; o.textContent = 'Drum pads';
      targetSel.appendChild(o);
    }
    if (!Array.from(targetSel.options).some(o => o.value === target)) {
      target = targetSel.options.length ? targetSel.options[0].value : null;
    }
    targetSel.value = target || '';
    const t = cur();
    $('soundField').hidden = !t;
    $('kitField').hidden = !!t;
    soundSel.innerHTML = '';
    if (t) {
      const groups = {};
      Instruments.list().forEach(i => { (groups[i.group] = groups[i.group] || []).push(i); });
      Object.keys(groups).forEach(g => {
        const og = document.createElement('optgroup'); og.label = g;
        groups[g].forEach(i => { const o = document.createElement('option'); o.value = i.id; o.textContent = i.label; og.appendChild(o); });
        soundSel.appendChild(og);
      });
      soundSel.value = t.instrument;
    } else {
      kitSel.innerHTML = '';
      DrumKits.kits().forEach(k => { const o = document.createElement('option'); o.value = k.id; o.textContent = k.label; kitSel.appendChild(o); });
      kitSel.value = Project.kit();
    }
    slideBtn.hidden = !(t && Instruments.hasSlide(t.instrument));
    $('octDown').hidden = $('octUp').hidden = !t;
  }

  function renderAll() {
    allOff();
    renderHead();
    renderKeyboard();
    renderKnobs();
  }

  function setTarget(id) {
    if (id === target) return;
    allOff();
    target = id;
    renderAll();
  }

  // ── controls ──
  targetSel.addEventListener('change', () => setTarget(targetSel.value));
  soundSel.addEventListener('change', () => {
    const t = cur(); if (!t) return;
    Project.setInstrument(t.id, soundSel.value);
    octaveBase.delete(t.id);
  });
  kitSel.addEventListener('change', () => Project.setKit(kitSel.value));

  function shiftOctave(d) {
    const t = cur(); if (!t) return;
    const next = Math.max(12, Math.min(96, baseFor(t) + d * 12));
    allOff();
    octaveBase.set(t.id, next);
    renderKeyboard();
  }
  $('octDown').addEventListener('click', () => shiftOctave(-1));
  $('octUp').addEventListener('click', () => shiftOctave(1));

  function setSlide(on) {
    slide = on;
    slideBtn.classList.toggle('on', on);
    slideBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  slideBtn.addEventListener('click', () => setSlide(!slide));
  recBtn.addEventListener('click', () => {
    recOn = !recOn;
    recBtn.classList.toggle('on', recOn);
    recBtn.setAttribute('aria-pressed', recOn ? 'true' : 'false');
    App.msg(recOn
      ? 'Write notes is on: press Play, and what you play on the keys or pads is written into the pattern, snapped to the grid.'
      : 'Write notes is off.');
  });

  const dock = $('dock');
  $('dockToggle').addEventListener('click', () => {
    dock.classList.toggle('collapsed');
    $('dockToggle').innerHTML = dock.classList.contains('collapsed') ? '&#9652;' : '&#9662;';
  });
  // Keep the page's bottom padding equal to the dock, so nothing hides under it.
  const sizeBody = () => document.body.style.setProperty('--dockH', dock.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(sizeBody).observe(dock);
  sizeBody();

  // ── computer keyboard ──
  const held = new Set();
  function typing(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  }
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft') { e.preventDefault(); shiftOctave(-1); return; }
    if (k === 'arrowright') { e.preventDefault(); shiftOctave(1); return; }
    if (k === 'shift' && !e.repeat) { setSlide(true); return; }
    if (e.repeat || held.has(k)) return;
    const t = cur();
    if (!t) {
      const i = PADKEYS.indexOf(k);
      const d = drumTracks()[i];
      if (d) { e.preventDefault(); held.add(k); hitDrum(d.id, 0.9); }
      return;
    }
    if (!(k in KEYMAP)) return;
    e.preventDefault();
    held.add(k);
    noteOn(baseFor(t) + KEYMAP[k], 0.85);
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'shift') { setSlide(false); return; }
    if (!held.has(k)) return;
    held.delete(k);
    const t = cur();
    if (t && k in KEYMAP) noteOff(baseFor(t) + KEYMAP[k]);
  });
  window.addEventListener('blur', () => { held.clear(); allOff(); });

  // ── follow the rest of the app ──
  Project.on((reason, d) => {
    if (reason === 'tracks' || reason === 'load') renderAll();
    if (reason === 'sound') {
      if (d && d.track && d.track === target) { octaveBase.delete(target); renderAll(); }
      else if (!d || !d.track) renderHead();
    }
  });
  App.on((k) => {
    if (k !== 'select') return;
    const t = Project.track(App.selected());
    if (t && t.kind === 'synth') setTarget(t.id);
  });
  window.addEventListener('bhs:play-track', (e) => setTarget(e.detail.id));

  const first = synthTracks()[0];
  target = first ? first.id : (drumTracks().length ? 'drums' : null);
  renderAll();

  return {
    noteOn, noteOff, allOff, setBend, hitDrum, setTarget,
    target: () => target,
    drumTracks, synthTracks
  };
})();
