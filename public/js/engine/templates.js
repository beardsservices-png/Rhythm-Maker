// templates.js — ready-made starting points for the start screen.
//
// Each template is written in a compact, readable form and built into a
// normal project, so everything in it is editable like anything you made.
//
// Drum patterns are strings, one character per sixteenth (spaces ignored):
//   .  off      x  hit      X  accent      o  soft (ghost note)
//   2 3 4      a roll of that many hits inside the sixteenth (trap hi-hats)
// Melodic patterns are [step, midi, length, slide?] lists.
// A section says what each track plays: 'A' for every bar, or one character
// per bar ('AAAB', with '-' for silent). Tracks not mentioned sit out.
// A track can name a Character ([flavour, amount]) and a drum lane its own kit.

const Templates = (() => {
  const LIST = [
    {
      id: 'trap', label: 'Trap', blurb: '140 BPM · 808 slides, rolling hats, piano + strings',
      bpm: 140, kit: 'trap', swing: 0, key: { root: 5, scale: 'minor' },
      drums: [
        { name: 'Kick', role: 'kick', A: 'x......x..x.....', B: 'x......x..x...x.', character: ['punchy', 0.5] },
        { name: 'Snare', role: 'snare', A: '........x.......', B: '........x.....o.' },
        { name: 'Clap', role: 'clap', kit: 'studio', A: '........x.......' },
        { name: 'Hi-hat', role: 'hat', A: 'x.x.x.x.x.x.x.x.', B: 'X.x.x.x.X.x.3x44' },
        { name: 'Open hat', role: 'openhat', A: '..............x.' },
        { name: 'Rim', role: 'rim', A: '.....x.......x..' }
      ],
      synths: [
        { name: '808', instrument: '808', bars: 1, params: { drive: 9, decay: 0.6, sustain: 0.7 },
          A: [[0, 29, 6], [7, 29, 3], [10, 32, 3], [13, 36, 3, 1]],
          B: [[0, 29, 3], [3, 29, 3], [6, 41, 2, 1], [8, 29, 4], [12, 27, 4]] },
        { name: 'Piano', instrument: 'real-piano', bars: 2, character: ['bright', 0.4],
          A: [[0, 72, 2], [3, 75, 2], [6, 77, 2], [8, 75, 4], [14, 72, 2], [16, 68, 2], [19, 72, 2], [22, 70, 4], [28, 67, 4]] },
        { name: 'Strings', instrument: 'real-strings', bars: 2, pump: 0.35,
          A: [[0, 65, 16], [0, 68, 16], [0, 72, 16], [16, 61, 16], [16, 65, 16], [16, 68, 16]] }
      ],
      sections: [
        { name: 'Intro', bars: 4, play: { Strings: 'A', Piano: 'A', 'Hi-hat': '--AA' } },
        { name: 'Hook', bars: 8, play: { Kick: 'B', Snare: 'A', Clap: 'A', 'Hi-hat': 'B', 'Open hat': 'A', '808': 'BBBBBBB-', Piano: 'A', Strings: 'A' } },
        { name: 'Verse', bars: 8, play: { Kick: 'A', Snare: 'A', 'Hi-hat': 'A', Rim: 'A', '808': 'A', Strings: 'A' } },
        { name: 'Hook 2', bars: 8, play: { Kick: 'B', Snare: 'B', Clap: 'A', 'Hi-hat': 'B', 'Open hat': 'A', '808': 'B', Piano: 'A', Strings: 'A' } },
        { name: 'Outro', bars: 4, play: { Strings: 'A', Piano: 'A', '808': 'AA--' } }
      ]
    },
    {
      id: 'boombap', label: 'Boom Bap', blurb: '90 BPM · real drums, Rhodes chords, upright bass',
      bpm: 90, kit: 'studio', swing: 0.18, key: { root: 2, scale: 'minor' },
      drums: [
        { name: 'Kick', role: 'kick', A: 'x.....x...x.....', B: 'x.....x.x.....x.', character: ['punchy', 0.6] },
        { name: 'Snare', role: 'snare', A: '....x.......x...', B: '....x.......x..o', character: ['warm', 0.4] },
        { name: 'Hi-hat', role: 'hat', A: 'x.o.x.o.x.o.x.o.', B: 'xoxoxoxoxoxoxoxo' },
        { name: 'Open hat', role: 'openhat', A: '..........x.....' },
        { name: 'Shaker', role: 'shaker', A: '..x...x...x...x.' }
      ],
      synths: [
        { name: 'Keys', instrument: 'real-epiano', bars: 2, character: ['warm', 0.5],
          A: [[0, 62, 7], [0, 65, 7], [0, 69, 7], [0, 72, 7], [10, 62, 4], [10, 65, 4], [10, 69, 4], [10, 72, 4],
              [16, 55, 7], [16, 58, 7], [16, 62, 7], [16, 65, 7], [26, 55, 4], [26, 58, 4], [26, 62, 4], [26, 65, 4]] },
        { name: 'Bass', instrument: 'real-upright', bars: 2,
          A: [[0, 38, 3], [6, 38, 2], [10, 41, 2], [16, 43, 3], [22, 43, 2], [26, 46, 2], [30, 45, 2]] }
      ],
      sections: [
        { name: 'Intro', bars: 4, play: { Keys: 'A', 'Hi-hat': '--AA' } },
        { name: 'Verse', bars: 8, play: { Kick: 'A', Snare: 'A', 'Hi-hat': 'A', Keys: 'A', Bass: 'A' } },
        { name: 'Chorus', bars: 8, play: { Kick: 'B', Snare: 'B', 'Hi-hat': 'B', 'Open hat': 'A', Shaker: 'A', Keys: 'A', Bass: 'A' } },
        { name: 'Verse 2', bars: 8, play: { Kick: 'A', Snare: 'A', 'Hi-hat': 'A', Keys: 'A', Bass: 'AAAAAA--' } },
        { name: 'Chorus 2', bars: 8, play: { Kick: 'B', Snare: 'B', 'Hi-hat': 'B', 'Open hat': 'A', Shaker: 'A', Keys: 'A', Bass: 'A' } },
        { name: 'Outro', bars: 4, play: { Keys: 'A' } }
      ]
    },
    {
      id: 'lofi', label: 'Lo-Fi', blurb: '78 BPM · dusty real drums, soft piano, upright bass',
      bpm: 78, kit: 'acoustic', swing: 0.3, key: { root: 9, scale: 'minor' },
      drums: [
        { name: 'Kick', role: 'kick', A: 'x......x..x.....', character: ['lofi', 0.6] },
        { name: 'Snare', role: 'snare', A: '....x.......x...', character: ['lofi', 0.6] },
        { name: 'Hi-hat', role: 'hat', A: 'o.o.o.o.o.o.o.o.', B: 'o.oxo.o.o.oxo.oo', character: ['lofi', 0.5] },
        { name: 'Shaker', role: 'shaker', A: '..o...o...o...o.' }
      ],
      synths: [
        { name: 'Piano', instrument: 'real-piano', bars: 2, params: { tone: 0.55 }, character: ['lofi', 0.5],
          A: [[0, 53, 14], [0, 57, 14], [0, 60, 14], [0, 64, 14], [16, 52, 14], [16, 55, 14], [16, 59, 14], [16, 62, 14]] },
        { name: 'Pad', instrument: 'pad', bars: 2, params: { tone: 0.3 },
          A: [[0, 65, 16], [0, 69, 16], [16, 64, 16], [16, 67, 16]] },
        { name: 'Bass', instrument: 'real-upright', bars: 2, character: ['warm', 0.4],
          A: [[0, 41, 6], [8, 41, 4], [16, 40, 6], [24, 43, 4]] }
      ],
      sections: [
        { name: 'Intro', bars: 4, play: { Piano: 'A', Pad: 'A' } },
        { name: 'Loop', bars: 8, play: { Kick: 'A', Snare: 'A', 'Hi-hat': 'A', Piano: 'A', Bass: 'A' } },
        { name: 'Lift', bars: 8, play: { Kick: 'A', Snare: 'A', 'Hi-hat': 'B', Shaker: 'A', Piano: 'A', Pad: 'A', Bass: 'A' } },
        { name: 'Outro', bars: 4, play: { Piano: 'A', Pad: 'A', 'Hi-hat': 'AA--' } }
      ]
    },
    {
      id: 'house', label: 'House', blurb: '124 BPM · four on the floor, pumping organ stabs',
      bpm: 124, kit: 'house', swing: 0.08, key: { root: 9, scale: 'minor' },
      drums: [
        { name: 'Kick', role: 'kick', A: 'x...x...x...x...' },
        { name: 'Clap', role: 'clap', A: '....x.......x...' },
        { name: 'Hi-hat', role: 'hat', A: 'oxoxoxoxoxoxoxox' },
        { name: 'Open hat', role: 'openhat', A: '..x...x...x...x.' },
        { name: 'Shaker', role: 'perc', A: 'xoxoxoxoxoxoxoxo' }
      ],
      synths: [
        { name: 'Organ', instrument: 'organ', bars: 1, pump: 0.6,
          A: [[3, 57, 2], [3, 60, 2], [3, 64, 2], [6, 57, 2], [6, 60, 2], [6, 64, 2], [11, 57, 3], [11, 60, 3], [11, 64, 3]] },
        { name: 'Bass', instrument: 'synthbass', bars: 1, pump: 0.5,
          A: [[2, 45, 2], [6, 45, 2], [10, 45, 2], [14, 48, 2]] },
        { name: 'Pad', instrument: 'pad', bars: 2, pump: 0.6,
          A: [[0, 57, 32], [0, 60, 32], [0, 64, 32]] }
      ],
      sections: [
        { name: 'Intro', bars: 8, play: { Kick: 'A', 'Hi-hat': 'A' } },
        { name: 'Build', bars: 4, play: { Kick: 'A', Clap: 'A', 'Hi-hat': 'A', Organ: 'A' } },
        { name: 'Drop', bars: 16, play: { Kick: 'A', Clap: 'A', 'Hi-hat': 'A', 'Open hat': 'A', Shaker: 'A', Organ: 'A', Bass: 'A' } },
        { name: 'Break', bars: 8, play: { Pad: 'A', Organ: 'A', Clap: '------AA' } },
        { name: 'Drop 2', bars: 16, play: { Kick: 'A', Clap: 'A', 'Hi-hat': 'A', 'Open hat': 'A', Shaker: 'A', Organ: 'A', Bass: 'A', Pad: 'A' } },
        { name: 'Outro', bars: 8, play: { Kick: 'A', 'Hi-hat': 'A' } }
      ]
    },
    {
      id: 'rnb', label: 'R&B', blurb: '72 BPM · strings, electric piano, sliding 808',
      bpm: 72, kit: 'trap', swing: 0.12, key: { root: 3, scale: 'major' },
      drums: [
        { name: 'Kick', role: 'kick', A: 'x.......x.x.....' },
        { name: 'Snare', role: 'snare', A: '....x.......x...' },
        { name: 'Hi-hat', role: 'hat', A: 'x.x.x.x.x.x.x.x.', B: 'x.x.x.3.x.x.x.4.' },
        { name: 'Snap', role: 'snap', kit: 'studio', A: '....x.......x...' },
        { name: 'Rim', role: 'rim', A: '..o.....o.....o.' }
      ],
      synths: [
        { name: '808', instrument: '808', bars: 2, params: { decay: 0.8, sustain: 0.75 },
          A: [[0, 39, 8], [10, 39, 3], [13, 43, 3, 1], [16, 36, 8], [26, 34, 6]] },
        { name: 'Keys', instrument: 'real-epiano', bars: 2, character: ['warm', 0.4],
          A: [[0, 63, 14], [0, 67, 14], [0, 70, 14], [0, 74, 14], [16, 60, 14], [16, 63, 14], [16, 67, 14], [16, 70, 14]] },
        { name: 'Strings', instrument: 'real-strings', bars: 2,
          A: [[0, 75, 16], [16, 72, 16]] }
      ],
      sections: [
        { name: 'Intro', bars: 4, play: { Keys: 'A', Strings: 'A' } },
        { name: 'Verse', bars: 8, play: { Kick: 'A', Snare: 'A', 'Hi-hat': 'A', Rim: 'A', '808': 'A', Keys: 'A' } },
        { name: 'Hook', bars: 8, play: { Kick: 'A', Snare: 'A', Snap: 'A', 'Hi-hat': 'B', '808': 'A', Keys: 'A', Strings: 'A' } },
        { name: 'Outro', bars: 4, play: { Keys: 'A', Strings: 'A' } }
      ]
    },
    {
      id: 'blank', label: 'Blank', blurb: 'Kick, snare, clap, hats and an 808 — all empty',
      bpm: 90, kit: 'trap', swing: 0, key: null,
      drums: [
        { name: 'Kick', role: 'kick' }, { name: 'Snare', role: 'snare' },
        { name: 'Clap', role: 'clap' }, { name: 'Hi-hat', role: 'hat' }
      ],
      synths: [{ name: '808', instrument: '808', bars: 1 }],
      sections: [{ name: 'Section 1', bars: 8, play: { Kick: 'A', Snare: 'A', Clap: 'A', 'Hi-hat': 'A', '808': 'A' } }]
    }
  ];

  const LETTERS = { A: 0, B: 1, C: 2, D: 3 };

  function drumSteps(str, bars) {
    const n = bars * 16;
    const out = new Array(n).fill(false);
    const chars = String(str || '').replace(/\s+/g, '');
    for (let i = 0; i < n && i < chars.length; i++) {
      const c = chars[i];
      if (c === 'x') out[i] = 2;
      else if (c === 'X') out[i] = 3;
      else if (c === 'o') out[i] = 1;
      else if (c >= '2' && c <= '4') out[i] = (+c) * 10 + 2;
    }
    return out;
  }

  function build(id) {
    const spec = LIST.find(t => t.id === id);
    if (!spec) return null;
    let next = 1;
    const tracks = [];
    const byName = {};
    spec.drums.forEach(d => {
      const bars = d.bars || 1;
      const t = { id: 't' + next++, kind: 'drum', name: d.name, bars, live: 0, pending: null, edit: 0,
                  sound: { kit: d.kit || spec.kit, role: d.role }, pump: 0,
                  patterns: ['A', 'B', 'C', 'D'].map(L => drumSteps(d[L], bars)) };
      if (d.character) t.character = { id: d.character[0], amount: d.character[1] };
      tracks.push(t); byName[d.name] = t;
    });
    spec.synths.forEach(x => {
      const bars = x.bars || 1;
      const t = { id: 't' + next++, kind: 'synth', name: x.name, bars, live: 0, pending: null, edit: 0,
                  instrument: x.instrument, params: Object.assign(Instruments.defaults(x.instrument), x.params || {}),
                  pump: x.pump || 0,
                  patterns: ['A', 'B', 'C', 'D'].map(L => (x[L] || []).map(([s, m, l, sl]) => ({ s, m, l: l || 1, sl: !!sl }))) };
      if (x.character) t.character = { id: x.character[0], amount: x.character[1] };
      tracks.push(t); byName[x.name] = t;
    });
    const sections = spec.sections.map(sec => {
      const s = { id: 's' + next++, name: sec.name, bars: sec.bars, solo: [], cells: {} };
      tracks.forEach(t => {
        const p = sec.play[t.name];
        const cells = new Array(sec.bars).fill(-1);
        if (p) {
          for (let b = 0; b < sec.bars; b++) {
            const c = p.length === 1 ? p : p[b];
            cells[b] = c in LETTERS ? LETTERS[c] : -1;
          }
        }
        s.cells[t.id] = cells;
      });
      return s;
    });
    return {
      version: 3, bpm: spec.bpm, mode: 'song', kit: spec.kit, swing: spec.swing || 0, key: spec.key || null,
      tracks, sections, nextId: next, nextAudioId: 1
    };
  }

  return {
    list: () => LIST.map(t => ({ id: t.id, label: t.label, blurb: t.blurb })),
    build
  };
})();
