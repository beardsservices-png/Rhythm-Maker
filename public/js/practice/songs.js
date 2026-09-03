// songs.js — beginner song presets (public-domain) + the custom-song helpers.
// Pure data + string helpers, no DOM. Notes are written octave-free; the piano
// module drops them into its comfortable octave, the flute module ignores
// octave entirely.
//
// Every preset stays inside C–A of one octave so it plays in a beginner
// flutist's first working range and on the on-screen piano without scrolling.

const PracticeSongs = (() => {

  const PRESETS = [
    { id: 'hotcross',  label: 'Hot Cross Buns',              level: 1,
      notes: 'E D C  E D C  C C C C  D D D D  E D C' },
    { id: 'merrily',   label: 'Merrily We Roll Along',       level: 1,
      notes: 'E D C D  E E E  D D D  E G G' },
    { id: 'auclair',   label: 'Au Clair de la Lune',         level: 1,
      notes: 'C C C D  E D  C E D D  C' },
    { id: 'mary',      label: 'Mary Had a Little Lamb',      level: 2,
      notes: 'E D C D  E E E  D D D  E G G  E D C D  E E E E  D D E D  C' },
    { id: 'twinkle',   label: 'Twinkle, Twinkle, Little Star', level: 2,
      notes: 'C C G G  A A G  F F E E  D D C  G G F F  E E D  G G F F  E E D  C C G G  A A G  F F E E  D D C' },
    { id: 'saints',    label: 'When the Saints Go Marching In', level: 2,
      notes: 'C E F G  C E F G  C E F G E  C E D  E E D C  C D' },
    { id: 'london',    label: 'London Bridge',               level: 2,
      notes: 'G A G F  E F G  D E F  E F G  G A G F  E F G  D G E C' },
    { id: 'ode',       label: 'Ode to Joy',                  level: 3,
      notes: 'E E F G  G F E D  C C D E  E D D  E E F G  G F E D  C C D E  D C C' },
    { id: 'jingle',    label: 'Jingle Bells (chorus)',       level: 3,
      notes: 'E E E  E E E  E G C D E  F F F F  F E E E  E D D E  D G' },
  ];

  const NOTE_TOKEN = /^[A-Ga-g][#b♯♭]?-?\d*$/;

  // "E D C" / "e, d, c" / "F# Gb A" -> ['E','D','C'] ; drops anything unparseable
  function parseTokens(text) {
    return String(text || '')
      .split(/[\s,|/]+/)
      .map(t => t.trim())
      .filter(Boolean)
      .filter(t => NOTE_TOKEN.test(t))
      .map(t => t[0].toUpperCase() + t.slice(1).replace('♯', '#').replace('♭', 'b'))
      .filter(t => NoteUtils.parseNote(t));
  }

  function presetById(id) {
    const p = PRESETS.find(s => s.id === id);
    return p ? parseTokens(p.notes) : null;
  }

  function distinctNotes(tokens) {
    const seen = [];
    tokens.forEach(t => {
      const pc = NoteUtils.parseNote(t).pc;
      if (!seen.some(s => NoteUtils.parseNote(s).pc === pc)) seen.push(t);
    });
    return seen;
  }

  // Random drill — a fresh sequence from a pool of notes, no more than two of
  // the same note in a row so it stays a real reading exercise.
  function randomDrill(pool, length = 12) {
    if (!pool || !pool.length) return [];
    const out = [];
    while (out.length < length) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (out.length >= 2 && out[out.length - 1] === pick && out[out.length - 2] === pick) continue;
      out.push(pick);
    }
    return out;
  }

  // Progressive practice — learn a long tune in growing chunks. Returns a list
  // of note-arrays: the first ~4 notes, then the first ~8, … up to the whole
  // thing. (Folds in Round Robin's "add a bit each pass" idea.)
  function progressiveSlices(tokens, chunk = 4) {
    if (tokens.length <= chunk) return [tokens.slice()];
    const slices = [];
    for (let end = chunk; end < tokens.length; end += chunk) slices.push(tokens.slice(0, end));
    slices.push(tokens.slice());
    return slices;
  }

  return { PRESETS, parseTokens, presetById, distinctNotes, randomDrill, progressiveSlices };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PracticeSongs;
