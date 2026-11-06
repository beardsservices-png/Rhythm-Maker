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
    // Bach — public domain, converted note-for-note from the music21 corpus
    // (MusicXML) by a one-off script. Patterns cap at 4 bars x 4 letters, so a
    // piece longer than 16 bars is split across numbered tracks.
    {
      id: 'bach-prelude', label: "Bach: Prelude in C", blurb: "66 BPM \u00b7 BWV 846, the full piece on grand piano",
      bpm: 66, kit: 'acoustic', swing: 0, key: { root: 0, scale: 'major' },
      drums: [],
      synths: [
        {"name": "Piano 1", "instrument": "real-piano", "bars": 4, "A": [[0, 60, 8], [1, 64, 7], [2, 67, 1], [3, 72, 1], [4, 76, 1], [5, 67, 1], [6, 72, 1], [7, 76, 1], [8, 60, 8], [9, 64, 7], [10, 67, 1], [11, 72, 1], [12, 76, 1], [13, 67, 1], [14, 72, 1], [15, 76, 1], [16, 60, 8], [17, 62, 7], [18, 69, 1], [19, 74, 1], [20, 77, 1], [21, 69, 1], [22, 74, 1], [23, 77, 1], [24, 60, 8], [25, 62, 7], [26, 69, 1], [27, 74, 1], [28, 77, 1], [29, 69, 1], [30, 74, 1], [31, 77, 1], [32, 59, 8], [33, 62, 7], [34, 67, 1], [35, 74, 1], [36, 77, 1], [37, 67, 1], [38, 74, 1], [39, 77, 1], [40, 59, 8], [41, 62, 7], [42, 67, 1], [43, 74, 1], [44, 77, 1], [45, 67, 1], [46, 74, 1], [47, 77, 1], [48, 60, 8], [49, 64, 7], [50, 67, 1], [51, 72, 1], [52, 76, 1], [53, 67, 1], [54, 72, 1], [55, 76, 1], [56, 60, 8], [57, 64, 7], [58, 67, 1], [59, 72, 1], [60, 76, 1], [61, 67, 1], [62, 72, 1], [63, 76, 1]], "B": [[0, 60, 8], [1, 64, 7], [2, 69, 1], [3, 76, 1], [4, 81, 1], [5, 69, 1], [6, 76, 1], [7, 81, 1], [8, 60, 8], [9, 64, 7], [10, 69, 1], [11, 76, 1], [12, 81, 1], [13, 69, 1], [14, 76, 1], [15, 81, 1], [16, 60, 8], [17, 62, 7], [18, 66, 1], [19, 69, 1], [20, 74, 1], [21, 66, 1], [22, 69, 1], [23, 74, 1], [24, 60, 8], [25, 62, 7], [26, 66, 1], [27, 69, 1], [28, 74, 1], [29, 66, 1], [30, 69, 1], [31, 74, 1], [32, 59, 8], [33, 62, 7], [34, 67, 1], [35, 74, 1], [36, 79, 1], [37, 67, 1], [38, 74, 1], [39, 79, 1], [40, 59, 8], [41, 62, 7], [42, 67, 1], [43, 74, 1], [44, 79, 1], [45, 67, 1], [46, 74, 1], [47, 79, 1], [48, 59, 8], [49, 60, 7], [50, 64, 1], [51, 67, 1], [52, 72, 1], [53, 64, 1], [54, 67, 1], [55, 72, 1], [56, 59, 8], [57, 60, 7], [58, 64, 1], [59, 67, 1], [60, 72, 1], [61, 64, 1], [62, 67, 1], [63, 72, 1]], "C": [[0, 57, 8], [1, 60, 7], [2, 64, 1], [3, 67, 1], [4, 72, 1], [5, 64, 1], [6, 67, 1], [7, 72, 1], [8, 57, 8], [9, 60, 7], [10, 64, 1], [11, 67, 1], [12, 72, 1], [13, 64, 1], [14, 67, 1], [15, 72, 1], [16, 50, 8], [17, 57, 7], [18, 62, 1], [19, 66, 1], [20, 72, 1], [21, 62, 1], [22, 66, 1], [23, 72, 1], [24, 50, 8], [25, 57, 7], [26, 62, 1], [27, 66, 1], [28, 72, 1], [29, 62, 1], [30, 66, 1], [31, 72, 1], [32, 55, 8], [33, 59, 7], [34, 62, 1], [35, 67, 1], [36, 71, 1], [37, 62, 1], [38, 67, 1], [39, 71, 1], [40, 55, 8], [41, 59, 7], [42, 62, 1], [43, 67, 1], [44, 71, 1], [45, 62, 1], [46, 67, 1], [47, 71, 1], [48, 55, 8], [49, 58, 7], [50, 64, 1], [51, 67, 1], [52, 73, 1], [53, 64, 1], [54, 67, 1], [55, 73, 1], [56, 55, 8], [57, 58, 7], [58, 64, 1], [59, 67, 1], [60, 73, 1], [61, 64, 1], [62, 67, 1], [63, 73, 1]], "D": [[0, 53, 8], [1, 57, 7], [2, 62, 1], [3, 69, 1], [4, 74, 1], [5, 62, 1], [6, 69, 1], [7, 74, 1], [8, 53, 8], [9, 57, 7], [10, 62, 1], [11, 69, 1], [12, 74, 1], [13, 62, 1], [14, 69, 1], [15, 74, 1], [16, 53, 8], [17, 56, 7], [18, 62, 1], [19, 65, 1], [20, 71, 1], [21, 62, 1], [22, 65, 1], [23, 71, 1], [24, 53, 8], [25, 56, 7], [26, 62, 1], [27, 65, 1], [28, 71, 1], [29, 62, 1], [30, 65, 1], [31, 71, 1], [32, 52, 8], [33, 55, 7], [34, 60, 1], [35, 67, 1], [36, 72, 1], [37, 60, 1], [38, 67, 1], [39, 72, 1], [40, 52, 8], [41, 55, 7], [42, 60, 1], [43, 67, 1], [44, 72, 1], [45, 60, 1], [46, 67, 1], [47, 72, 1], [48, 52, 8], [49, 53, 7], [50, 57, 1], [51, 60, 1], [52, 65, 1], [53, 57, 1], [54, 60, 1], [55, 65, 1], [56, 52, 8], [57, 53, 7], [58, 57, 1], [59, 60, 1], [60, 65, 1], [61, 57, 1], [62, 60, 1], [63, 65, 1]]},
        {"name": "Piano 2", "instrument": "real-piano", "bars": 4, "A": [[0, 50, 8], [1, 53, 7], [2, 57, 1], [3, 60, 1], [4, 65, 1], [5, 57, 1], [6, 60, 1], [7, 65, 1], [8, 50, 8], [9, 53, 7], [10, 57, 1], [11, 60, 1], [12, 65, 1], [13, 57, 1], [14, 60, 1], [15, 65, 1], [16, 43, 8], [17, 50, 7], [18, 55, 1], [19, 59, 1], [20, 65, 1], [21, 55, 1], [22, 59, 1], [23, 65, 1], [24, 43, 8], [25, 50, 7], [26, 55, 1], [27, 59, 1], [28, 65, 1], [29, 55, 1], [30, 59, 1], [31, 65, 1], [32, 48, 8], [33, 52, 7], [34, 55, 1], [35, 60, 1], [36, 64, 1], [37, 55, 1], [38, 60, 1], [39, 64, 1], [40, 48, 8], [41, 52, 7], [42, 55, 1], [43, 60, 1], [44, 64, 1], [45, 55, 1], [46, 60, 1], [47, 64, 1], [48, 48, 8], [49, 55, 7], [50, 58, 1], [51, 60, 1], [52, 64, 1], [53, 58, 1], [54, 60, 1], [55, 64, 1], [56, 48, 8], [57, 55, 7], [58, 58, 1], [59, 60, 1], [60, 64, 1], [61, 58, 1], [62, 60, 1], [63, 64, 1]], "B": [[0, 41, 8], [1, 53, 7], [2, 57, 1], [3, 60, 1], [4, 64, 1], [5, 57, 1], [6, 60, 1], [7, 64, 1], [8, 41, 8], [9, 53, 7], [10, 57, 1], [11, 60, 1], [12, 64, 1], [13, 57, 1], [14, 60, 1], [15, 64, 1], [16, 42, 8], [17, 48, 7], [18, 57, 1], [19, 60, 1], [20, 63, 1], [21, 57, 1], [22, 60, 1], [23, 63, 1], [24, 42, 8], [25, 48, 7], [26, 57, 1], [27, 60, 1], [28, 63, 1], [29, 57, 1], [30, 60, 1], [31, 63, 1], [32, 44, 8], [33, 53, 7], [34, 59, 1], [35, 60, 1], [36, 62, 1], [37, 59, 1], [38, 60, 1], [39, 62, 1], [40, 44, 8], [41, 53, 7], [42, 59, 1], [43, 60, 1], [44, 62, 1], [45, 59, 1], [46, 60, 1], [47, 62, 1], [48, 43, 8], [49, 53, 7], [50, 55, 1], [51, 59, 1], [52, 62, 1], [53, 55, 1], [54, 59, 1], [55, 62, 1], [56, 43, 8], [57, 53, 7], [58, 55, 1], [59, 59, 1], [60, 62, 1], [61, 55, 1], [62, 59, 1], [63, 62, 1]], "C": [[0, 43, 8], [1, 52, 7], [2, 55, 1], [3, 60, 1], [4, 64, 1], [5, 55, 1], [6, 60, 1], [7, 64, 1], [8, 43, 8], [9, 52, 7], [10, 55, 1], [11, 60, 1], [12, 64, 1], [13, 55, 1], [14, 60, 1], [15, 64, 1], [16, 43, 8], [17, 50, 7], [18, 55, 1], [19, 59, 1], [20, 65, 1], [21, 55, 1], [22, 59, 1], [23, 65, 1], [24, 43, 8], [25, 50, 7], [26, 55, 1], [27, 59, 1], [28, 65, 1], [29, 55, 1], [30, 59, 1], [31, 65, 1], [32, 43, 8], [33, 51, 7], [34, 57, 1], [35, 60, 1], [36, 66, 1], [37, 57, 1], [38, 60, 1], [39, 66, 1], [40, 43, 8], [41, 51, 7], [42, 57, 1], [43, 60, 1], [44, 66, 1], [45, 57, 1], [46, 60, 1], [47, 66, 1], [48, 43, 8], [49, 52, 7], [50, 55, 1], [51, 60, 1], [52, 67, 1], [53, 55, 1], [54, 60, 1], [55, 67, 1], [56, 43, 8], [57, 52, 7], [58, 55, 1], [59, 60, 1], [60, 67, 1], [61, 55, 1], [62, 60, 1], [63, 67, 1]], "D": [[0, 43, 8], [1, 50, 7], [2, 55, 1], [3, 60, 1], [4, 65, 1], [5, 55, 1], [6, 60, 1], [7, 65, 1], [8, 43, 8], [9, 50, 7], [10, 55, 1], [11, 60, 1], [12, 65, 1], [13, 55, 1], [14, 60, 1], [15, 65, 1], [16, 43, 8], [17, 50, 7], [18, 55, 1], [19, 59, 1], [20, 65, 1], [21, 55, 1], [22, 59, 1], [23, 65, 1], [24, 43, 8], [25, 50, 7], [26, 55, 1], [27, 59, 1], [28, 65, 1], [29, 55, 1], [30, 59, 1], [31, 65, 1], [32, 36, 8], [33, 48, 7], [34, 55, 1], [35, 58, 1], [36, 64, 1], [37, 55, 1], [38, 58, 1], [39, 64, 1], [40, 36, 8], [41, 48, 7], [42, 55, 1], [43, 58, 1], [44, 64, 1], [45, 55, 1], [46, 58, 1], [47, 64, 1], [48, 36, 8], [49, 48, 15], [50, 53, 1], [51, 57, 1], [52, 60, 1], [53, 65, 1], [54, 60, 1], [55, 57, 1], [56, 48, 8], [56, 60, 1], [57, 57, 1], [58, 53, 1], [59, 57, 1], [60, 53, 1], [61, 50, 1], [62, 53, 1], [63, 50, 1]]},
        {"name": "Piano 3", "instrument": "real-piano", "bars": 4, "A": [[0, 36, 8], [1, 47, 15], [2, 67, 1], [3, 71, 1], [4, 74, 1], [5, 77, 1], [6, 74, 1], [7, 71, 1], [8, 47, 8], [8, 74, 1], [9, 71, 1], [10, 67, 1], [11, 71, 1], [12, 62, 1], [13, 65, 1], [14, 64, 1], [15, 62, 1], [16, 36, 16], [16, 48, 16], [16, 64, 16], [16, 67, 16], [16, 72, 16]]},
      ],
      sections: [
        {"name": "Bars 1-16", "bars": 16, "play": {"Piano 1": "AAAABBBBCCCCDDDD"}},
        {"name": "Bars 17-32", "bars": 16, "play": {"Piano 2": "AAAABBBBCCCCDDDD"}},
        {"name": "Bars 33-34", "bars": 2, "play": {"Piano 3": "AA"}},
      ]
    },
    {
      id: 'bach-chorale', label: "Bach: Passion Chorale", blurb: "60 BPM \u00b7 BWV 244.54, four voices: choir, organ, cello",
      bpm: 60, kit: 'acoustic', swing: 0, key: { root: 2, scale: 'minor' },
      drums: [],
      synths: [
        {"name": "Soprano", "instrument": "gm-choir-aahs", "bars": 4, "A": [[12, 69, 4], [16, 74, 4], [20, 72, 4], [24, 70, 4], [28, 69, 4], [32, 67, 8], [40, 69, 4], [44, 76, 4], [48, 77, 4], [52, 77, 4], [56, 76, 2], [58, 74, 2], [60, 76, 4]], "B": [[0, 74, 12], [12, 77, 4], [16, 76, 2], [18, 74, 2], [20, 72, 4], [24, 74, 4], [28, 76, 4], [32, 77, 8], [40, 77, 4], [44, 72, 4], [48, 74, 4], [52, 72, 4], [56, 70, 2], [58, 69, 2], [60, 70, 4]], "C": [[0, 69, 12], [12, 77, 4], [16, 76, 2], [18, 77, 2], [20, 79, 4], [24, 77, 4], [28, 76, 4], [32, 74, 8], [40, 76, 4], [44, 69, 4], [48, 70, 4], [52, 69, 4], [56, 67, 4], [60, 72, 4]], "D": [[0, 69, 12]]},
        {"name": "Alto", "instrument": "gm-choir-aahs", "bars": 4, "A": [[12, 65, 4], [16, 65, 2], [18, 67, 2], [20, 69, 4], [24, 62, 2], [26, 64, 2], [28, 65, 4], [32, 65, 4], [36, 64, 4], [40, 65, 4], [44, 69, 4], [48, 69, 4], [52, 69, 4], [56, 69, 4], [60, 69, 2], [62, 67, 2]], "B": [[0, 65, 12], [12, 69, 4], [16, 67, 4], [20, 67, 2], [22, 65, 2], [24, 65, 4], [28, 70, 4], [32, 70, 4], [36, 69, 2], [38, 67, 2], [40, 69, 4], [44, 69, 4], [48, 69, 2], [50, 67, 2], [52, 69, 4], [56, 67, 2], [58, 66, 2], [60, 67, 4]], "C": [[0, 66, 12], [12, 67, 4], [16, 67, 4], [20, 72, 4], [24, 72, 4], [28, 72, 4], [32, 72, 4], [36, 71, 4], [40, 72, 4], [44, 65, 2], [46, 64, 2], [48, 62, 2], [50, 64, 2], [52, 65, 4], [56, 65, 4], [60, 64, 4]], "D": [[0, 65, 12]]},
        {"name": "Tenor", "instrument": "gm-church-organ", "bars": 4, "A": [[12, 62, 4], [16, 62, 2], [18, 64, 2], [20, 65, 4], [24, 67, 4], [28, 60, 4], [32, 62, 4], [36, 60, 4], [40, 60, 4], [44, 64, 4], [48, 64, 4], [52, 62, 4], [56, 62, 4], [60, 61, 4]], "B": [[0, 57, 12], [12, 62, 2], [14, 60, 2], [16, 58, 4], [20, 60, 4], [24, 60, 4], [28, 58, 2], [30, 60, 2], [32, 62, 4], [36, 60, 2], [38, 58, 2], [40, 60, 4], [44, 65, 2], [46, 63, 2], [48, 62, 4], [52, 62, 4], [56, 62, 4], [60, 62, 4]], "C": [[0, 62, 12], [12, 62, 4], [16, 60, 2], [18, 62, 2], [20, 64, 4], [24, 65, 4], [28, 67, 4], [32, 69, 4], [36, 67, 4], [40, 67, 4], [44, 60, 4], [48, 58, 4], [52, 60, 4], [56, 60, 2], [58, 58, 1], [59, 57, 1], [60, 55, 2], [62, 60, 2]], "D": [[0, 60, 12]]},
        {"name": "Bass", "instrument": "real-cello", "bars": 4, "A": [[12, 62, 2], [14, 60, 2], [16, 58, 4], [20, 57, 4], [24, 55, 4], [28, 53, 4], [32, 46, 4], [36, 48, 4], [40, 53, 4], [44, 49, 4], [48, 50, 2], [50, 52, 2], [52, 53, 2], [54, 55, 2], [56, 57, 4], [60, 45, 4]], "B": [[0, 50, 12], [12, 50, 4], [16, 55, 4], [20, 57, 4], [24, 58, 2], [26, 57, 2], [28, 55, 4], [32, 53, 8], [40, 53, 4], [44, 53, 4], [48, 58, 4], [52, 54, 4], [56, 55, 4], [60, 43, 4]], "C": [[0, 50, 12], [12, 47, 4], [16, 48, 4], [20, 60, 2], [22, 59, 2], [24, 57, 4], [28, 55, 4], [32, 53, 4], [36, 55, 4], [40, 48, 4], [44, 53, 4], [48, 55, 4], [52, 57, 2], [54, 58, 2], [56, 60, 4], [60, 48, 4]], "D": [[0, 53, 12]]},
      ],
      sections: [
        {"name": "Chorale", "bars": 13, "play": {"Soprano": "AAAABBBBCCCCD", "Alto": "AAAABBBBCCCCD", "Tenor": "AAAABBBBCCCCD", "Bass": "AAAABBBBCCCCD"}},
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
    return spec ? fromSpec(spec) : null;
  }

  /** Build a project from a spec in the LIST shape (also used by song-file.js). */
  function fromSpec(spec) {
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
    build,
    fromSpec
  };
})();
