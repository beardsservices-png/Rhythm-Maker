// flute.js — concert flute practice module.
//
// Listening: octave-agnostic. Beginners octave-slip constantly and the
// fingering picture pins the real fingering regardless, so matching on pitch
// class (any octave) keeps the game encouraging instead of pedantic.
//
// ─────────────────────────────────────────────────────────────────────────────
// FINGERING DATA — lifted verbatim from the flute-practice-buddy prototype and
// NOT independently re-verified. Key order per note:
//     [ B-thumb, L1, L2, L3, R1, R2, R3, E♭/D♯ key ]     1 = closed/pressed
// It's a teaching aid only — the mic scores the *sound*, so a wrong picture
// never blocks a correctly-played note. If a student's method book shows a
// note differently, the book wins (the footer says so). To match a specific
// book, edit ONE object below — that's the whole change.
// ─────────────────────────────────────────────────────────────────────────────

const FluteInstrument = (() => {

  const FINGERING_CHARTS = {
    standard: {
      label: 'Standard chart',
      keys: ['thumb', 'L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'Eb'],
      notes: {
        'C':  [1, 0, 0, 0, 0, 0, 0, 1],
        'C#': [1, 0, 0, 0, 0, 0, 0, 0],
        'D':  [1, 1, 1, 1, 1, 1, 1, 0],
        'D#': [1, 1, 1, 1, 0, 0, 0, 1],
        'E':  [1, 1, 1, 1, 1, 1, 0, 0],
        'F':  [1, 1, 1, 1, 1, 0, 0, 0],
        'F#': [1, 1, 1, 0, 1, 0, 0, 0],
        'G':  [1, 1, 1, 1, 0, 0, 0, 0],
        'G#': [1, 1, 1, 1, 0, 0, 0, 1],
        'A':  [1, 1, 1, 0, 0, 0, 0, 0],
        'A#': [1, 1, 0, 0, 1, 0, 0, 0],
        'B':  [1, 1, 0, 0, 0, 0, 0, 0],
      },
    },
  };

  let chartId = 'standard';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function pcName(note) {
    // FINGERING keys are sharp-spelled; NoteUtils sharp names line up.
    return NoteUtils.SHARP_NAMES[note.pc];
  }

  function el(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // Draw the flute head-to-foot with its keys; filled = finger down.
  function renderDiagram(container, note, ctx) {
    container.innerHTML = '';
    const chart = FINGERING_CHARTS[chartId].notes;
    const name = note ? pcName(note) : null;
    const keys = name && chart[name];
    if (!keys) { container.textContent = '—'; return; }

    const small = ctx.role === 'next';
    const W = 300, H = 96;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'flute-svg' + (small ? ' small' : ''), role: 'img' });
    svg.setAttribute('aria-label',
      (note.display) + ' — ' + chart[name].map((v, i) => v ? FINGERING_CHARTS[chartId].keys[i] : '').filter(Boolean).join(', '));

    // body tube
    svg.appendChild(el('rect', { x: 14, y: H / 2 - 11, width: W - 28, height: 22, rx: 11,
      fill: 'rgba(233,225,204,0.06)', stroke: 'var(--dim)', 'stroke-width': 1.5 }));

    // key layout: x positions along the tube
    const cy = H / 2;
    const layout = [
      { key: 0, x: 34,  y: cy + 22, r: 8,  label: 'T' },   // thumb, below
      { key: 1, x: 70,  y: cy, r: 10 },
      { key: 2, x: 96,  y: cy, r: 10 },
      { key: 3, x: 122, y: cy, r: 10 },
      { key: 4, x: 168, y: cy, r: 10 },
      { key: 5, x: 194, y: cy, r: 10 },
      { key: 6, x: 220, y: cy, r: 10 },
      { key: 7, x: 262, y: cy + 20, r: 7, label: 'E♭' },   // pinky key, below
    ];

    // hand brackets
    const bracket = (x1, x2, txt) => {
      svg.appendChild(el('line', { x1, y1: cy - 20, x2: x2, y2: cy - 20, stroke: 'var(--dim)', 'stroke-width': 1 }));
      const t = el('text', { x: (x1 + x2) / 2, y: cy - 25, 'text-anchor': 'middle', fill: 'var(--dim)', 'font-size': 10 });
      t.textContent = txt;
      svg.appendChild(t);
    };
    if (!small) { bracket(60, 132, 'left hand'); bracket(158, 230, 'right hand'); }

    layout.forEach(k => {
      const down = !!keys[k.key];
      svg.appendChild(el('circle', {
        cx: k.x, cy: k.y, r: k.r,
        fill: down ? 'var(--paper)' : 'transparent',
        stroke: down ? 'var(--paper)' : 'var(--dim)', 'stroke-width': 2,
      }));
      if (k.label && !small) {
        const t = el('text', { x: k.x, y: k.y + k.r + 12, 'text-anchor': 'middle', fill: 'var(--dim)', 'font-size': 9 });
        t.textContent = k.label;
        svg.appendChild(t);
      }
    });

    container.appendChild(svg);
  }

  function renderSettings(box) {
    const wrap = document.createElement('label');
    wrap.className = 'set-row';
    wrap.innerHTML = '<span>Fingering chart</span>';
    const sel = document.createElement('select');
    Object.keys(FINGERING_CHARTS).forEach(id => {
      const o = document.createElement('option');
      o.value = id; o.textContent = FINGERING_CHARTS[id].label;
      sel.appendChild(o);
    });
    sel.value = chartId;
    sel.addEventListener('change', () => { chartId = sel.value; window.dispatchEvent(new CustomEvent('practice:redraw')); });
    wrap.appendChild(sel);
    box.appendChild(wrap);

    const note = document.createElement('p');
    note.className = 'set-note';
    note.textContent = 'More charts can be added to match a specific band method book.';
    box.appendChild(note);
  }

  return createMicInstrument({
    id: 'flute',
    label: 'Flute',
    sensors: ['mic'],
    band: { minFreq: 240, maxFreq: 2100 },   // low C4 up through a beginner's high range
    fftSize: 2048,
    octaveExact: false,
    defaultOctave: 5,
    renderDiagram,
    renderSettings,
    helpText: 'Hold the flute up and level, take a full breath, and play the highlighted note. ' +
              'It counts in any octave — high or low is fine.',
  });
})();
