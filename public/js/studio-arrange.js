// studio-arrange.js — the song timeline: WHEN each instrument plays.
//
// Laid out like every DAW and video editor: time runs left to right in bars,
// one row per instrument, and each coloured block (a "clip") says "play
// pattern A here". Drag a clip to move it, drag its edges to stretch it, drag
// on an empty row to draw a new one, Ctrl+C / Ctrl+V / Ctrl+D / Delete to copy,
// paste, duplicate and remove. Sections are the named stretches on the ruler.
//
// Under the hood each section still stores a letter per track per bar
// (project-model.js); this view just reads and writes that by song bar.

(function () {
  const grid = document.getElementById('arrangeGrid');
  if (!grid) return;
  const OFF = Project.OFF;
  const NAMES = Project.NAMES;
  const EXTRA = 8;                    // empty bars shown after the song, to draw into
  const bw = () => parseFloat(getComputedStyle(document.body).getPropertyValue('--bar')) || 34;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function btn(cls, text, title, fn) {
    const b = el('button', cls, text);
    if (title) b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(e, b); });
    return b;
  }

  let sel = null;          // { track, start, len, v }
  let cursor = null;       // { track, bar } — where Paste lands
  let clipboard = null;    // { len, v, kind }

  // ── track headers ──
  function trackHeader(t) {
    const h = el('div', 'tl-head');
    h.appendChild(el('span', 'tcolor k-' + t.kind));
    h.appendChild(el('span', 'led'));
    const name = btn('tname', t.name, 'Edit this instrument in the editor below', () => editTrack(t.id));
    const sub = t.kind === 'drum' ? DrumKits.roleLabel(t.sound.role) + ' · ' + DrumKits.KITS[t.sound.kit].label
      : t.kind === 'synth' ? Instruments.label(t.instrument)
      : 'audio · ' + t.bars + ' bar' + (t.bars === 1 ? '' : 's');
    name.appendChild(el('small', null, sub));
    h.appendChild(name);
    h.appendChild(btn('editbtn', '✎', 'Edit what this instrument plays (opens below)', () => editTrack(t.id)));
    const mx = Mixer.get(t.id);
    const m = btn('ms m' + (mx && mx.muted ? ' on' : ''), 'M', 'Mute this instrument everywhere', () => Mixer.setMuted(t.id, !(Mixer.get(t.id) || {}).muted));
    const s = btn('ms s' + (mx && mx.soloed ? ' on' : ''), 'S', 'Solo — hear only soloed instruments', () => Mixer.setSoloed(t.id, !(Mixer.get(t.id) || {}).soloed));
    m.dataset.mix = t.id; s.dataset.mix = t.id;
    h.appendChild(m); h.appendChild(s);
    h.appendChild(btn('more', '⋯', 'Rename, pattern length, move, delete', (e, b) => trackMenu(t, b)));
    return h;
  }

  function editTrack(id) {
    App.select(id);
    const ed = document.getElementById('editorPanel');
    if (ed) {
      const r = ed.getBoundingClientRect();
      if (r.top > window.innerHeight - 160 || r.bottom < 80) ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function trackMenu(t, anchor) {
    const items = [{ label: 'Rename…', act: () => { const n = prompt('Name this instrument', t.name); if (n) Project.renameTrack(t.id, n); } }];
    if (t.kind !== 'audio') {
      [1, 2, 4].forEach(b => items.push({
        label: (t.bars === b ? '✓ ' : '') + `Pattern length: ${b} bar${b === 1 ? '' : 's'}`,
        act: () => Project.setTrackBars(t.id, b)
      }));
    }
    items.push({ label: 'Move up', act: () => Project.moveTrack(t.id, -1) });
    items.push({ label: 'Move down', act: () => Project.moveTrack(t.id, 1) });
    items.push({ label: 'Delete instrument', cls: 'danger', act: () => {
      if (confirm(`Delete "${t.name}"? Its patterns go with it.`)) Project.removeTrack(t.id);
    } });
    App.menu(anchor, items);
  }

  // ── a little picture of what the clip plays ──
  function previewSvg(t, v, len, BAR) {
    const W = len * BAR, H = 22;
    const pat = t.patterns && t.patterns[v];
    if (!pat) return '';
    const steps = t.bars * 16;
    const rects = [];
    if (t.kind === 'drum') {
      for (let b = 0; b < Math.min(len, 64); b++) {
        for (let i = 0; i < 16; i++) {
          const info = Project.stepInfo(pat[((b % t.bars) * 16 + i) % steps]);
          if (!info) continue;
          const h = info.level === 3 ? 18 : info.level === 1 ? 8 : 13;
          rects.push(`<rect x="${(b * 16 + i) * BAR / 16 + 0.5}" y="${H - h}" width="${Math.max(1.5, BAR / 16 - 1)}" height="${h}"/>`);
        }
      }
    } else if (pat.length) {
      let lo = 127, hi = 0;
      pat.forEach(n => { lo = Math.min(lo, n.m); hi = Math.max(hi, n.m); });
      const span = Math.max(6, hi - lo);
      for (let rep = 0; rep * t.bars < Math.min(len, 64); rep++) {
        pat.forEach(n => {
          const x = (rep * steps + n.s) * BAR / 16;
          if (x >= W) return;
          const y = 2 + (1 - (n.m - lo) / span) * (H - 6);
          rects.push(`<rect x="${x + 0.5}" y="${y}" width="${Math.max(2, Math.min(W - x, n.l * BAR / 16) - 1)}" height="3"/>`);
        });
      }
    }
    if (!rects.length) return '';
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' fill='rgba(20,21,18,0.55)'>${rects.join('')}</svg>`)}")`;
  }

  // ── render ──
  function render() {
    const BAR = bw();
    const total = Project.songBars();
    const span = total + EXTRA;
    const laneW = span * BAR;
    const song = Project.mode() === 'song';
    grid.innerHTML = '';
    grid.classList.toggle('loopmode', !song);
    grid.style.setProperty('--laneW', laneW + 'px');

    // Ruler: sections band + bar numbers
    const top = el('div', 'tl-row tl-ruler');
    const corner = el('div', 'tl-head corner');
    corner.innerHTML = song
      ? `<b>Song</b><span class="dim">${total} bars · click a bar number to play from there</span>`
      : `<b>Loop parts mode</b><span class="dim">the timeline isn't playing — press <i>Play song</i> to hear it</span>`;
    top.appendChild(corner);
    const rl = el('div', 'tl-lane ruler-lane');
    rl.style.width = laneW + 'px';
    let g = 0;
    Project.sections().forEach((s, i) => {
      const sb = el('div', 'tl-sec');
      sb.style.left = g * BAR + 'px';
      sb.style.width = s.bars * BAR - 2 + 'px';
      sb.dataset.sec = String(i);
      const nm = btn('sname', s.name, 'Play the song from here · double-click to rename', () => playFrom(Project.sectionStart(i)));
      nm.addEventListener('dblclick', (e) => { e.stopPropagation(); const v = prompt('Section name', s.name); if (v) Project.renameSection(s.id, v); });
      sb.appendChild(nm);
      sb.appendChild(btn('mini more', '⋯', 'Rename, length, duplicate, move, delete', (e, b) => sectionMenu(s, i, b)));
      const handle = el('span', 'sec-handle');
      handle.title = 'Drag to make this section longer or shorter';
      handle.addEventListener('pointerdown', (e) => dragSection(e, s, sb));
      sb.appendChild(handle);
      rl.appendChild(sb);
      g += s.bars;
    });
    const nums = el('div', 'tl-nums');
    for (let b = 0; b < span; b++) {
      const n = el('span', 'barnum' + (b >= total ? ' past' : ''), String(b + 1));
      n.style.left = b * BAR + 'px';
      n.style.width = BAR + 'px';
      n.dataset.bar = String(b);
      nums.appendChild(n);
    }
    nums.addEventListener('click', (e) => {
      const n = e.target.closest('.barnum');
      if (n) playFrom(Math.min(total - 1, parseInt(n.dataset.bar, 10)));
    });
    rl.appendChild(nums);
    top.appendChild(rl);
    grid.appendChild(top);

    // Section boundary lines, drawn once per lane via a shared gradient list
    const bounds = [];
    let acc = 0;
    Project.sections().forEach(s => { acc += s.bars; bounds.push(acc); });

    Project.tracks().forEach(t => {
      const row = el('div', 'tl-row track' + (t.id === App.selected() ? ' sel' : ''));
      row.dataset.id = t.id;
      row.appendChild(trackHeader(t));
      const lane = el('div', 'tl-lane');
      lane.dataset.track = t.id;
      lane.style.width = laneW + 'px';
      bounds.forEach(b => { const ln = el('span', 'secline'); ln.style.left = b * BAR + 'px'; lane.appendChild(ln); });
      const end = el('span', 'songend'); end.style.left = total * BAR + 'px'; lane.appendChild(end);
      Project.runs(t.id).forEach(r => lane.appendChild(clipEl(t, r, BAR)));
      if (cursor && cursor.track === t.id) {
        const c = el('span', 'tl-cursor'); c.style.left = cursor.bar * BAR + 'px'; lane.appendChild(c);
      }
      row.appendChild(lane);
      grid.appendChild(row);
    });

    const ph = el('div', 'tl-playhead');
    ph.hidden = true;
    grid.appendChild(ph);
    renderSelBar();
  }

  function clipEl(t, r, BAR) {
    const c = el('div', 'clip v' + r.v + (t.kind === 'audio' ? ' audio' : '') + (sel && sel.track === t.id && sel.start === r.start ? ' selected' : ''));
    c.style.left = r.start * BAR + 'px';
    c.style.width = r.len * BAR - 2 + 'px';
    c.dataset.start = String(r.start);
    c.dataset.len = String(r.len);
    c.dataset.v = String(r.v);
    const pv = t.kind === 'audio' ? '' : previewSvg(t, r.v, r.len, BAR);
    if (pv) c.style.backgroundImage = pv;
    const label = el('span', 'clip-label', t.kind === 'audio' ? '♪ ' + t.name : NAMES[r.v]);
    c.appendChild(label);
    const loc = Project.locate(r.start);
    if (loc && loc.section.solo.includes(t.id)) c.appendChild(el('span', 'clip-solo', 'S'));
    c.appendChild(el('span', 'clip-edge l'));
    c.appendChild(el('span', 'clip-edge r'));
    c.title = t.kind === 'audio' ? `${t.name}: bars ${r.start + 1}–${r.start + r.len}`
      : `${t.name} plays pattern ${NAMES[r.v]}, bars ${r.start + 1}–${r.start + r.len}. Click to edit it · drag to move · drag the ends to stretch`;
    return c;
  }

  // ── the selected-clip toolbar ──
  function renderSelBar() {
    const bar = document.getElementById('clipBar');
    if (!bar) return;
    bar.innerHTML = '';
    const t = sel && Project.track(sel.track);
    if (!t) {
      bar.appendChild(el('span', 'dim', 'Click a block to select it · drag to move · drag its ends to stretch · drag on an empty row to draw a new one'));
      if (clipboard && cursor) bar.appendChild(btn('mini', 'Paste here', 'Paste the copied block at the marker (Ctrl+V)', paste));
      return;
    }
    bar.appendChild(el('b', null, `${t.name}`));
    bar.appendChild(el('span', 'dim', ` bars ${sel.start + 1}–${sel.start + sel.len} ·`));
    if (t.kind !== 'audio') {
      bar.appendChild(el('span', 'dim', ' pattern'));
      NAMES.forEach((L, v) => bar.appendChild(btn('lbtn' + (sel.v === v ? ' on' : ''), L, `Make this block play pattern ${L}`, () => {
        writeRange(t.id, sel.start, sel.len, v);
        sel.v = v;
        Project.setEdit(t.id, v);
      })));
    }
    bar.appendChild(btn('mini', 'Edit ✎', 'Open this pattern in the editor below', () => { Project.setEdit(t.id, sel.v); editTrack(t.id); }));
    bar.appendChild(btn('mini', 'Copy', 'Copy (Ctrl+C)', copy));
    bar.appendChild(btn('mini', 'Paste', 'Paste at the marker, or right after this block (Ctrl+V)', paste));
    bar.appendChild(btn('mini', 'Duplicate', 'Copy it right after itself (Ctrl+D)', duplicate));
    const loc = Project.locate(sel.start);
    if (loc) {
      const on = loc.section.solo.includes(t.id);
      bar.appendChild(btn('mini' + (on ? ' on' : ''), on ? `Soloed in ${loc.section.name}` : `Solo in ${loc.section.name}`,
        'Only soloed instruments play in this section', () => Project.toggleSolo(loc.section.id, t.id)));
    }
    bar.appendChild(btn('mini danger', 'Delete', 'Remove this block (Delete)', del));
  }

  // ── editing helpers ──
  function writeRange(track, start, len, v) {
    const edits = [];
    for (let b = start; b < start + len; b++) edits.push({ track, bar: b, v });
    Project.setCells(edits);
  }

  function copy() {
    if (!sel) return;
    const t = Project.track(sel.track);
    clipboard = { len: sel.len, v: sel.v, kind: t.kind, from: sel.track };
    App.msg(`Copied ${t.name} (${sel.len} bar${sel.len === 1 ? '' : 's'}). Click where it should go, then Paste (Ctrl+V).`);
    renderSelBar();
  }

  function paste() {
    if (!clipboard) { App.msg('Copy a block first (select it, Ctrl+C).'); return; }
    let track, bar;
    if (cursor) { track = cursor.track; bar = cursor.bar; }
    else if (sel) { track = sel.track; bar = sel.start + sel.len; }
    else { App.msg('Click a spot on a row first — that\'s where it pastes.'); return; }
    const t = Project.track(track);
    if (!t) return;
    const v = t.kind === 'audio' ? 0 : clipboard.v;
    writeRange(track, bar, clipboard.len, v);
    sel = { track, start: bar, len: clipboard.len, v };
    cursor = { track, bar: bar + clipboard.len };
    render();
  }

  function duplicate() {
    if (!sel) return;
    writeRange(sel.track, sel.start + sel.len, sel.len, sel.v);
    sel = { track: sel.track, start: sel.start + sel.len, len: sel.len, v: sel.v };
    render();
  }

  function del() {
    if (!sel) return;
    writeRange(sel.track, sel.start, sel.len, OFF);
    sel = null;
    render();
  }

  function playFrom(bar) {
    if (!App.ensureAudio()) return;
    if (Project.mode() !== 'song') { Project.setMode('song'); App.msg('Switched to Play song — the timeline is what plays now.'); }
    Transport.stop();
    Transport.seekTo(Math.max(0, bar) * Project.STEPS_PER_BAR);
    Transport.play();
  }

  function sectionMenu(s, i, anchor) {
    App.menu(anchor, [
      { label: '▶ Play from here', act: () => playFrom(Project.sectionStart(i)) },
      { label: 'Rename…', act: () => { const v = prompt('Section name', s.name); if (v) Project.renameSection(s.id, v); } },
      { label: 'Length…', act: () => { const v = parseInt(prompt('How many bars?', String(s.bars)), 10); if (v > 0) Project.setSectionBars(s.id, v); } },
      { label: 'Duplicate (copy everything in it)', act: () => Project.duplicateSection(i) },
      { label: 'Add an empty section after', act: () => { const n = Project.addSection(i, 'Section ' + (Project.sections().length + 1), 4); Object.keys(n.cells).forEach(k => n.cells[k].fill(OFF)); Project.setSectionBars(n.id, 4); render(); } },
      { label: 'Move earlier', act: () => Project.moveSection(i, -1) },
      { label: 'Move later', act: () => Project.moveSection(i, 1) },
      { label: 'Delete section', cls: 'danger', act: () => {
        if (Project.sections().length <= 1) { App.msg('A song needs at least one section.', true); return; }
        if (confirm(`Delete section "${s.name}" and everything in it?`)) Project.removeSection(i);
      } }
    ]);
  }

  function dragSection(e, s, sb) {
    e.preventDefault(); e.stopPropagation();
    const BAR = bw();
    const x0 = e.clientX, bars0 = s.bars;
    let bars = bars0;
    const move = (ev) => {
      bars = Math.max(1, bars0 + Math.round((ev.clientX - x0) / BAR));
      sb.style.width = bars * BAR - 2 + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (bars !== bars0) Project.setSectionBars(s.id, bars);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── pointer: select / move / stretch / draw ──
  grid.addEventListener('pointerdown', (e) => {
    const lane = e.target.closest('.tl-lane[data-track]');
    if (!lane || e.button !== 0) return;
    const t = Project.track(lane.dataset.track);
    if (!t) return;
    e.preventDefault();
    const BAR = bw();
    const rect = lane.getBoundingClientRect();
    const barAt = (x) => Math.max(0, Math.floor((x - rect.left) / BAR));
    const clip = e.target.closest('.clip');
    const startBar = barAt(e.clientX);
    let mode, orig = null, ghost = null;
    if (clip) {
      orig = { start: +clip.dataset.start, len: +clip.dataset.len, v: +clip.dataset.v };
      mode = e.target.classList.contains('clip-edge') ? (e.target.classList.contains('l') ? 'left' : 'right') : (e.altKey ? 'copy' : 'move');
      ghost = clip;
    } else {
      mode = 'draw';
      orig = { start: startBar, len: 1, v: t.kind === 'audio' ? 0 : Math.max(0, t.edit) };
      ghost = el('div', 'clip ghost v' + orig.v);
      ghost.style.left = startBar * BAR + 'px';
      ghost.style.width = BAR - 2 + 'px';
      lane.appendChild(ghost);
    }
    let next = Object.assign({}, orig), moved = false;
    const move = (ev) => {
      const d = Math.round((ev.clientX - e.clientX) / BAR);
      if (Math.abs(ev.clientX - e.clientX) > 4) moved = true;
      if (!moved) return;
      if (mode === 'move' || mode === 'copy') next.start = Math.max(0, orig.start + d);
      else if (mode === 'right') next.len = Math.max(1, orig.len + d);
      else if (mode === 'left') { const s2 = Math.min(orig.start + orig.len - 1, Math.max(0, orig.start + d)); next.len = orig.start + orig.len - s2; next.start = s2; }
      else if (mode === 'draw') { const b = barAt(ev.clientX); next.start = Math.min(startBar, b); next.len = Math.abs(b - startBar) + 1; }
      ghost.style.left = next.start * BAR + 'px';
      ghost.style.width = next.len * BAR - 2 + 'px';
      ghost.classList.add('dragging');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) {
        if (mode === 'draw') { ghost.remove(); cursor = { track: t.id, bar: startBar }; sel = null; render(); return; }
        // A click on a block: select it and open its pattern in the editor.
        sel = Object.assign({ track: t.id }, orig);
        cursor = null;
        if (t.kind !== 'audio') Project.setEdit(t.id, orig.v);
        App.select(t.id);
        render();
        return;
      }
      const edits = [];
      if (mode === 'move' || mode === 'left' || mode === 'right') {
        for (let b = orig.start; b < orig.start + orig.len; b++) edits.push({ track: t.id, bar: b, v: OFF });
      }
      for (let b = next.start; b < next.start + next.len; b++) edits.push({ track: t.id, bar: b, v: orig.v });
      Project.setCells(edits);
      sel = Object.assign({ track: t.id }, next, { v: orig.v });
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  grid.addEventListener('dblclick', (e) => {
    const lane = e.target.closest('.tl-lane[data-track]');
    if (!lane || e.target.closest('.clip')) return;
    const t = Project.track(lane.dataset.track);
    const BAR = bw();
    const bar = Math.floor((e.clientX - lane.getBoundingClientRect().left) / BAR);
    // Fill to the end of the section it lands in (or 4 bars past the song).
    const loc = bar < Project.songBars() ? Project.locate(bar) : null;
    const len = loc ? loc.section.bars - loc.barIn : 4;
    const v = t.kind === 'audio' ? 0 : Math.max(0, t.edit);
    writeRange(t.id, bar, len, v);
    sel = { track: t.id, start: bar, len, v };
    render();
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'c' && sel) { e.preventDefault(); copy(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'v' && clipboard) { e.preventDefault(); paste(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'd' && sel) { e.preventDefault(); duplicate(); }
    else if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); del(); }
    else if (k === 'escape' && (sel || cursor)) { sel = null; cursor = null; render(); }
  });

  // ── playhead, follow, and "what's sounding" lights ──
  Transport.onVisualStep((ev) => {
    const ph = grid.querySelector('.tl-playhead');
    if (!ph) return;
    if (Project.mode() !== 'song') { ph.hidden = true; return; }
    const total = Project.songBars();
    const BAR = bw();
    const pos = ((ev.bar % total) + total) % total + ev.stepInBar / 16;
    const head = grid.querySelector('.tl-head');
    const x = (head ? head.offsetWidth : 0) + pos * BAR;
    ph.hidden = false;
    ph.style.left = x + 'px';
    const sc = document.getElementById('arrangeScroll');
    if (sc && Transport.isPlaying) {
      const vis = sc.scrollLeft + sc.clientWidth;
      if (x > vis - 60 || x < sc.scrollLeft + (head ? head.offsetWidth : 0)) sc.scrollLeft = Math.max(0, x - (head ? head.offsetWidth : 0) - 40);
    }
  });
  Transport.onStateChange(s => {
    if (!s.playing) { const ph = grid.querySelector('.tl-playhead'); if (ph) ph.hidden = true; }
  });
  Sequencer.onHit((ids) => {
    ids.forEach(id => {
      const row = grid.querySelector(`.tl-row.track[data-id="${CSS.escape(id)}"]`);
      if (!row) return;
      row.classList.remove('hit'); void row.offsetWidth; row.classList.add('hit');
      clearTimeout(row._hitT);
      row._hitT = setTimeout(() => row.classList.remove('hit'), 140);
    });
  });

  Mixer.onChange(() => {
    grid.querySelectorAll('.ms[data-mix]').forEach(b => {
      const m = Mixer.get(b.dataset.mix);
      if (m) b.classList.toggle('on', b.classList.contains('m') ? m.muted : m.soloed);
    });
  });

  // ── add things ──
  function uniqueName(base) {
    const names = new Set(Project.tracks().map(t => t.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(base + ' ' + i)) return base + ' ' + i;
  }
  function addInstrument(id) {
    const inst = Instruments.get(id);
    const t = Project.addTrack({ kind: 'synth', name: uniqueName(inst.label), instrument: id, bars: inst.group === 'Bass' ? 1 : 2 });
    editTrack(t.id);
    window.dispatchEvent(new CustomEvent('bhs:play-track', { detail: { id: t.id } }));
    App.msg(`Added ${t.name}. It's open in the editor below — click in the piano roll to add notes, or play the keys at the bottom.`);
  }
  function addDrum(role) {
    const t = Project.addTrack({ kind: 'drum', name: uniqueName(DrumKits.roleLabel(role)), sound: { kit: Project.kit(), role } });
    editTrack(t.id);
    App.msg(`Added a ${DrumKits.roleLabel(role)} lane — click steps in the drum machine below.`);
  }
  document.getElementById('addTrackBtn').addEventListener('click', (e) => {
    const items = [{ heading: 'Instruments — play on the keys' }];
    Instruments.list().forEach(i => items.push({ label: `${i.label}  ·  ${i.group}`, act: () => addInstrument(i.id) }));
    items.push({ heading: 'Drum lane' });
    DrumKits.ROLES.forEach(r => items.push({ label: r.label, act: () => addDrum(r.id) }));
    items.push({ heading: 'Audio' });
    items.push({ label: 'Upload an audio file…', act: () => document.getElementById('audioUpload').click() });
    items.push({ label: 'Record a take…', act: () => App.msg('Pick what to record next to ● Rec at the top — what you play, the whole mix, or the mic — then press ● Rec.') });
    App.menu(e.currentTarget, items, 'addMenu');
  });
  document.getElementById('addSectionBtn').addEventListener('click', () => {
    const s = Project.addSection(null);
    App.msg(`Added "${s.name}" at the end — a copy of the section before it. Drag its blocks or its edge to change it.`);
    const sc = document.getElementById('arrangeScroll');
    setTimeout(() => { sc.scrollLeft = sc.scrollWidth; }, 0);
  });

  Project.on((reason) => {
    if (reason === 'load') { sel = null; cursor = null; }
    if (['tracks', 'sections', 'cells', 'live', 'load', 'mode', 'sound', 'pattern'].includes(reason)) {
      if (sel && !Project.track(sel.track)) sel = null;
      render();
    }
  });
  App.on((k) => { if (k === 'select') render(); });
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
  render();

  window.__bhsTimeline = { select: (track, start) => { const r = Project.runs(track).find(x => x.start === start); sel = r ? Object.assign({ track }, r) : null; render(); },
                           setCursor: (track, bar) => { cursor = { track, bar }; render(); }, copy, paste, duplicate, del, sel: () => sel };
})();
