// piano.js — keyboard practice module.
//
// Same listening engine as the flute, with one switch flipped: octave-exact,
// because the picture is one specific key. A beginner on a small keyboard can
// turn that off in Settings ("any octave is fine") if they keep landing an
// octave away.

const PianoInstrument = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];              // C D E F G A B
  const BLACK_AFTER = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 }; // white pc -> black pc to its right

  function el(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  const VIEW_LO = 4, VIEW_HI = 6;   // show C4 .. C6 — covers every beginner preset

  function renderDiagram(container, note, ctx) {
    container.innerHTML = '';
    const small = ctx.role === 'next';
    const lo = VIEW_LO, hi = VIEW_HI;

    const whites = [];
    for (let oct = lo; oct <= hi; oct++) {
      for (const pc of WHITE_PC) {
        if (oct === hi && pc !== 0) break;
        whites.push({ pc, oct, midi: (oct + 1) * 12 + pc });
      }
    }

    const wW = 22, wH = small ? 54 : 92, bW = 13, bH = small ? 34 : 58;
    const DROP = small ? 3 : 6;                    // target key sticks down like a pressed key
    const W = whites.length * wW, H = wH + DROP + 2;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'piano-svg' + (small ? ' small' : ''), role: 'img' });

    const targetMidi = note ? NoteUtils.midiOf(note, 4) : null;
    if (note) svg.setAttribute('aria-label', note.display + ' on the keyboard');

    whites.forEach((k, i) => {
      const hit = k.midi === targetMidi;
      svg.appendChild(el('rect', {
        x: i * wW, y: 0, width: wW - 1.5, height: hit ? wH + DROP : wH, rx: 3,
        fill: hit ? 'var(--amber)' : 'var(--paper)',
        stroke: 'var(--bg)', 'stroke-width': 1.5,
      }));
      if (hit && !small) {
        const t = el('text', { x: i * wW + wW / 2, y: wH + DROP - 9, 'text-anchor': 'middle',
          fill: 'var(--bg2)', 'font-size': 12, 'font-weight': 'bold' });
        t.textContent = NoteUtils.SHARP_NAMES[k.pc];
        svg.appendChild(t);
      }
    });

    whites.forEach((k, i) => {
      const blackPc = BLACK_AFTER[k.pc];
      if (blackPc == null) return;
      if (k.oct === hi) return;
      const midi = (k.oct + 1) * 12 + blackPc;
      const hit = midi === targetMidi;
      svg.appendChild(el('rect', {
        x: (i + 1) * wW - bW / 2 - 0.75, y: 0, width: bW, height: hit ? bH + DROP : bH, rx: 2,
        fill: hit ? 'var(--amber)' : 'var(--bg)',
        stroke: hit ? 'var(--amber)' : '#000', 'stroke-width': 1,
      }));
    });

    container.appendChild(svg);
  }

  const inst = createMicInstrument({
    id: 'piano',
    label: 'Piano / Keyboard',
    sensors: ['mic'],
    band: { minFreq: 130, maxFreq: 1250 },   // C3 .. ~D#6
    fftSize: 4096,                            // bigger window: cleaner low notes
    octaveExact: true,
    defaultOctave: 4,
    renderDiagram,
    helpText: 'Play the highlighted key. The octave matters here — if your keyboard is small and ' +
              'you keep landing an octave off, turn on “any octave is fine” in Settings.',
  });

  inst.applyPrefs = function (p) {
    if (p) inst.setOptions({ octaveLock: !p.pianoAnyOctave });
  };

  inst.renderSettings = function (box, ctx) {
    if (ctx && ctx.prefs) inst.applyPrefs(ctx.prefs);
    const wrap = document.createElement('label');
    wrap.className = 'set-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(ctx && ctx.prefs && ctx.prefs.pianoAnyOctave);
    cb.addEventListener('change', () => {
      inst.setOptions({ octaveLock: !cb.checked });
      if (ctx && ctx.save) ctx.save({ pianoAnyOctave: cb.checked });
      if (ctx && ctx.redraw) ctx.redraw();
    });
    wrap.appendChild(cb);
    wrap.appendChild(Object.assign(document.createElement('span'), { textContent: 'Any octave is fine (ignore which octave I play)' }));
    box.appendChild(wrap);
  };

  return inst;
})();
