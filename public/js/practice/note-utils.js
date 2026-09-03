// note-utils.js — note-name / MIDI / frequency helpers for Practice Mode.
// Deliberately standalone (no DOM, no audio) so the Rhythm Maker DAW can pull
// this file in later without dragging the practice shell along with it.

const NoteUtils = (() => {
  // Pitch classes 0..11 starting at C.
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // What we show a beginner — both spellings for the black keys.
  const DISPLAY_NAMES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F',
                         'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];

  const FLAT_TO_SHARP = { DB: 'C#', EB: 'D#', FB: 'E', GB: 'F#', AB: 'G#', BB: 'A#', CB: 'B' };

  const DEFAULT_A4 = 440;

  function clampA4(a4) {
    const n = Number(a4);
    if (!isFinite(n)) return DEFAULT_A4;
    return Math.min(446, Math.max(430, n));
  }

  // "C", "c#", "Db", "F#4", "bb3" -> { pc, octave|null, display }  (null = octave unspecified)
  function parseNote(token) {
    if (token == null) return null;
    const raw = String(token).trim().replace('♯', '#').replace('♭', 'b');
    const m = raw.match(/^([A-Ga-g])([#b]?)(-?\d+)?$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const accidental = m[2].toLowerCase();
    const octave = m[3] != null && m[3] !== '' ? parseInt(m[3], 10) : null;

    const name = letter + accidental;
    let pc;
    if (accidental === 'b') {
      pc = SHARP_NAMES.indexOf(FLAT_TO_SHARP[name.toUpperCase()]);
    } else {
      pc = SHARP_NAMES.indexOf(name);
    }
    if (pc < 0) return null;
    return { pc, octave, display: DISPLAY_NAMES[pc] };
  }

  function midiOf(note, fallbackOctave) {
    const oct = note.octave != null ? note.octave : fallbackOctave;
    return (oct + 1) * 12 + note.pc; // MIDI: C4 = 60
  }

  function midiToFreq(midi, a4) {
    return clampA4(a4 || DEFAULT_A4) * Math.pow(2, (midi - 69) / 12);
  }

  function freqToMidiFloat(freq, a4) {
    return 69 + 12 * Math.log2(freq / clampA4(a4 || DEFAULT_A4));
  }

  // Nearest note to a frequency: { pc, octave, midi, cents } (cents: -50..+50 off)
  function freqToNote(freq, a4) {
    const f = freqToMidiFloat(freq, a4);
    const midi = Math.round(f);
    const cents = Math.round((f - midi) * 100);
    return { pc: ((midi % 12) + 12) % 12, octave: Math.floor(midi / 12) - 1, midi, cents };
  }

  // How many cents a heard frequency sits from a target MIDI note (signed).
  function centsFrom(freq, targetMidi, a4) {
    return (freqToMidiFloat(freq, a4) - targetMidi) * 100;
  }

  // Signed cents from a heard frequency to a target note. Octave-exact measures
  // against that exact pitch; otherwise it folds onto the nearest instance of
  // the target's pitch class (so playing it an octave off still reads in-tune).
  function centsOff(freq, targetNote, { octaveExact, a4, fallbackOctave }) {
    if (!(freq > 0)) return Infinity;
    const heard = freqToMidiFloat(freq, a4);
    if (octaveExact) return (heard - midiOf(targetNote, fallbackOctave)) * 100;
    const nearest = Math.round(heard);
    let d = (targetNote.pc - (((nearest % 12) + 12) % 12) + 12) % 12;
    if (d > 6) d -= 12;
    return (heard - (nearest + d)) * 100;
  }

  // Does a heard frequency match a target note, within a ± cents window?
  function matches(freq, targetNote, opts) {
    return Math.abs(centsOff(freq, targetNote, opts)) <= opts.toleranceCents;
  }

  return {
    SHARP_NAMES, FLAT_NAMES, DISPLAY_NAMES, DEFAULT_A4,
    clampA4, parseNote, midiOf, midiToFreq, freqToMidiFloat,
    freqToNote, centsFrom, centsOff, matches,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NoteUtils;
