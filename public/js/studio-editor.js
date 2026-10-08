// studio-editor.js — edit the selected track's pattern.
//
//   drum lane   → the whole drum machine: every lane, its sound, its A/B/C/D
//   instrument  → a piano roll: click to add a note, drag to make it longer,
//                 drag a note to move it, click it to delete
//   audio       → the clip's waveform with its bars marked, length and volume
//
// The editor always shows the pattern you picked with the letters (A B C D) —
// in Loop-parts mode that's also what plays, so you hear what you're editing.

(function () {
  const root = document.getElementById('editor');
  if (!root) return;
  const SPB = Project.STEPS_PER_BAR;
  const NAMES = Project.NAMES;
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (m) => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (cls, text, title, fn) => {
    const b = el('button', cls, text);
    if (title) b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(e, b); });
    return b;
  };

  let current = null;           // track id being shown
  let dragging = false;         // suppress re-render mid-drag
  const noteLen = new Map();    // trackId -> default note length in steps

  function letterPicker(t, onPick) {
    const wrap = el('div', 'letters');
    NAMES.forEach((L, v) => {
      let cls = 'lbtn';
      if (t.edit === v) cls += ' on';
      if (Project.mode() === 'pattern' && t.live === v) cls += ' live';
      if (t.pending === v) cls += ' queued';
      const b = btn(cls, L, `Edit pattern ${L}` + (Project.mode() === 'pattern' ? ' (and play it)' : ''), () => {
        Project.setLive(t.id, v);
        if (onPick) onPick(v);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function copyMenu(t, anchor, allDrums) {
    const items = [{ heading: allDrums ? `Copy every drum lane's ${NAMES[t.edit]} to…` : `Copy ${t.name} ${NAMES[t.edit]} to…` }];
    NAMES.forEach((L, v) => {
      if (v === t.edit) return;
      items.push({ label: `→ ${L}`, act: () => {
        const from = t.edit;
        if (allDrums) Project.tracks().filter(x => x.kind === 'drum').forEach(x => Project.copyPattern(x.id, x.edit, v));
        else Project.copyPattern(t.id, from, v);
        App.msg(`Copied to ${L}. Pick ${L} to change it — a chorus is usually the verse with something added.`);
      } });
    });
    App.menu(anchor, items);
  }

  function preview(t, midi) {
    const ac = App.ensureAudio(); if (!ac) return;
    const h = Instruments.noteOn(ac, Sequencer.liveInput(t.id), t.instrument, midi, 0.8, ac.currentTime, t.params);
    if (h) h.release(ac.currentTime + 0.3);
  }

  // ════════════════ drums ════════════════
  function soundSelect(t) {
    const sel = el('select', 'tb-sel lane-sound');
    sel.title = 'This lane\'s sound — borrow it from any kit';
    DrumKits.kits().forEach(k => {
      const og = document.createElement('optgroup');
      og.label = k.label;
      DrumKits.ROLES.forEach(r => {
        const o = el('option', null, `${r.label} · ${k.label}`);
        o.value = k.id + '|' + r.id;
        if (t.sound.kit === k.id && t.sound.role === r.id) o.selected = true;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.addEventListener('change', () => {
      const [kit, role] = sel.value.split('|');
      Project.setSound(t.id, { kit, role });
      const ac = App.ensureAudio();
      if (ac) DrumKits.hit(ac, Mixer.input(t.id), { kit, role }, ac.currentTime, 0.9);
    });
    return sel;
  }

  let drumPaint = null;
  function renderDrums(sel) {
    const drums = Project.tracks().filter(t => t.kind === 'drum');
    const head = el('div', 'ed-head');
    head.appendChild(el('h3', null, 'Drum machine'));
    const kit = el('select', 'tb-sel');
    kit.title = 'Change every lane to this kit';
    DrumKits.kits().forEach(k => { const o = el('option', null, k.label); o.value = k.id; if (k.id === Project.kit()) o.selected = true; kit.appendChild(o); });
    kit.addEventListener('change', () => { Project.setKit(kit.value); App.msg(`Kit: ${DrumKits.KITS[kit.value].label}. Each lane can still borrow a sound from another kit.`); });
    const kl = el('label', 'field inline', 'Kit ');
    kl.appendChild(kit);
    head.appendChild(kl);
    head.appendChild(btn('', 'Copy beat to…', 'Copy every lane\'s current pattern to another letter', (e, b) => copyMenu(sel, b, true)));
    head.appendChild(btn('', 'Clear lane', `Empty ${sel.name} ${NAMES[sel.edit]}`, () => Project.clearPattern(sel.id, sel.edit)));
    root.appendChild(head);

    // What a click places: a normal hit, an accent, a soft ghost note, or a
    // roll (2, 3 or 4 hits inside the step — the trap hi-hat roll).
    const tools = el('div', 'ed-head drumtools');
    const brushes = el('div', 'letters dbrushes');
    brushes.appendChild(el('span', 'dim', 'Click places'));
    BRUSHES.forEach(([code, label, title]) => {
      const b = btn('dbrush' + (drumBrush === code ? ' on' : ''), label, title, () => { drumBrush = code; render(); });
      brushes.appendChild(b);
    });
    tools.appendChild(brushes);
    const sw = el('input');
    sw.type = 'range'; sw.min = '0'; sw.max = '0.6'; sw.step = '0.01'; sw.value = String(Project.swing());
    sw.title = 'Swing: pushes every second sixteenth late — 0 is straight, ~30% is a lazy shuffle';
    const swv = el('b', 'swingval', Math.round(Project.swing() * 100) + '%');
    sw.addEventListener('input', () => { swv.textContent = Math.round(parseFloat(sw.value) * 100) + '%'; });
    sw.addEventListener('change', () => Project.setSwing(parseFloat(sw.value)));
    const swl = el('label', 'field inline', 'Swing (whole song) ');
    swl.appendChild(sw); swl.appendChild(swv);
    tools.appendChild(swl);
    root.appendChild(tools);

    const gridEl = el('div', 'drumgrid');
    drums.forEach(t => {
      const row = el('div', 'drow' + (t.id === sel.id ? ' sel' : ''));
      row.dataset.id = t.id;
      const name = btn('dname', t.name, 'Select this lane', () => App.select(t.id));
      row.appendChild(name);
      row.appendChild(soundSelect(t));
      row.appendChild(letterPicker(t, () => App.select(t.id)));
      const cells = el('div', 'dcells');
      const pat = t.patterns[t.edit];
      for (let i = 0; i < t.bars * SPB; i++) {
        const info = Project.stepInfo(pat[i]);
        const c = el('div', 'dcell' + (info ? ' on lv' + info.level : '') + (info && info.roll > 1 ? ' roll' : '') +
          (i % 4 === 0 ? ' beat' : '') + (i % SPB === 0 && i ? ' bar' : ''), info && info.roll > 1 ? '×' + info.roll : '');
        c.dataset.track = t.id;
        c.dataset.step = String(i);
        c.setAttribute('role', 'button');
        c.tabIndex = 0;
        c.setAttribute('aria-label', `${t.name} step ${i + 1}`);
        c.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); setDrum(t, i, targetFor(Project.pattern(t.id, t.edit)[i])); }
        });
        cells.appendChild(c);
      }
      row.appendChild(cells);
      gridEl.appendChild(row);
    });
    root.appendChild(gridEl);
    root.appendChild(el('p', 'hint', 'Click or drag across steps to place hits. Each lane has its own A B C D, so the hats can change while the kick stays put. The Song grid above decides which letter each lane plays in each section.'));
  }

  // Brush codes match Project.stepInfo: ones digit = level, tens = roll.
  const BRUSHES = [
    [2, 'Hit', 'A normal hit'],
    [3, 'Accent', 'A louder hit'],
    [1, 'Soft', 'A quiet ghost note'],
    [22, 'Roll ×2', 'Two quick hits in the step'],
    [32, 'Roll ×3', 'Three quick hits — the triplet trap roll'],
    [42, 'Roll ×4', 'Four quick hits']
  ];
  let drumBrush = 2;
  const codeOf = (v) => (v === true ? 2 : (v || 0));
  /** Clicking a step that already holds the brush clears it; anything else becomes the brush. */
  function targetFor(cur) { return codeOf(cur) === drumBrush ? false : drumBrush; }

  function setDrum(t, i, value) {
    const p = Project.pattern(t.id, t.edit).slice();
    if (codeOf(p[i]) === codeOf(value)) return;
    p[i] = value;
    Project.setPatternSteps(t.id, t.edit, p);
    const info = Project.stepInfo(value);
    if (info && !Transport.isPlaying) {
      const ac = App.ensureAudio();
      if (!ac) return;
      const step = Transport.getState().secondsPerStep;
      for (let k = 0; k < info.roll; k++) DrumKits.hit(ac, Mixer.input(t.id), t.sound, ac.currentTime + k * step / info.roll, info.vel * 0.9);
    }
  }

  root.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.dcell');
    if (!c) return;
    e.preventDefault();
    const t = Project.track(c.dataset.track);
    const i = parseInt(c.dataset.step, 10);
    const on = targetFor(Project.pattern(t.id, t.edit)[i]);
    drumPaint = { track: t.id, on, touch: e.pointerType === 'touch' };
    setDrum(t, i, on);
  });
  window.addEventListener('pointermove', (e) => {
    if (!drumPaint || drumPaint.touch) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const c = hit && hit.closest && hit.closest('.dcell');
    if (!c || c.dataset.track !== drumPaint.track) return;
    setDrum(Project.track(drumPaint.track), parseInt(c.dataset.step, 10), drumPaint.on);
  });
  window.addEventListener('pointerup', () => { drumPaint = null; });

  // ════════════════ piano roll ════════════════
  const RH = 14;   // row height

  function renderRoll(t) {
    const head = el('div', 'ed-head');
    head.appendChild(el('h3', null, t.name));
    const sound = el('select', 'tb-sel');
    sound.title = 'Which instrument this track plays';
    const groups = {};
    Instruments.list().forEach(i => { (groups[i.group] = groups[i.group] || []).push(i); });
    Object.keys(groups).forEach(g => {
      const og = document.createElement('optgroup'); og.label = g;
      groups[g].forEach(i => { const o = el('option', null, i.label); o.value = i.id; if (i.id === t.instrument) o.selected = true; og.appendChild(o); });
      sound.appendChild(og);
    });
    sound.addEventListener('change', () => { Project.setInstrument(t.id, sound.value); preview(Project.track(t.id), 60); });
    const sl = el('label', 'field inline', 'Sound ');
    sl.appendChild(sound);
    head.appendChild(sl);
    head.appendChild(letterPicker(t));

    const len = el('select', 'tb-sel');
    len.title = 'How long this pattern is before it repeats';
    [1, 2, 4].forEach(b => { const o = el('option', null, `${b} bar${b === 1 ? '' : 's'}`); o.value = b; if (b === t.bars) o.selected = true; len.appendChild(o); });
    len.addEventListener('change', () => Project.setTrackBars(t.id, parseInt(len.value, 10)));
    const ll = el('label', 'field inline', 'Length ');
    ll.appendChild(len);
    head.appendChild(ll);

    const nl = el('select', 'tb-sel');
    nl.title = 'Length of a new note';
    const defLen = noteLen.get(t.id) || (t.instrument === '808' ? 1 : 4);
    [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, '1 bar']].forEach(([v, lab]) => {
      const o = el('option', null, lab); o.value = v; if (v === defLen) o.selected = true; nl.appendChild(o);
    });
    nl.addEventListener('change', () => noteLen.set(t.id, parseInt(nl.value, 10)));
    const nll = el('label', 'field inline', 'New note ');
    nll.appendChild(nl);
    head.appendChild(nll);
    head.appendChild(btn('', 'Copy to…', 'Copy this pattern to another letter', (e, b) => copyMenu(t, b, false)));
    head.appendChild(btn('', 'Clear', `Empty ${NAMES[t.edit]}`, () => Project.clearPattern(t.id, t.edit)));

    // Key + chord helper: rows in the song's key are lit, and with Chords on a
    // click places the whole chord that fits the key from that note up.
    const keySel = el('select', 'tb-sel');
    keySel.title = 'The song\'s key — lights up the notes that fit';
    const off = el('option', null, 'No key'); off.value = ''; keySel.appendChild(off);
    ['minor', 'major'].forEach(sc => NOTE.forEach((nm, r) => {
      const o = el('option', null, `${nm} ${sc}`); o.value = r + ':' + sc; keySel.appendChild(o);
    }));
    const k = Project.key();
    keySel.value = k ? k.root + ':' + k.scale : '';
    keySel.addEventListener('change', () => {
      if (!keySel.value) Project.setKey(null);
      else { const [r, sc] = keySel.value.split(':'); Project.setKey({ root: +r, scale: sc }); }
    });
    const kl2 = el('label', 'field inline', 'Key ');
    kl2.appendChild(keySel);
    head.appendChild(kl2);
    if (!Instruments.isMono(t.instrument)) {
      head.appendChild(btn('chordbtn' + (chordMode ? ' on' : ''), 'Chords', 'Click places a 3-note chord that fits the key', () => {
        chordMode = !chordMode;
        if (chordMode && !Project.key()) App.msg('Chords on. Pick a Key so the chords fit the song — without one they are major chords.');
        render();
      }));
    }
    root.appendChild(head);

    const notes = Project.pattern(t.id, t.edit);
    const keyPcs = scalePcs(Project.key());
    const steps = t.bars * SPB;
    let [lo, hi] = Instruments.range(t.instrument);
    notes.forEach(n => { lo = Math.min(lo, n.m - 2); hi = Math.max(hi, n.m + 2); });
    const rows = hi - lo + 1;

    const scroll = el('div', 'roll');
    const avail = Math.max(320, (root.clientWidth || 800) - 60);
    const cw = Math.max(16, Math.min(44, Math.floor(avail / steps)));
    const slideRow = Instruments.hasSlide(t.instrument);
    const topH = slideRow ? 36 : 18;
    const inner = el('div', 'roll-inner');
    inner.style.width = (48 + steps * cw) + 'px';
    inner.style.height = (topH + rows * RH) + 'px';
    inner.style.setProperty('--cw', cw + 'px');
    scroll.appendChild(inner);

    // ruler (+ slide toggles for the 808), sticky at the top
    const ruler = el('div', 'roll-ruler');
    ruler.style.height = topH + 'px';
    for (let b = 0; b < t.bars; b++) {
      const lab = el('span', 'rbar', String(b + 1));
      lab.style.left = (48 + b * SPB * cw) + 'px';
      ruler.appendChild(lab);
    }
    if (slideRow) {
      const starts = new Map();
      notes.forEach(n => starts.set(n.s, (starts.get(n.s) || false) || n.sl));
      starts.forEach((on, s) => {
        const b = btn('slidebtn' + (on ? ' on' : ''), 'S', 'Slide into this note from the one before (it must follow straight on)', () => {
          const ns = Project.pattern(t.id, t.edit).map(n => n.s === s ? Object.assign({}, n, { sl: !on }) : n);
          Project.setNotes(t.id, t.edit, ns);
        });
        b.style.left = (48 + s * cw) + 'px';
        b.style.width = Math.max(14, cw - 2) + 'px';
        ruler.appendChild(b);
      });
    }
    inner.appendChild(ruler);

    const body = el('div', 'roll-body');
    body.style.top = topH + 'px';
    body.style.height = rows * RH + 'px';
    for (let m = hi; m >= lo; m--) {
      const inKey = keyPcs ? keyPcs.includes(((m % 12) + 12) % 12) : null;
      const r = el('div', 'rrow' + (isBlack(m) ? ' blk' : '') + (m % 12 === 0 ? ' oct' : '') +
        (inKey === true ? ' inkey' : inKey === false ? ' outkey' : '') + (keyPcs && ((m % 12) + 12) % 12 === keyPcs[0] ? ' keyroot' : ''));
      r.style.top = (hi - m) * RH + 'px';
      const k = el('div', 'rkey', m % 12 === 0 ? noteName(m) : '');
      k.title = noteName(m);
      k.addEventListener('pointerdown', (e) => { e.stopPropagation(); preview(t, m); });
      r.appendChild(k);
      body.appendChild(r);
    }
    const lane = el('div', 'roll-lane');
    lane.style.left = '48px';
    lane.style.width = steps * cw + 'px';
    lane.style.height = rows * RH + 'px';
    body.appendChild(lane);

    const ph = el('div', 'roll-playhead');
    ph.hidden = true;
    lane.appendChild(ph);

    const place = (n, d) => {
      d.style.left = n.s * cw + 'px';
      d.style.top = (hi - n.m) * RH + 1 + 'px';
      d.style.width = Math.max(4, n.l * cw - 2) + 'px';
      d.classList.toggle('slide', !!n.sl);
      d.title = `${noteName(n.m)} · ${n.l} step${n.l === 1 ? '' : 's'}` + (n.sl ? ' · slides in' : '');
    };
    const noteEls = [];
    notes.forEach(n => {
      const d = el('div', 'rnote');
      d.appendChild(el('span', 'rgrip'));
      place(n, d);
      lane.appendChild(d);
      noteEls.push([n, d]);
    });
    inner.appendChild(body);
    root.appendChild(scroll);
    root.appendChild(el('p', 'hint',
      'Click to add a note, drag right while adding to make it longer. Drag a note to move it, drag its right edge to resize, click it to delete.' +
      (slideRow ? ' The S buttons on top make a note slide in from the one before — the 808 glide.' : '')));

    // Start scrolled to where the notes are (or the middle of the range).
    const centre = notes.length ? notes.reduce((a, n) => a + n.m, 0) / notes.length : (lo + hi) / 2;
    scroll.scrollTop = Math.max(0, (hi - centre) * RH - 120);

    const pos = (e) => {
      const r = lane.getBoundingClientRect();
      return { step: Math.floor((e.clientX - r.left) / cw), m: hi - Math.floor((e.clientY - r.top) / RH), x: e.clientX - r.left };
    };

    lane.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const live = Project.pattern(t.id, t.edit);
      const p = pos(e);
      const hitEl = e.target.closest('.rnote');
      let mode, note, d, origin = { s: 0, m: 0, l: 0 }, moved = false;
      const mates = [];          // the other notes of a chord being drawn
      if (hitEl) {
        const pair = noteEls.find(x => x[1] === hitEl);
        note = pair[0]; d = pair[1];
        const r = hitEl.getBoundingClientRect();
        mode = e.clientX > r.right - 7 ? 'resize' : 'move';
        origin = { s: note.s, m: note.m, l: note.l };
      } else {
        if (p.step < 0 || p.step >= steps) return;
        mode = 'create';
        const len0 = noteLen.get(t.id) || (t.instrument === '808' ? 1 : 4);
        note = { s: p.step, m: p.m, l: Math.min(len0, steps - p.step), sl: false };
        live.push(note);
        d = el('div', 'rnote');
        d.appendChild(el('span', 'rgrip'));
        lane.appendChild(d);
        place(note, d);
        noteEls.push([note, d]);
        origin = { s: note.s, m: note.m, l: note.l };
        preview(t, note.m);
        if (chordMode && !Instruments.isMono(t.instrument)) {
          chordAbove(note.m, Project.key()).slice(1).forEach(m2 => {
            if (m2 > hi) return;
            const n2 = { s: note.s, m: m2, l: note.l, sl: false };
            live.push(n2);
            const d2 = el('div', 'rnote');
            d2.appendChild(el('span', 'rgrip'));
            lane.appendChild(d2);
            place(n2, d2);
            noteEls.push([n2, d2]);
            mates.push([n2, d2]);
            preview(t, m2);
          });
        }
      }
      dragging = true;
      const start = p;
      const move = (ev) => {
        const q = pos(ev);
        if (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3) moved = true;
        if (mode === 'move') {
          const ds = q.step - start.step, dm = q.m - start.m;
          const ns = Math.max(0, Math.min(steps - note.l, origin.s + ds));
          const nm = Math.max(lo, Math.min(hi, origin.m + dm));
          if (nm !== note.m) preview(t, nm);
          note.s = ns; note.m = nm;
        } else {
          // create / resize — stretch from the note's start
          const end = Math.max(note.s + 1, Math.min(steps, q.step + 1));
          note.l = mode === 'create' ? Math.max(origin.l, end - note.s) : end - note.s;
        }
        place(note, d);
        mates.forEach(([n2, d2]) => { n2.l = note.l; place(n2, d2); });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        dragging = false;
        let next = Project.pattern(t.id, t.edit);
        if (mode === 'move' && !moved) next = next.filter(n => n !== note);     // a click deletes
        // A mono instrument plays one note at a time: a new note replaces any
        // other note starting on the same step.
        if (Instruments.isMono(t.instrument) && mode !== 'move') next = next.filter(n => n === note || n.s !== note.s);
        else if (Instruments.isMono(t.instrument) && moved) next = next.filter(n => n === note || n.s !== note.s);
        Project.setNotes(t.id, t.edit, next);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    roll = { t, cw, ph, steps };
  }
  let roll = null;
  let chordMode = false;

  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  /** Pitch classes of the key, root first. */
  function scalePcs(k) {
    return k ? SCALES[k.scale].map(i => (i + k.root) % 12) : null;
  }
  /** The chord built up from a note: stacked thirds in the key, or a major triad. */
  function chordAbove(m, k) {
    if (!k) return [m, m + 4, m + 7];
    const pcs = scalePcs(k);
    const deg = pcs.indexOf(((m % 12) + 12) % 12);
    if (deg < 0) return [m, m + 4, m + 7];
    const up = (steps) => {
      let n = m, d = deg;
      for (let i = 0; i < steps; i++) { const nd = (d + 1) % 7; n += ((pcs[nd] - pcs[d]) + 12) % 12; d = nd; }
      return n;
    };
    return [m, up(2), up(4)];
  }

  // ════════════════ audio ════════════════
  function renderAudio(t) {
    const buf = Project.getAudio(t.audioId);
    const head = el('div', 'ed-head');
    head.appendChild(el('h3', null, t.name));
    const bars = el('div', 'sbars');
    bars.appendChild(btn('mini', '−', 'Loop fewer bars of it', () => Project.setTrackBars(t.id, t.bars - 1)));
    bars.appendChild(el('span', null, `${t.bars} bar${t.bars === 1 ? '' : 's'}`));
    bars.appendChild(btn('mini', '+', 'Loop more bars of it', () => Project.setTrackBars(t.id, t.bars + 1)));
    const bl = el('label', 'field inline', 'Loop length ');
    bl.appendChild(bars);
    head.appendChild(bl);
    const vol = el('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '2'; vol.step = '0.05'; vol.value = String(t.gain == null ? 1 : t.gain);
    vol.title = 'Clip gain (the mixer fader is on top of this)';
    vol.addEventListener('input', () => { t.gain = parseFloat(vol.value); });
    const vl = el('label', 'field inline', 'Clip gain ');
    vl.appendChild(vol);
    head.appendChild(vl);
    head.appendChild(btn('', '▶ Hear it', 'Play the clip once', () => {
      const ac = App.ensureAudio(); if (!ac || !buf) return;
      const s = ac.createBufferSource(); s.buffer = buf; s.connect(Mixer.input(t.id)); s.start();
      s.stop(ac.currentTime + Math.min(buf.duration, 30));
    }));
    root.appendChild(head);

    const wrap = el('div', 'wave');
    const cv = document.createElement('canvas');
    wrap.appendChild(cv);
    const ph = el('div', 'roll-playhead');
    ph.hidden = true;
    wrap.appendChild(ph);
    root.appendChild(wrap);
    const info = el('p', 'hint');
    root.appendChild(info);

    if (!buf) { info.textContent = 'This clip\'s audio hasn\'t loaded (or was never saved).'; return; }
    const st = Transport.getState();
    const barSec = st.secondsPerStep * st.stepsPerBar;
    info.textContent = `${buf.duration.toFixed(1)} seconds of audio · ${(buf.duration / barSec).toFixed(1)} bars at ${st.bpm} BPM. ` +
      'It loops every ' + t.bars + ' bar' + (t.bars === 1 ? '' : 's') + ' from the start of each section. ' +
      'Turn it on or off per section in the Song grid, like any other instrument.';
    requestAnimationFrame(() => drawWave(cv, buf, t.bars, barSec));
    audioView = { t, ph, barSec, wrap };
  }
  let audioView = null;

  function drawWave(cv, buf, bars, barSec) {
    const W = Math.max(300, cv.parentElement.clientWidth);
    const H = 140;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const span = bars * barSec;                       // seconds shown
    const covered = Math.min(1, buf.duration / span);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, W, H);
    // the part of the loop length the clip doesn't fill
    if (covered < 1) { g.fillStyle = 'rgba(184,80,62,0.12)'; g.fillRect(W * covered, 0, W * (1 - covered), H); }
    // waveform: min/max per pixel column, mixed to mono
    const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    const per = (span * buf.sampleRate) / W;
    g.fillStyle = css.getPropertyValue('--amber') || '#d99a3a';
    for (let x = 0; x < W * covered; x++) {
      const a = Math.floor(x * per), b = Math.min(chans[0].length, Math.floor((x + 1) * per));
      let mn = 1, mx = -1;
      for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 64))) {
        let v = 0; chans.forEach(ch => { v += ch[i]; }); v /= chans.length;
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      if (mx < mn) continue;
      const y1 = H / 2 - mx * H * 0.46, y2 = H / 2 - mn * H * 0.46;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    // bar and beat lines
    for (let b = 0; b <= bars * 4; b++) {
      const x = Math.round(b / (bars * 4) * W) + 0.5;
      g.strokeStyle = b % 4 === 0 ? 'rgba(233,225,204,0.45)' : 'rgba(233,225,204,0.10)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      if (b % 4 === 0 && b < bars * 4) {
        g.fillStyle = 'rgba(233,225,204,0.75)';
        g.font = '11px Courier New, monospace';
        g.fillText('bar ' + (b / 4 + 1), x + 4, 13);
        g.fillStyle = css.getPropertyValue('--amber') || '#d99a3a';
      }
    }
  }

  // ════════════════ dispatch ════════════════
  function render() {
    if (dragging) return;
    roll = null; audioView = null;
    const keepY = root.querySelector('.roll') ? root.querySelector('.roll').scrollTop : null;
    root.innerHTML = '';
    const t = Project.track(App.selected());
    current = t ? t.id : null;
    if (!t) { root.appendChild(el('p', 'hint', 'Pick a track in the Song grid to edit it.')); return; }
    if (t.kind === 'drum') renderDrums(t);
    else if (t.kind === 'synth') renderRoll(t);
    else renderAudio(t);
    const r = root.querySelector('.roll');
    if (r && keepY != null && lastRendered === t.id + ':' + t.edit) r.scrollTop = keepY;
    lastRendered = t.id + ':' + t.edit;
  }
  let lastRendered = '';

  // Playheads
  let lastDrumStep = null;
  Transport.onVisualStep((ev) => {
    const e = { bar: ev.bar, stepInBar: ev.stepInBar, songMode: Project.mode() === 'song' };
    const t = Project.track(current);
    if (!t) return;
    if (t.kind === 'drum') {
      if (lastDrumStep) lastDrumStep.forEach(c => c.classList.remove('playing'));
      lastDrumStep = [];
      root.querySelectorAll('.drow').forEach(row => {
        const lt = Project.track(row.dataset.id);
        if (!lt) return;
        const p = Sequencer.trackPosition(lt, e);
        if (p.v !== lt.edit) return;
        const c = row.querySelector(`.dcell[data-step="${p.idx % (lt.bars * SPB)}"]`);
        if (c) { c.classList.add('playing'); lastDrumStep.push(c); }
      });
    } else if (t.kind === 'synth' && roll) {
      const p = Sequencer.trackPosition(t, e);
      roll.ph.hidden = p.v !== t.edit;
      roll.ph.style.left = (p.idx % roll.steps) * roll.cw + 'px';
    } else if (t.kind === 'audio' && audioView) {
      const p = Sequencer.trackPosition(t, e);
      const frac = ((p.idx / SPB) % t.bars) / t.bars;
      audioView.ph.hidden = p.v < 0;
      audioView.ph.style.left = frac * audioView.wrap.clientWidth + 'px';
    }
  });
  Transport.onStateChange(s => {
    if (s.playing) return;
    root.querySelectorAll('.dcell.playing').forEach(c => c.classList.remove('playing'));
    if (roll) roll.ph.hidden = true;
    if (audioView) audioView.ph.hidden = true;
  });

  Project.on((reason, d) => {
    if (['pattern', 'live', 'sound', 'tracks', 'load', 'audio', 'mode', 'swing', 'key'].includes(reason)) render();
  });
  App.on((k) => { if (k === 'select') render(); });
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
})();
