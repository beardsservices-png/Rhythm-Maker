// studio-effects.js — controls for the shared reverb and delay.

(function () {
  const host = document.getElementById('fxPanel');
  if (!host || typeof Effects === 'undefined') return;

  const CONTROLS = [
    { id: 'reverbSize', label: 'Reverb size', min: 0.2, max: 5, step: 0.1,
      fmt: v => v.toFixed(1) + 's', hint: 'Length of the tail — small room to big hall' },
    { id: 'reverbDecay', label: 'Reverb fade', min: 0.5, max: 6, step: 0.1,
      fmt: v => v.toFixed(1), hint: 'Higher fades away faster' },
    { id: 'reverbTone', label: 'Reverb tone', min: 500, max: 12000, step: 100,
      fmt: v => Math.round(v) + 'Hz', hint: 'Darker tails sit behind the mix' },
    { id: 'delayFeedback', label: 'Delay repeats', min: 0, max: 0.92, step: 0.02,
      fmt: v => Math.round(v * 100) + '%', hint: 'How many times it echoes' },
    { id: 'delayTone', label: 'Delay tone', min: 400, max: 10000, step: 100,
      fmt: v => Math.round(v) + 'Hz', hint: 'Each repeat gets darker than the last' }
  ];

  function render() {
    const p = Effects.getParams();
    host.innerHTML = '';

    // Delay time is a beat division, not a slider — a delay set in
    // milliseconds fights the song the moment the tempo changes.
    const div = document.createElement('div');
    div.className = 'knob';
    const dl = document.createElement('label');
    dl.textContent = 'Delay time';
    const sel = document.createElement('select');
    sel.className = 'barsel';
    Effects.DIVISIONS.forEach(d => {
      const o = document.createElement('option');
      o.value = String(d.beats);
      o.textContent = d.label;
      if (Math.abs(d.beats - p.delayDivision) < 0.001) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => Effects.set('delayDivision', parseFloat(sel.value)));
    const dh = document.createElement('span');
    dh.className = 'khint';
    dh.textContent = 'Locked to the tempo, so it stays in time';
    div.appendChild(dl); div.appendChild(sel); div.appendChild(dh);
    host.appendChild(div);

    CONTROLS.forEach(c => {
      const f = document.createElement('div');
      f.className = 'knob';
      const lab = document.createElement('label');
      lab.innerHTML = c.label + ' <span class="kval">' + c.fmt(p[c.id]) + '</span>';
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = String(c.min); inp.max = String(c.max); inp.step = String(c.step);
      inp.value = String(p[c.id]);
      inp.title = c.hint;
      inp.addEventListener('input', () => {
        Effects.set(c.id, parseFloat(inp.value));
        lab.querySelector('.kval').textContent = c.fmt(parseFloat(inp.value));
      });
      const hint = document.createElement('span');
      hint.className = 'khint';
      hint.textContent = c.hint;
      f.appendChild(lab); f.appendChild(inp); f.appendChild(hint);
      host.appendChild(f);
    });
  }

  // The delay is set in beats, so it has to be recomputed whenever the tempo
  // moves or it drifts out of time with the song.
  Transport.onStateChange(() => Effects.syncDelayToTempo());

  window.addEventListener('bhs:collect-fx', (e) => { e.detail.fx = Effects.serialize(); });
  window.addEventListener('bhs:apply-fx', (e) => { Effects.restore(e.detail.fx); render(); });

  render();
})();
