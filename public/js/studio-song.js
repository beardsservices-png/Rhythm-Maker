// studio-song.js — the arrangement strip.

(function () {
  const stripEl = document.getElementById('songStrip');
  const toggleBtn = document.getElementById('songToggle');
  const addBtn = document.getElementById('songAdd');
  const posEl = document.getElementById('songPos');
  if (!stripEl) return;

  function render(snap) {
    stripEl.innerHTML = '';
    snap.blocks.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'sblock';
      el.dataset.i = String(i);
      // Width tracks length, so an 8-bar chorus reads as twice a 4-bar verse.
      el.style.flexGrow = String(Math.max(1, b.bars));

      const letter = document.createElement('button');
      letter.className = 'sletter';
      letter.textContent = Variations.NAMES[b.v];
      letter.title = 'Click to change which variation this section plays';
      letter.addEventListener('click', () => Song.cycleVariation(i));
      el.appendChild(letter);

      const bars = document.createElement('div');
      bars.className = 'sbars';
      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.title = 'Shorter';
      minus.addEventListener('click', () => Song.setBars(i, b.bars - 1));
      const count = document.createElement('span');
      count.textContent = b.bars + (b.bars === 1 ? ' bar' : ' bars');
      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.title = 'Longer';
      plus.addEventListener('click', () => Song.setBars(i, b.bars + 1));
      bars.appendChild(minus); bars.appendChild(count); bars.appendChild(plus);
      el.appendChild(bars);

      const del = document.createElement('button');
      del.className = 'sdel';
      del.textContent = '×';
      del.title = 'Remove this section';
      del.disabled = snap.blocks.length <= 1;
      del.addEventListener('click', () => Song.removeBlock(i));
      el.appendChild(del);

      stripEl.appendChild(el);
    });

    toggleBtn.textContent = snap.enabled ? 'Song mode: on' : 'Song mode: off';
    toggleBtn.classList.toggle('primary', snap.enabled);
    if (!snap.enabled) posEl.textContent = `${snap.totalBars} bars total`;
  }

  toggleBtn.addEventListener('click', () => Song.setEnabled(!Song.isEnabled()));
  addBtn.addEventListener('click', () => Song.addBlock(0, 4));

  Song.onChange(render);
  render({ blocks: Song.getBlocks(), enabled: Song.isEnabled(), totalBars: Song.totalBars() });

  // Section changes are applied inside the scheduler, before any part reads
  // its pattern for that step.
  Transport.onStep((ev) => Song.tick(ev));

  Transport.onVisualStep((ev) => {
    if (!Song.isEnabled()) return;
    const total = Song.totalBars();
    const bar = ((ev.bar % total) + total) % total;
    posEl.textContent = `bar ${bar + 1} of ${total}`;
    const active = Song.blockAt(ev.bar);
    stripEl.querySelectorAll('.sblock').forEach(el => {
      el.classList.toggle('playing', parseInt(el.dataset.i, 10) === active);
    });
  });

  window.addEventListener('bhs:collect-song', (e) => { e.detail.song = Song.serialize(); });
  window.addEventListener('bhs:apply-song', (e) => Song.restore(e.detail.song));
})();
