// studio-mixer.js — the fader strips.

(function () {
  const wrap = document.getElementById('mixerStrips');
  const masterIn = document.getElementById('masterVol');
  const masterVal = document.getElementById('masterVolVal');
  if (!wrap) return;

  function render(snap) {
    wrap.innerHTML = '';
    snap.forEach(t => {
      const el = document.createElement('div');
      el.className = 'strip' + (t.audible ? '' : ' quiet');

      const name = document.createElement('div');
      name.className = 'stripname';
      name.textContent = t.label;
      el.appendChild(name);

      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = '0'; vol.max = '1.5'; vol.step = '0.01';
      vol.value = String(t.volume);
      vol.className = 'fader';
      vol.title = 'Volume';
      vol.addEventListener('input', () => Mixer.setVolume(t.id, parseFloat(vol.value)));
      el.appendChild(vol);

      const pct = document.createElement('div');
      pct.className = 'striplev';
      pct.textContent = Math.round(t.volume * 100) + '%';
      el.appendChild(pct);

      const pan = document.createElement('input');
      pan.type = 'range'; pan.min = '-1'; pan.max = '1'; pan.step = '0.05';
      pan.value = String(t.pan);
      pan.className = 'panknob';
      pan.title = 'Pan left / right';
      pan.addEventListener('input', () => Mixer.setPan(t.id, parseFloat(pan.value)));
      pan.addEventListener('dblclick', () => Mixer.setPan(t.id, 0));
      el.appendChild(pan);

      const btns = document.createElement('div');
      btns.className = 'stripbtns';
      const m = document.createElement('button');
      m.textContent = 'M'; m.title = 'Mute';
      m.className = t.muted ? 'on-mute' : '';
      m.addEventListener('click', () => Mixer.setMuted(t.id, !t.muted));
      const s = document.createElement('button');
      s.textContent = 'S'; s.title = 'Solo — hear only this';
      s.className = t.soloed ? 'on-solo' : '';
      s.addEventListener('click', () => Mixer.setSoloed(t.id, !t.soloed));
      btns.appendChild(m); btns.appendChild(s);
      el.appendChild(btns);

      wrap.appendChild(el);
    });
  }

  masterIn.addEventListener('input', () => {
    const v = parseFloat(masterIn.value);
    Mixer.setMasterVolume(v);
    masterVal.textContent = Math.round(v * 100) + '%';
  });
  document.getElementById('clearSolo').addEventListener('click', () => Mixer.clearSolo());

  Mixer.onChange(render);

  // Tracks are registered by the modules that own them, which run before this
  // one — but a track added later still shows up on the next change event.
  render(Mixer.ids().map(id => {
    const t = Mixer.get(id);
    return { id, label: t.label, volume: t.volume, pan: t.pan,
             muted: t.muted, soloed: t.soloed, audible: Mixer.isAudible(id) };
  }));

  window.addEventListener('bhs:collect-mixer', (e) => { e.detail.mixer = Mixer.serialize(); });
  window.addEventListener('bhs:apply-mixer', (e) => {
    Mixer.restore(e.detail.mixer);
    masterIn.value = String(Mixer.getMasterVolume());
    masterVal.textContent = Math.round(Mixer.getMasterVolume() * 100) + '%';
  });
})();
