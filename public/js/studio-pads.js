// studio-pads.js — the Pads window: every drum as a big pad on the floor of a
// small room, the Handspace layout without the camera.
//
// One pad per drum track. Hit it with the mouse or a finger (several fingers at
// once on a touch screen); the middle of a pad is a full hit, the edges are
// softer. Under each pad is its sound — any drum from any kit — and an M to mute
// it. The Kit box swaps every pad to one kit at once. Pads glow whenever their
// drum plays, sequenced or by hand, and with "Write hits" on (the same switch as
// the keyboard's Write notes) hits made while the song plays go into the pattern.

const PadRoom = (() => {
  const $ = (id) => document.getElementById(id);
  const room = $('padRoom');
  const kitSel = $('padKit');
  const writeBtn = $('padWrite');
  const COLORS = { kick: 'var(--amber)', snare: '#e8c25a', clap: 'var(--teal)', hat: '#9fcf6b', openhat: '#7fb35a',
                   tom: 'var(--violet)', rim: 'var(--blue)', perc: 'var(--blue)', crash: '#d9d0b8', snap: 'var(--teal)',
                   shaker: '#9fcf6b', tamb: '#e8c25a', cowbell: 'var(--red)', conga: 'var(--red)', bongo: 'var(--amber)' };

  const drums = () => Project.tracks().filter(t => t.kind === 'drum');
  let sig = '';

  function soundSelect(t) {
    const sel = document.createElement('select');
    sel.className = 'tb-sel pad-sound';
    sel.title = 'This pad\'s sound — any drum from any kit';
    sel.setAttribute('aria-label', t.name + ' sound');
    DrumKits.kits().forEach(k => {
      const og = document.createElement('optgroup');
      og.label = k.label;
      DrumKits.ROLES.forEach(r => {
        const o = document.createElement('option');
        o.value = k.id + '|' + r.id;
        o.textContent = `${r.label} · ${k.label}`;
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

  /** How hard: full in the middle of the pad, softer toward the edges. */
  function velocityAt(face, e) {
    const r = face.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const d = Math.min(1, Math.hypot(dx, dy));
    return +(1 - d * 0.55).toFixed(2);
  }

  function build() {
    room.innerHTML = '';
    const list = drums();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'hint pad-empty';
      p.textContent = 'No drums in this song yet — + Pad adds one.';
      room.appendChild(p);
      return;
    }
    const keys = Keys.target() === 'drums';
    list.forEach((t, i) => {
      const cell = document.createElement('div');
      cell.className = 'padcell';
      cell.dataset.id = t.id;
      cell.style.setProperty('--pc', COLORS[t.sound.role] || 'var(--amber)');
      const face = document.createElement('button');
      face.type = 'button';
      face.className = 'padface';
      face.title = `Hit ${t.name} — the middle is a full hit, the edges are softer`;
      face.innerHTML = `<span class="padglow"></span><b>${escapeHtml(t.name)}</b>` +
        (keys && Keys.padKey(i) ? `<kbd>${Keys.padKey(i).toUpperCase()}</kbd>` : '');
      face.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Keys.hitDrum(t.id, velocityAt(face, e));
        cell.classList.add('down');
        clearTimeout(cell._d); cell._d = setTimeout(() => cell.classList.remove('down'), 110);
      });
      cell.appendChild(face);
      const under = document.createElement('div');
      under.className = 'padunder';
      under.appendChild(soundSelect(t));
      const m = document.createElement('button');
      m.type = 'button';
      m.className = 'ms m pad-m';
      m.textContent = 'M';
      m.title = 'Mute this drum (click again to hear it)';
      m.dataset.mix = t.id;
      m.addEventListener('click', () => { const x = Mixer.get(t.id); if (x) Mixer.setMuted(t.id, !x.muted); });
      under.appendChild(m);
      cell.appendChild(under);
      room.appendChild(cell);
    });
    paintMutes();
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function paintMutes() {
    room.querySelectorAll('.pad-m').forEach(b => {
      const m = Mixer.get(b.dataset.mix);
      const on = !!(m && m.muted);
      b.classList.toggle('on', on);
      b.closest('.padcell').classList.toggle('muted', on);
    });
  }

  function paintKit() {
    kitSel.innerHTML = '';
    DrumKits.kits().forEach(k => { const o = document.createElement('option'); o.value = k.id; o.textContent = k.label; o.selected = k.id === Project.kit(); kitSel.appendChild(o); });
  }

  function paintWrite() {
    const on = $('recNotes').getAttribute('aria-pressed') === 'true';
    writeBtn.classList.toggle('on', on);
    writeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function refresh() {
    const s = drums().map(t => t.id + ':' + t.name + ':' + t.sound.kit + ':' + t.sound.role).join('|') + '|' + (Keys.target() === 'drums');
    if (s !== sig) { sig = s; build(); }
    paintKit();
  }

  kitSel.addEventListener('change', () => {
    Project.setKit(kitSel.value);
    App.msg(`Every pad is now ${DrumKits.KITS[kitSel.value].label}. Each pad can still borrow a sound from another kit.`);
  });
  // One switch for writing what you play: the keyboard's "Write notes".
  writeBtn.addEventListener('click', () => { $('recNotes').click(); paintWrite(); });
  new MutationObserver(paintWrite).observe($('recNotes'), { attributes: true, attributeFilter: ['aria-pressed', 'class'] });

  $('padAdd').setAttribute('data-pop-anchor', '');
  $('padAdd').addEventListener('click', (e) => {
    const items = [{ heading: 'Add a pad' }];
    DrumKits.ROLES.forEach(r => items.push({ label: r.label, act: () => {
      const names = new Set(Project.tracks().map(t => t.name));
      let name = r.label;
      for (let n = 2; names.has(name); n++) name = r.label + ' ' + n;
      const t = Project.addTrack({ kind: 'drum', name, sound: { kit: Project.kit(), role: r.id } });
      Keys.hitDrum(t.id, 0.9);
      App.msg(`Added a ${r.label} pad. It's a drum lane too — draw where it plays on the timeline, or turn on Write hits and play it in.`);
    } }));
    App.menu(e.currentTarget, items, 'addMenu');
  });

  Sequencer.onHit((ids) => ids.forEach(id => {
    const c = room.querySelector(`.padcell[data-id="${CSS.escape(id)}"]`);
    if (!c) return;
    c.classList.add('hit'); clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove('hit'), 140);
  }));
  Mixer.onChange(paintMutes);
  Project.on((r) => { if (['tracks', 'load', 'sound'].includes(r)) refresh(); });
  $('keysTarget').addEventListener('change', () => setTimeout(refresh, 0));

  refresh();
  paintWrite();
  return { refresh };
})();
