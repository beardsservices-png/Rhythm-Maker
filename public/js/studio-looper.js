// studio-looper.js — UI for the four loop slots.

(function () {
  const wrap = document.getElementById('loopSlots');
  const armBtn = document.getElementById('loopArm');
  const armMsg = document.getElementById('loopMsg');
  const latIn = document.getElementById('loopLatency');
  const latVal = document.getElementById('loopLatencyVal');
  if (!wrap) return;

  let armed = false;

  function msg(text, bad) {
    armMsg.textContent = text || '';
    armMsg.classList.toggle('bad', !!bad);
  }

  armBtn.addEventListener('click', async () => {
    armBtn.disabled = true;
    msg('Asking for the microphone…');
    const res = await Looper.arm();
    armBtn.disabled = false;
    if (!res.ok) { msg('Microphone unavailable: ' + res.error, true); return; }
    armed = true;
    armBtn.textContent = 'Mic on';
    armBtn.classList.add('primary');
    const ms = Math.round(Looper.getLatencyOffset() * 1000);
    latIn.value = String(ms);
    latVal.textContent = ms + 'ms';
    msg('Ready. Use headphones — on speakers the mic records the backing track into your loop.');
  });

  latIn.addEventListener('input', () => {
    const ms = parseInt(latIn.value, 10);
    latVal.textContent = ms + 'ms';
    Looper.setLatencyOffset(ms / 1000);
  });

  function render(snap) {
    wrap.innerHTML = '';
    snap.forEach(s => {
      const el = document.createElement('div');
      el.className = 'slot ' + s.state;

      const hdr = document.createElement('div');
      hdr.className = 'slot-hdr';
      hdr.innerHTML = `<span class="slot-n">${s.index + 1}</span>` +
        `<span class="slot-state">${s.state === 'empty' ? 'empty' :
          s.state === 'recording' ? 'recording' : s.bars + ' bar' + (s.bars === 1 ? '' : 's')}</span>`;
      el.appendChild(hdr);

      const rec = document.createElement('button');
      rec.className = 'slot-rec' + (s.state === 'recording' ? ' armed' : '');
      rec.textContent = s.state === 'recording' ? 'Stop' : 'Rec';
      rec.disabled = !armed;
      rec.addEventListener('click', async () => {
        if (s.state === 'recording') {
          const r = await Looper.stopRecording(s.index);
          if (!r.ok) msg('Nothing captured (' + r.reason + ').', true);
        } else {
          Looper.startRecording(s.index);
        }
      });
      el.appendChild(rec);

      const row = document.createElement('div');
      row.className = 'slot-row';
      const tog = document.createElement('button');
      tog.textContent = s.state === 'playing' ? 'On' : 'Off';
      tog.className = s.state === 'playing' ? 'primary' : '';
      tog.disabled = !s.hasAudio;
      tog.addEventListener('click', () => Looper.toggle(s.index));
      const clr = document.createElement('button');
      clr.textContent = 'Clear';
      clr.disabled = !s.hasAudio;
      clr.addEventListener('click', () => Looper.clear(s.index));
      row.appendChild(tog); row.appendChild(clr);
      el.appendChild(row);

      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = '0'; vol.max = '1.5'; vol.step = '0.05';
      vol.value = String(s.volume);
      vol.disabled = !s.hasAudio;
      vol.addEventListener('input', () => Looper.setVolume(s.index, parseFloat(vol.value)));
      el.appendChild(vol);

      wrap.appendChild(el);
    });
  }

  Looper.onChange(render);
  render(Looper.getSlots().map(s => ({
    index: s.index, state: s.state, bars: s.bars, volume: s.volume, hasAudio: !!s.buffer
  })));
})();
