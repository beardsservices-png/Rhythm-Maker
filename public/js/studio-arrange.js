// studio-arrange.js — the song grid.
//
// Rows are instruments, blocks are sections, and every bar of every block says
// what that instrument does there. This is the piece the old page was missing:
// it flipped every instrument to the same letter at once. Here a section can
// be Kick A + Clap C + Hat B, the snare can sit out two bars, and a part can be
// soloed for one section only — all set up ahead of time, so nothing has to be
// clicked mid-take.

(function () {
  const grid = document.getElementById('arrangeGrid');
  if (!grid) return;
  const OFF = Project.OFF;
  const NAMES = Project.NAMES;
  const KIND_LABEL = { drum: 'Drum', synth: 'Instrument', audio: 'Audio' };

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

  // ── header for one track row ──
  function trackHeader(t) {
    const h = el('div', 'hcell');
    h.appendChild(el('span', 'tcolor k-' + t.kind));

    const name = btn('tname', t.name, 'Select — edit it below', () => App.select(t.id));
    const sub = t.kind === 'drum' ? DrumKits.KITS[t.sound.kit].label
      : t.kind === 'synth' ? Instruments.label(t.instrument)
      : (t.bars + ' bar' + (t.bars === 1 ? '' : 's'));
    name.appendChild(el('small', null, sub));
    h.appendChild(name);

    const mx = Mixer.get(t.id);
    const m = btn('ms m' + (mx && mx.muted ? ' on' : ''), 'M', 'Mute everywhere', () => Mixer.setMuted(t.id, !(Mixer.get(t.id) || {}).muted));
    const s = btn('ms s' + (mx && mx.soloed ? ' on' : ''), 'S', 'Solo everywhere — hear only soloed tracks', () => Mixer.setSoloed(t.id, !(Mixer.get(t.id) || {}).soloed));
    m.dataset.mix = t.id; s.dataset.mix = t.id;
    h.appendChild(m); h.appendChild(s);

    const letters = el('div', 'letters');
    if (t.kind === 'audio') {
      const on = t.live >= 0;
      letters.appendChild(btn('lbtn wide' + (on ? ' on' : ''), on ? 'On' : 'Off',
        'In Loop-parts mode, play this or not', () => Project.setLive(t.id, on ? OFF : 0)));
    } else {
      NAMES.forEach((L, v) => {
        let cls = 'lbtn';
        if (t.edit === v) cls += ' on';
        if (Project.mode() === 'pattern' && t.live === v) cls += ' live';
        if (t.pending === v) cls += ' queued';
        const b = btn(cls, L, Project.mode() === 'pattern'
          ? `Play and edit pattern ${L} (switches on the next bar)`
          : `Edit pattern ${L} — the song decides what plays`, () => { Project.setLive(t.id, v); App.select(t.id); });
        b.dataset.v = String(v);
        letters.appendChild(b);
      });
    }
    h.appendChild(letters);
    h.appendChild(btn('more', '⋯', 'More: rename, length, move, delete', (e, b) => trackMenu(t, b)));
    return h;
  }

  function trackMenu(t, anchor) {
    const items = [{ label: 'Rename…', act: () => {
      const n = prompt('Name this track', t.name);
      if (n) Project.renameTrack(t.id, n);
    } }];
    if (t.kind !== 'audio') {
      [1, 2, 4].forEach(b => items.push({
        label: (t.bars === b ? '✓ ' : '') + `Pattern length: ${b} bar${b === 1 ? '' : 's'}`,
        act: () => Project.setTrackBars(t.id, b)
      }));
    }
    items.push({ label: 'Move up', act: () => Project.moveTrack(t.id, -1) });
    items.push({ label: 'Move down', act: () => Project.moveTrack(t.id, 1) });
    items.push({ label: 'Delete track', cls: 'danger', act: () => {
      if (confirm(`Delete "${t.name}"? Its patterns go with it.`)) Project.removeTrack(t.id);
    } });
    App.menu(anchor, items);
  }

  // ── section header: one compact row — name, length, and a ⋯ menu ──
  function sectionHead(s, i, n) {
    const head = el('div', 'shead');
    head.style.setProperty('--bars', s.bars);
    head.style.setProperty('--fours', Math.floor((s.bars - 1) / 4));
    head.dataset.sec = String(i);
    const name = btn('sname', s.name, 'Play the song from here · double-click to rename', () => playFrom(i));
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const v = prompt('Section name', s.name);
      if (v) Project.renameSection(s.id, v);
    });
    head.appendChild(name);
    const bars = el('div', 'sbars');
    bars.appendChild(btn('mini', '−', 'One bar shorter', () => Project.setSectionBars(s.id, s.bars - 1)));
    const count = el('span', null, String(s.bars));
    count.title = s.bars + (s.bars === 1 ? ' bar' : ' bars');
    bars.appendChild(count);
    bars.appendChild(btn('mini', '+', 'One bar longer', () => Project.setSectionBars(s.id, s.bars + 1)));
    head.appendChild(bars);
    head.appendChild(btn('mini more', '⋯', 'Rename, duplicate, move, delete', (e, b) => App.menu(b, [
      { label: '▶ Play from here', act: () => playFrom(i) },
      { label: 'Rename…', act: () => { const v = prompt('Section name', s.name); if (v) Project.renameSection(s.id, v); } },
      { label: 'Duplicate', act: () => Project.duplicateSection(i) },
      { label: 'Move earlier', act: () => Project.moveSection(i, -1) },
      { label: 'Move later', act: () => Project.moveSection(i, 1) },
      { label: 'Delete section', cls: 'danger', act: () => {
        if (n <= 1) { App.msg('A song needs at least one section.', true); return; }
        if (confirm(`Delete section "${s.name}"?`)) Project.removeSection(i);
      } }
    ])));
    return head;
  }

  function playFrom(i) {
    if (!App.ensureAudio()) return;
    if (Project.mode() !== 'song') Project.setMode('song');
    Transport.stop();
    Transport.seekTo(Project.sectionStart(i) * Project.STEPS_PER_BAR);
    Transport.play();
  }

  // ── one track's blocks across all sections ──
  function trackLane(t) {
    const lane = el('div', 'lane');
    let gbar = 0;
    Project.sections().forEach((s) => {
      const blk = el('div', 'sblock');
      blk.style.setProperty('--bars', s.bars);
      blk.style.setProperty('--fours', Math.floor((s.bars - 1) / 4));
      const cells = s.cells[t.id] || [];
      const main = Project.mainLetter(s, t.id);
      const soloed = s.solo.includes(t.id);
      const silencedBySolo = s.solo.length && !soloed;

      const chip = btn('chip ' + (main >= 0 ? 'v' + main : 'off'), main >= 0 ? (t.kind === 'audio' ? 'On' : NAMES[main]) : '—',
        t.kind === 'audio' ? 'On or off for this whole section'
          : 'Which pattern plays in this section — click to change (A → B → C → D → silent)',
        () => {
          let next;
          if (t.kind === 'audio') next = main >= 0 ? OFF : 0;
          else next = main === OFF ? 0 : (main === 3 ? OFF : main + 1);
          Project.setSectionTrack(s.id, t.id, next);
          if (next >= 0 && t.kind !== 'audio') Project.setEdit(t.id, next);
        });
      blk.appendChild(chip);
      blk.appendChild(btn('solo' + (soloed ? ' on' : ''), 'S', 'Solo this instrument for this section only', () => Project.toggleSolo(s.id, t.id)));

      const bars = el('div', 'bars' + (silencedBySolo ? ' quiet' : ''));
      cells.forEach((v, b) => {
        const c = el('div', 'bc ' + (v >= 0 ? 'v' + v : 'off'), v >= 0 && t.kind !== 'audio' ? NAMES[v] : '');
        c.dataset.track = t.id;
        c.dataset.sec = s.id;
        c.dataset.bar = String(b);
        c.dataset.gbar = String(gbar + b);
        if (b % 4 === 0) c.classList.add('four');
        c.title = `${t.name} · ${s.name} bar ${b + 1}: ${v >= 0 ? (t.kind === 'audio' ? 'on' : NAMES[v]) : 'silent'}`;
        bars.appendChild(c);
      });
      blk.appendChild(bars);
      lane.appendChild(blk);
      gbar += s.bars;
    });
    return lane;
  }

  function render() {
    const sel = App.selected();
    grid.innerHTML = '';
    const secs = Project.sections();

    const top = el('div', 'arow ahead');
    const corner = el('div', 'hcell corner');
    if (Project.mode() === 'pattern') {
      corner.appendChild(el('span', 'dim', 'Everything to'));
      const all = el('div', 'letters');
      NAMES.forEach((L, v) => all.appendChild(btn('lbtn', L, `Switch every instrument to ${L} on the next bar`, () => Project.setAllLive(v))));
      corner.appendChild(all);
    } else {
      corner.appendChild(el('span', 'dim', `Song · ${Project.songBars()} bars`));
    }
    top.appendChild(corner);
    const heads = el('div', 'lane');
    secs.forEach((s, i) => heads.appendChild(sectionHead(s, i, secs.length)));
    top.appendChild(heads);
    grid.appendChild(top);

    Project.tracks().forEach(t => {
      const row = el('div', 'arow track' + (t.id === sel ? ' sel' : ''));
      row.dataset.id = t.id;
      row.appendChild(trackHeader(t));
      row.appendChild(trackLane(t));
      grid.appendChild(row);
    });

    if (!Project.tracks().length) {
      const empty = el('div', 'empty', 'No instruments yet — press + Add.');
      grid.appendChild(empty);
    }
  }

  // ── painting bars ──
  let paint = null;
  function applyPaint(cell) {
    if (!paint || cell.dataset.track !== paint.track) return;
    const key = cell.dataset.sec + ':' + cell.dataset.bar;
    if (paint.done.has(key)) return;
    paint.done.add(key);
    const s = Project.section(cell.dataset.sec);
    const bar = parseInt(cell.dataset.bar, 10);
    let v;
    if (paint.mode === 'off') v = OFF;
    else if (paint.mode === 'on') { const m = Project.mainLetter(s, paint.track); v = m >= 0 ? m : 0; }
    else v = paint.mode;
    const t = Project.track(paint.track);
    if (t && t.kind === 'audio' && v > 0) v = 0;
    Project.setCell(s.id, paint.track, bar, v);
  }
  grid.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.bc');
    if (!c) return;
    e.preventDefault();
    const s = Project.section(c.dataset.sec);
    const cur = s.cells[c.dataset.track][parseInt(c.dataset.bar, 10)];
    const b = App.brush();
    paint = { track: c.dataset.track, done: new Set(), touch: e.pointerType === 'touch',
              mode: b === 'mute' ? (cur >= 0 ? 'off' : 'on') : parseInt(b, 10) };
    applyPaint(c);
  });
  window.addEventListener('pointermove', (e) => {
    if (!paint || paint.touch) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const c = hit && hit.closest && hit.closest('.bc');
    if (c) applyPaint(c);
  });
  window.addEventListener('pointerup', () => { paint = null; });

  // ── playhead + what's sounding ──
  let lastBar = -1;
  Transport.onVisualStep((ev) => {
    if (ev.bar === lastBar) return;
    lastBar = ev.bar;
    grid.querySelectorAll('.bc.now').forEach(c => c.classList.remove('now'));
    grid.querySelectorAll('.shead.now').forEach(c => c.classList.remove('now'));
    if (Project.mode() !== 'song') return;
    const total = Project.songBars();
    const g = ((ev.bar % total) + total) % total;
    grid.querySelectorAll(`.bc[data-gbar="${g}"]`).forEach(c => c.classList.add('now'));
    const loc = Project.locate(ev.bar);
    if (loc) {
      const h = grid.querySelector(`.shead[data-sec="${loc.index}"]`);
      if (h) h.classList.add('now');
      Project.tracks().forEach(t => {
        const row = grid.querySelector(`.arow.track[data-id="${t.id}"]`);
        if (!row) return;
        const st = Project.songStateAt(t, ev.bar);
        row.querySelectorAll('.hcell .lbtn[data-v]').forEach(b => b.classList.toggle('live', parseInt(b.dataset.v, 10) === st.v));
      });
    }
  });
  Transport.onStateChange(s => {
    if (!s.playing) {
      lastBar = -1;
      grid.querySelectorAll('.now').forEach(c => c.classList.remove('now'));
    }
  });

  // Mixer M/S light up in place — re-rendering the grid on every fader move
  // would be wasteful.
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
    const t = Project.addTrack({ kind: 'synth', name: uniqueName(inst.label), instrument: id,
                                 bars: inst.group === 'Bass' ? 1 : 2 });
    App.select(t.id);
    window.dispatchEvent(new CustomEvent('bhs:play-track', { detail: { id: t.id } }));
    App.msg(`Added ${t.name}. Play it on the keys below, write notes in the editor, or turn on "Write notes" while it plays.`);
  }

  function addDrum(role) {
    const t = Project.addTrack({ kind: 'drum', name: uniqueName(DrumKits.roleLabel(role)), sound: { kit: Project.kit(), role } });
    App.select(t.id);
    App.msg(`Added a ${DrumKits.roleLabel(role)} lane. Click steps in the drum grid below.`);
  }

  document.getElementById('addTrackBtn').addEventListener('click', (e) => {
    const items = [{ heading: 'Instruments — play on the keys' }];
    const groups = {};
    Instruments.list().forEach(i => { (groups[i.group] = groups[i.group] || []).push(i); });
    Object.keys(groups).forEach(g => groups[g].forEach(i => items.push({ label: `${i.label}  ·  ${g}`, act: () => addInstrument(i.id) })));
    items.push({ heading: 'Drum lane' });
    DrumKits.ROLES.forEach(r => items.push({ label: r.label, act: () => addDrum(r.id) }));
    items.push({ heading: 'Audio' });
    items.push({ label: 'Upload an audio file…', act: () => document.getElementById('audioUpload').click() });
    items.push({ label: 'Record a take…', act: () => App.msg('Pick what to record next to ● Rec at the top — what you play, the whole mix, or the mic — then press ● Rec.') });
    App.menu(e.currentTarget, items, 'addMenu');
  });

  document.getElementById('addSectionBtn').addEventListener('click', () => {
    const s = Project.addSection(null);
    App.msg(`Added "${s.name}" — it starts as a copy of the section before it. Click its letters to change it.`);
    const sc = document.getElementById('arrangeScroll');
    setTimeout(() => { sc.scrollLeft = sc.scrollWidth; }, 0);
  });

  Project.on((reason) => {
    if (['tracks', 'sections', 'cells', 'live', 'load', 'mode', 'sound', 'pattern'].includes(reason)) render();
  });
  App.on((k) => { if (k === 'select') render(); });
  render();
})();
