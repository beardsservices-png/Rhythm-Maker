// studio-mixer.js — one fader strip per track.
//
// Strips are rebuilt only when tracks come or go. A fader move just updates
// the strip in place — rebuilding mid-drag would yank the slider out from
// under the mouse.

(function () {
  const wrap = document.getElementById('mixerStrips');
  const masterIn = document.getElementById('masterVol');
  const masterVal = document.getElementById('masterVolVal');
  if (!wrap) return;

  let sig = '';

  function kindOf(id) {
    const t = Project.track(id);
    return t ? t.kind : 'synth';
  }

  function build(snap) {
    wrap.innerHTML = '';
    snap.forEach(t => {
      const el = document.createElement('div');
      el.className = 'strip';
      el.dataset.id = t.id;

      const name = document.createElement('div');
      name.className = 'stripname k-' + kindOf(t.id);
      name.textContent = t.label;
      el.appendChild(name);

      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = '0'; vol.max = '1.5'; vol.step = '0.01';
      vol.className = 'fader';
      vol.title = 'Volume';
      vol.dataset.role = 'vol';
      vol.addEventListener('input', () => Mixer.setVolume(t.id, parseFloat(vol.value)));
      el.appendChild(vol);

      const pct = document.createElement('div');
      pct.className = 'striplev';
      pct.dataset.role = 'pct';
      el.appendChild(pct);

      const pan = document.createElement('input');
      pan.type = 'range'; pan.min = '-1'; pan.max = '1'; pan.step = '0.05';
      pan.className = 'panknob';
      pan.title = 'Left / right (double-click to centre)';
      pan.dataset.role = 'pan';
      pan.addEventListener('input', () => Mixer.setPan(t.id, parseFloat(pan.value)));
      pan.addEventListener('dblclick', () => { Mixer.setPan(t.id, 0); pan.value = '0'; });
      el.appendChild(pan);

      ['reverb', 'delay'].forEach(kind => {
        const row = document.createElement('div');
        row.className = 'sendrow';
        const lab = document.createElement('span');
        lab.textContent = kind === 'reverb' ? 'rev' : 'dly';
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = '0'; sl.max = '1'; sl.step = '0.02';
        sl.dataset.role = kind;
        sl.title = kind === 'reverb' ? 'How much of this track goes to the reverb' : 'How much goes to the delay';
        sl.addEventListener('input', () => Mixer.setSend(t.id, kind, parseFloat(sl.value)));
        row.appendChild(lab); row.appendChild(sl);
        el.appendChild(row);
      });

      // Pump: duck this track on every kick — the sidechain "breathing" sound.
      const pr = document.createElement('div');
      pr.className = 'sendrow pumprow';
      const pl = document.createElement('span');
      pl.textContent = 'pump';
      const ps = document.createElement('input');
      ps.type = 'range'; ps.min = '0'; ps.max = '0.9'; ps.step = '0.05';
      ps.dataset.role = 'pump';
      ps.title = 'Duck this track every time a kick hits (sidechain pump)';
      ps.addEventListener('input', () => Project.setPump(t.id, parseFloat(ps.value)));
      pr.appendChild(pl); pr.appendChild(ps);
      el.appendChild(pr);

      // Character: one-knob tone flavour (the amount lives in the editor).
      const cs = document.createElement('select');
      cs.className = 'stripchar';
      cs.dataset.role = 'char';
      cs.title = 'Character — pick a flavour (Warm, Punchy, Vocal …). Fine-tune its Amount in the editor.';
      Character.list(kindOf(t.id) === 'audio').forEach(c => {
        const o = document.createElement('option'); o.value = c.id; o.textContent = c.id === 'none' ? 'character…' : c.label; o.title = c.hint; cs.appendChild(o);
      });
      cs.addEventListener('change', () => {
        const pt = Project.track(t.id);
        Project.setCharacter(t.id, cs.value, pt && pt.character ? pt.character.amount : 0.6);
      });
      el.appendChild(cs);

      const btns = document.createElement('div');
      btns.className = 'stripbtns';
      const m = document.createElement('button');
      m.textContent = 'M'; m.title = 'Mute'; m.dataset.role = 'm';
      m.addEventListener('click', () => Mixer.setMuted(t.id, !Mixer.get(t.id).muted));
      const s = document.createElement('button');
      s.textContent = 'S'; s.title = 'Solo — hear only soloed tracks'; s.dataset.role = 's';
      s.addEventListener('click', () => Mixer.setSoloed(t.id, !Mixer.get(t.id).soloed));
      btns.appendChild(m); btns.appendChild(s);
      el.appendChild(btns);
      wrap.appendChild(el);
    });
  }

  function update(snap) {
    snap.forEach(t => {
      const el = wrap.querySelector(`.strip[data-id="${CSS.escape(t.id)}"]`);
      if (!el) return;
      el.classList.toggle('quiet', !t.audible);
      const set = (role, v) => {
        const i = el.querySelector(`[data-role="${role}"]`);
        if (i && document.activeElement !== i) i.value = String(v);
      };
      set('vol', t.volume); set('pan', t.pan); set('reverb', t.reverb); set('delay', t.delay);
      const pt = Project.track(t.id);
      set('pump', pt && pt.pump ? pt.pump : 0);
      set('char', pt && pt.character ? pt.character.id : 'none');
      el.querySelector('[data-role="pct"]').textContent = Math.round(t.volume * 100) + '%';
      el.querySelector('[data-role="m"]').className = t.muted ? 'on-mute' : '';
      el.querySelector('[data-role="s"]').className = t.soloed ? 'on-solo' : '';
    });
  }

  function render(snap) {
    const s = snap.map(t => t.id + ':' + t.label).join('|');
    if (s !== sig) { sig = s; build(snap); }
    update(snap);
  }

  masterIn.addEventListener('input', () => {
    const v = parseFloat(masterIn.value);
    Mixer.setMasterVolume(v);
    masterVal.textContent = Math.round(v * 100) + '%';
  });
  document.getElementById('clearSolo').addEventListener('click', () => Mixer.clearSolo());

  Mixer.onChange(render);
  Project.on((r) => { if (r === 'pump' || r === 'load' || r === 'tracks' || r === 'character') update(Mixer.snapshot()); });
  render(Mixer.snapshot());

  window.addEventListener('bhs:mixer-restored', () => {
    masterIn.value = String(Mixer.getMasterVolume());
    masterVal.textContent = Math.round(Mixer.getMasterVolume() * 100) + '%';
  });
})();
