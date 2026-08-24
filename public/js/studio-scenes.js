// studio-scenes.js — whole-song controls sitting above the parts.
//
// Two ways to move: flip one instrument (the A/B/C/D next to each lane), or
// flip everything at once with a scene button. Real arrangements use both —
// the hats change a bar early, then the whole band lands on the chorus.
//
// "Copy to" is what makes four variations usable: a chorus is normally the
// verse with something added, so you duplicate what's playing and edit from
// there rather than building it twice.

(function () {
  const sceneRow = document.getElementById('sceneRow');
  const copyRow = document.getElementById('copyRow');
  const msgEl = document.getElementById('sceneMsg');
  if (!sceneRow) return;

  Variations.NAMES.forEach((label, v) => {
    const b = document.createElement('button');
    b.className = 'scenebtn';
    b.textContent = label;
    b.dataset.v = String(v);
    b.title = `Move every instrument to ${label} on the next bar`;
    b.addEventListener('click', () => {
      Variations.selectAll(v);
      msgEl.textContent = Transport.isPlaying
        ? `Everything switches to ${label} on the next bar.`
        : `Everything is on ${label}.`;
    });
    sceneRow.appendChild(b);
  });

  Variations.NAMES.forEach((label, v) => {
    const b = document.createElement('button');
    b.className = 'copybtn';
    b.textContent = '→ ' + label;
    b.title = `Copy what's playing now into ${label}, then edit it there`;
    b.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('bhs:clone-bass', { detail: { target: v } }));
      window.dispatchEvent(new CustomEvent('bhs:clone-drums', { detail: { target: v } }));
      msgEl.textContent = `Copied what's playing into ${label}. Switch to ${label} and change it.`;
    });
    copyRow.appendChild(b);
  });

  // Keep the scene buttons lit when every part happens to agree.
  Variations.onChange((snap) => {
    const vals = Object.values(snap).map(p => p.current);
    const all = vals.length && vals.every(v => v === vals[0]) ? vals[0] : -1;
    sceneRow.querySelectorAll('.scenebtn').forEach(b => {
      b.classList.toggle('on', parseInt(b.dataset.v, 10) === all);
    });
  });
})();
