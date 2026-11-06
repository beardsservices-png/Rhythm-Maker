// song-file.js — open a song file (sheet music or MIDI) as a Studio song.
//
// Reads MusicXML (.musicxml / .xml, or the zipped .mxl that most notation
// programs and sheet-music stores export) and Standard MIDI Files (.mid).
// Every part becomes its own track with the right instrument; drums become
// one track per drum sound, like everything else in the Studio. The result is
// a template spec (the same shape as templates.js) so it is built into a normal,
// fully editable project by Templates.fromSpec().
//
// Packing follows templates.js: a track holds four patterns (A–D) of 4 bars,
// so 16 different bars per track. A 4-bar stretch that repeats (a chorus) reuses
// its pattern; a part with more than four different stretches spills onto
// "Piano 2", "Piano 3" … exactly like the Bach prelude template.
//
// Limits, said plainly: the grid is sixteenth notes (triplets and 32nds are
// rounded), repeat signs are not expanded (the song plays as written, once),
// and chord symbols are not turned into notes.
//
// The file is read in the browser; nothing about it is sent anywhere until you
// save it to your library.

const SongFile = (() => {
  const PAT_BARS = 4, STEPS_BAR = 16, PAT_STEPS = PAT_BARS * STEPS_BAR, SEC_BARS = 16;
  const LETTERS = 'ABCD';

  // General MIDI program (0-127) -> the closest sound the Studio has.
  const GM = [
    'real-piano', 'gm-bright-acoustic-piano', 'gm-electric-grand-piano', 'gm-honkytonk-piano',
    'real-epiano', 'gm-electric-piano-2', 'gm-harpsichord', 'gm-clavinet',
    'gm-celesta', 'gm-glockenspiel', 'gm-music-box', 'real-vibes', 'real-marimba', 'gm-xylophone', 'gm-tubular-bells', 'gm-dulcimer',
    'gm-drawbar-organ', 'gm-percussive-organ', 'gm-rock-organ', 'gm-church-organ', 'gm-reed-organ', 'gm-accordion', 'gm-harmonica', 'gm-tango-accordion',
    'real-nylon', 'real-guitar', 'gm-electric-guitar-jazz', 'gm-electric-guitar-clean', 'gm-electric-guitar-muted', 'gm-overdriven-guitar', 'gm-distortion-guitar', 'gm-guitar-harmonics',
    'real-upright', 'real-ebass', 'gm-electric-bass-pick', 'gm-fretless-bass', 'gm-slap-bass-1', 'gm-slap-bass-2', 'gm-synth-bass-1', 'gm-synth-bass-2',
    'real-violin', 'gm-viola', 'real-cello', 'gm-contrabass', 'gm-tremolo-strings', 'gm-pizzicato-strings', 'real-harp', 'gm-timpani',
    'real-strings', 'gm-string-ensemble-2', 'gm-synth-strings-1', 'gm-synth-strings-2', 'gm-choir-aahs', 'gm-voice-oohs', 'gm-synth-choir', 'gm-orchestra-hit',
    'real-trumpet', 'real-trombone', 'gm-tuba', 'gm-muted-trumpet', 'real-horn', 'gm-brass-section', 'gm-synth-brass-1', 'gm-synth-brass-2',
    'gm-soprano-sax', 'real-sax', 'gm-tenor-sax', 'gm-baritone-sax', 'gm-oboe', 'gm-english-horn', 'gm-bassoon', 'gm-clarinet',
    'gm-piccolo', 'real-flute', 'gm-recorder', 'gm-pan-flute', 'gm-blown-bottle', 'gm-shakuhachi', 'gm-whistle', 'gm-ocarina',
    'gm-lead-1-square', 'gm-lead-2-sawtooth', 'gm-lead-3-calliope', 'gm-lead-4-chiff', 'gm-lead-5-charang', 'gm-lead-6-voice', 'gm-lead-7-fifths', 'gm-lead-8-bass-lead',
    'gm-pad-1-new-age', 'gm-pad-2-warm', 'gm-pad-3-polysynth', 'gm-pad-4-choir', 'gm-pad-5-bowed', 'gm-pad-6-metallic', 'gm-pad-7-halo', 'gm-pad-8-sweep',
    'gm-fx-1-rain', 'gm-fx-2-soundtrack', 'gm-fx-3-crystal', 'gm-fx-4-atmosphere', 'gm-fx-5-brightness', 'gm-fx-6-goblins', 'gm-fx-7-echoes', 'gm-fx-8-scifi',
    'gm-sitar', 'gm-banjo', 'gm-shamisen', 'gm-koto', 'real-kalimba', 'gm-bagpipe', 'gm-fiddle', 'gm-shanai',
    'gm-tinkle-bell', 'gm-agogo', 'gm-steel-drums', 'gm-woodblock', 'gm-taiko-drum', 'gm-melodic-tom', 'gm-synth-drum', 'gm-reverse-cymbal',
    'gm-guitar-fret-noise', 'gm-breath-noise', 'gm-seashore', 'gm-bird-tweet', 'gm-telephone-ring', 'gm-helicopter', 'gm-applause', 'gm-gunshot'
  ];
  const GM_NAMES = ['Piano', 'Piano', 'Electric grand', 'Honky-tonk', 'E-piano', 'E-piano', 'Harpsichord', 'Clavinet',
    'Celesta', 'Glockenspiel', 'Music box', 'Vibes', 'Marimba', 'Xylophone', 'Bells', 'Dulcimer',
    'Organ', 'Organ', 'Rock organ', 'Church organ', 'Reed organ', 'Accordion', 'Harmonica', 'Accordion',
    'Nylon guitar', 'Acoustic guitar', 'Jazz guitar', 'Clean guitar', 'Muted guitar', 'Overdrive guitar', 'Distortion guitar', 'Guitar harmonics',
    'Upright bass', 'Bass', 'Pick bass', 'Fretless bass', 'Slap bass', 'Slap bass', 'Synth bass', 'Synth bass',
    'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo strings', 'Pizzicato', 'Harp', 'Timpani',
    'Strings', 'Strings', 'Synth strings', 'Synth strings', 'Choir', 'Voice', 'Synth choir', 'Orchestra hit',
    'Trumpet', 'Trombone', 'Tuba', 'Muted trumpet', 'Horn', 'Brass', 'Synth brass', 'Synth brass',
    'Soprano sax', 'Alto sax', 'Tenor sax', 'Bari sax', 'Oboe', 'English horn', 'Bassoon', 'Clarinet',
    'Piccolo', 'Flute', 'Recorder', 'Pan flute', 'Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
    'Lead', 'Lead', 'Lead', 'Lead', 'Lead', 'Lead', 'Lead', 'Bass lead',
    'Pad', 'Pad', 'Pad', 'Pad', 'Pad', 'Pad', 'Pad', 'Pad',
    'FX', 'FX', 'FX', 'FX', 'FX', 'FX', 'FX', 'FX',
    'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
    'Bell', 'Agogo', 'Steel drums', 'Woodblock', 'Taiko', 'Tom', 'Synth drum', 'Reverse cymbal',
    'Fret noise', 'Breath', 'Seashore', 'Birds', 'Phone', 'Helicopter', 'Applause', 'Gunshot'];

  // Part names in sheet music (no MIDI program given) -> a sound. First match wins.
  const NAME_SOUND = [
    [/soprano|alto voice|tenor voice|choir|chorus|voice|vocal|sing|melody/i, 'gm-choir-aahs'],
    [/church organ|pipe organ/i, 'gm-church-organ'], [/organ/i, 'gm-drawbar-organ'],
    [/e\.? ?piano|electric piano|rhodes|keys/i, 'real-epiano'], [/synth/i, 'gm-pad-3-polysynth'],
    [/piano|klavier|pianoforte/i, 'real-piano'], [/harpsichord/i, 'gm-harpsichord'],
    [/violoncello|cello/i, 'real-cello'], [/viola/i, 'gm-viola'], [/violin|fiddle/i, 'real-violin'],
    [/contrabass|double bass|upright bass/i, 'real-upright'], [/bass guitar|electric bass|^bass$|\bbass\b/i, 'real-ebass'],
    [/strings/i, 'real-strings'], [/flute/i, 'real-flute'], [/clarinet/i, 'gm-clarinet'], [/oboe/i, 'gm-oboe'],
    [/bassoon/i, 'gm-bassoon'], [/trumpet/i, 'real-trumpet'], [/trombone/i, 'real-trombone'], [/tuba/i, 'gm-tuba'],
    [/horn/i, 'real-horn'], [/sax/i, 'real-sax'], [/harp/i, 'real-harp'],
    [/distortion|overdrive|lead guitar|rhythm guitar|electric guitar/i, 'gm-overdriven-guitar'],
    [/nylon|classical guitar/i, 'real-nylon'], [/guitar/i, 'real-guitar'],
    [/marimba/i, 'real-marimba'], [/vibra/i, 'real-vibes'], [/glock/i, 'gm-glockenspiel']
  ];

  // General MIDI drum notes -> the Studio's drum roles.
  const GM_DRUM = {
    35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare',
    41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
    42: 'hat', 44: 'hat', 46: 'openhat', 49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
    51: 'hat', 53: 'hat', 59: 'hat', 54: 'tamb', 56: 'cowbell', 60: 'bongo', 61: 'bongo',
    62: 'conga', 63: 'conga', 64: 'conga', 69: 'shaker', 70: 'shaker', 75: 'rim', 76: 'perc', 77: 'perc'
  };
  const DRUM_NAMES = { kick: 'Kick', snare: 'Snare', clap: 'Clap', hat: 'Hi-hat', openhat: 'Open hat', perc: 'Perc',
    tom: 'Toms', rim: 'Rim', crash: 'Crash', snap: 'Snap', shaker: 'Shaker', tamb: 'Tambourine', cowbell: 'Cowbell',
    conga: 'Conga', bongo: 'Bongo' };
  const DRUM_ORDER = Object.keys(DRUM_NAMES);
  // Unpitched instruments in sheet music, by name.
  const NAME_DRUM = [[/kick|bass drum/i, 'kick'], [/snare|side stick/i, 'snare'], [/rim|stick/i, 'rim'],
    [/clap/i, 'clap'], [/open hi.?hat|open hat/i, 'openhat'], [/hi.?hat|ride/i, 'hat'], [/crash|cymbal|splash|china/i, 'crash'],
    [/tom/i, 'tom'], [/tamb/i, 'tamb'], [/cowbell/i, 'cowbell'], [/conga/i, 'conga'], [/bongo/i, 'bongo'],
    [/shaker|maraca|cabasa/i, 'shaker']];

  const soundForName = (name) => { const hit = NAME_SOUND.find(([re]) => re.test(name || '')); return hit ? hit[1] : null; };
  const drumForName = (name) => { const hit = NAME_DRUM.find(([re]) => re.test(name || '')); return hit ? hit[1] : 'perc'; };
  const velChar = (v) => (v >= 110 ? 'X' : v < 60 ? 'o' : 'x');

  // ─────────────────────────────────────────────── MIDI
  function readMidi(buf) {
    const d = new DataView(buf);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); return s; };
    if (str(4) !== 'MThd') throw new Error('This is not a MIDI file.');
    const hlen = d.getUint32(4);
    const ntrks = d.getUint16(10);
    const div = d.getUint16(12);
    if (div & 0x8000) throw new Error('This MIDI file uses SMPTE timing, which is not supported.');
    const ppq = div;
    p = 8 + hlen;
    let tempo = null;
    const parts = new Map();   // key "track:channel" -> {name, program, channel, notes}
    let firstTitle = '';
    for (let t = 0; t < ntrks && p < buf.byteLength; t++) {
      if (str(4) !== 'MTrk') throw new Error('The MIDI file is damaged (track ' + (t + 1) + ').');
      const len = d.getUint32(p + 4);
      p += 8;
      const end = p + len;
      let tick = 0, status = 0, trackName = '';
      const programs = {};
      const open = {};      // channel*128+note -> [start, vel]
      const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
      const part = (ch) => {
        const key = t + ':' + ch;
        if (!parts.has(key)) parts.set(key, { track: t, channel: ch, program: null, name: '', notes: [] });
        return parts.get(key);
      };
      while (p < end) {
        tick += vlq();
        let b = d.getUint8(p);
        if (b & 0x80) { status = b; p++; } else if (!status) throw new Error('The MIDI file is damaged.');
        if (status === 0xff) {
          const type = d.getUint8(p++); const l = vlq();
          if (type === 0x51 && l === 3 && tempo == null) tempo = 60000000 / ((d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2));
          if (type === 0x03) trackName = new TextDecoder().decode(new Uint8Array(buf, p, l)).trim();
          if (type === 0x2f) { p += l; break; }
          p += l; status = 0;
          continue;
        }
        if (status === 0xf0 || status === 0xf7) { p += vlq(); status = 0; continue; }
        const kind = status & 0xf0, ch = status & 0x0f;
        const a = d.getUint8(p++);
        const two = !(kind === 0xc0 || kind === 0xd0);
        const v = two ? d.getUint8(p++) : 0;
        if (kind === 0xc0) { programs[ch] = a; part(ch).program = a; continue; }
        if (kind === 0x90 && v > 0) { open[ch * 128 + a] = [tick, v]; continue; }
        if (kind === 0x80 || (kind === 0x90 && v === 0)) {
          const o = open[ch * 128 + a];
          if (!o) continue;
          delete open[ch * 128 + a];
          const s = Math.round(o[0] * 4 / ppq);
          const e = Math.round(tick * 4 / ppq);
          part(ch).notes.push([s, a, Math.max(1, e - s), o[1]]);
        }
      }
      p = end;
      for (const pt of parts.values()) if (pt.track === t) pt.name = pt.name || trackName;
      if (t === 0 && trackName) firstTitle = trackName;
    }
    const song = { title: firstTitle, bpm: Math.round(tempo || 120), parts: [], drums: [] };
    const drumHits = {};
    for (const pt of parts.values()) {
      if (!pt.notes.length) continue;
      if (pt.channel === 9) {
        pt.notes.forEach(([s, m, , v]) => {
          const role = GM_DRUM[m] || 'perc';
          const h = drumHits[role] || (drumHits[role] = {});
          const c = velChar(v);
          if (!h[s] || 'oxX'.indexOf(c) > 'oxX'.indexOf(h[s])) h[s] = c;
        });
        continue;
      }
      const prog = pt.program == null ? 0 : pt.program;
      const name = (pt.name && !/^track ?\d*$/i.test(pt.name)) ? pt.name : GM_NAMES[prog];
      song.parts.push({ name, instrument: soundForName(pt.name) && pt.program == null ? soundForName(pt.name) : GM[prog],
                        notes: pt.notes.map(([s, m, l]) => [s, m, l]) });
    }
    DRUM_ORDER.forEach(r => { if (drumHits[r]) song.drums.push({ name: DRUM_NAMES[r], role: r, hits: drumHits[r] }); });
    return song;
  }

  // ─────────────────────────────────────────────── MusicXML
  const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const kid = (el, tag) => { for (const c of el.children) if (c.localName === tag) return c; return null; };
  const kids = (el, tag) => [...el.children].filter(c => c.localName === tag);
  const num = (el, tag, dflt) => { const k = el && kid(el, tag); return k ? parseFloat(k.textContent) : dflt; };

  function readMusicXML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The sheet-music file could not be read (broken XML).');
    const root = doc.documentElement;
    if (root.localName === 'score-timewise') throw new Error('This MusicXML is "timewise", which is rare; export it as a normal (partwise) MusicXML file.');
    if (root.localName !== 'score-partwise') throw new Error('This file is not MusicXML sheet music.');

    const title = ((doc.querySelector('work > work-title') || doc.querySelector('movement-title') || {}).textContent || '').trim();
    const info = {};
    const plist = kid(root, 'part-list');
    if (plist) for (const sp of kids(plist, 'score-part')) {
      const instr = {};
      kids(sp, 'score-instrument').forEach(si => { instr[si.getAttribute('id')] = (kid(si, 'instrument-name') || {}).textContent || ''; });
      const mi = kid(sp, 'midi-instrument');
      info[sp.getAttribute('id')] = {
        name: ((kid(sp, 'part-name') || {}).textContent || '').trim(),
        program: mi && kid(mi, 'midi-program') ? num(mi, 'midi-program', 1) - 1 : null,
        channel: mi && kid(mi, 'midi-channel') ? num(mi, 'midi-channel', 1) : null,
        instr
      };
    }

    let bpm = null;
    const song = { title, bpm: 0, parts: [], drums: [] };
    const drumHits = {};
    kids(root, 'part').forEach((part, pi) => {
      const meta = info[part.getAttribute('id')] || { name: '', program: null, channel: null, instr: {} };
      let divisions = 1, measureStart = 0, barQ = 4, pad = 0;
      const notes = [];
      const lastByPitch = {};
      const barOneHits = [];
      const isDrumPart = meta.channel === 10;
      kids(part, 'measure').forEach((m, mi) => {
        let cursor = 0, maxCursor = 0, lastStart = 0;
        for (const el of m.children) {
          const tag = el.localName;
          if (tag === 'attributes') {
            divisions = num(el, 'divisions', divisions);
            const time = kid(el, 'time');
            if (time && kid(time, 'beats')) barQ = num(time, 'beats', 4) * 4 / num(time, 'beat-type', 4);
          } else if (tag === 'sound' || tag === 'direction') {
            const snd = tag === 'sound' ? el : el.querySelector('sound');
            if (bpm == null && snd && snd.getAttribute('tempo')) bpm = parseFloat(snd.getAttribute('tempo'));
            const pm = tag === 'direction' && el.querySelector('metronome > per-minute');
            if (bpm == null && pm) bpm = parseFloat(pm.textContent);
          } else if (tag === 'backup') {
            cursor -= num(el, 'duration', 0) / divisions;
          } else if (tag === 'forward') {
            cursor += num(el, 'duration', 0) / divisions; maxCursor = Math.max(maxCursor, cursor);
          } else if (tag === 'note') {
            if (kid(el, 'grace') || kid(el, 'cue')) continue;
            const dur = num(el, 'duration', 0) / divisions;
            const chord = !!kid(el, 'chord');
            const start = chord ? lastStart : cursor;
            if (!chord) { lastStart = cursor; cursor += dur; maxCursor = Math.max(maxCursor, cursor); }
            if (kid(el, 'rest')) continue;
            const abs = measureStart + start;
            const s = Math.round((abs + pad) * 4);
            const l = Math.max(1, Math.round((abs + dur + pad) * 4) - s);
            const unp = kid(el, 'unpitched');
            if (unp || isDrumPart) {
              const iid = kid(el, 'instrument') && kid(el, 'instrument').getAttribute('id');
              const role = drumForName((iid && meta.instr[iid]) || meta.name);
              const h = drumHits[role] || (drumHits[role] = {});
              h[s] = h[s] === 'X' ? 'X' : (kid(el, 'notations') && el.querySelector('accent') ? 'X' : 'x');
              if (mi === 0) barOneHits.push([role, s]);
              continue;
            }
            const pitch = kid(el, 'pitch');
            if (!pitch) continue;
            const midi = (num(pitch, 'octave', 4) + 1) * 12 + STEP_PC[(kid(pitch, 'step') || {}).textContent] + num(pitch, 'alter', 0);
            const ties = kids(el, 'tie').map(t => t.getAttribute('type'));
            const prev = lastByPitch[midi];
            if (ties.includes('stop') && prev && prev[0] + prev[2] >= s - 1) { prev[2] = Math.max(prev[2], s + l - prev[0]); continue; }
            const n = [s, Math.round(midi), l];
            notes.push(n);
            lastByPitch[midi] = n;
          }
        }
        // A first bar shorter than a full bar is a pickup (whatever "implicit" says: many
        // programs write it wrong). Pad so bar 1 starts on a barline.
        if (mi === 0 && maxCursor > 0 && maxCursor < barQ - 1e-6) {
          const shift = barQ - maxCursor;
          notes.forEach(n => { n[0] += Math.round(shift * 4); });
          const k = Math.round(shift * 4);
          barOneHits.forEach(([role, st]) => { const h = drumHits[role]; const c = h[st]; delete h[st]; h[st + k] = c; });
          pad = shift;
        }
        measureStart += Math.max(maxCursor, cursor);
      });
      if (notes.length) {
        const name = meta.name || 'Part ' + (pi + 1);
        const inst = meta.program != null ? GM[Math.max(0, Math.min(127, meta.program))] : (soundForName(name) || 'real-piano');
        song.parts.push({ name, instrument: inst, notes });
      }
    });
    // A choir score (Soprano / Alto / Tenor / Bass): those are voices, and the bass voice
    // sounds best on cello, as in the built-in Bach chorale.
    const VOICE = /^(soprano|alto|tenor|bass|baritone)\s*\d*\.?$/i;
    if (song.parts.filter(p => VOICE.test(p.name)).length >= 3) {
      song.parts.forEach(p => {
        if (!VOICE.test(p.name)) return;
        p.instrument = /^(bass|baritone)/i.test(p.name) ? 'real-cello' : /^tenor/i.test(p.name) ? 'gm-church-organ' : 'gm-choir-aahs';
      });
    }
    DRUM_ORDER.forEach(r => { if (drumHits[r]) song.drums.push({ name: DRUM_NAMES[r], role: r, hits: drumHits[r] }); });
    song.bpm = Math.round(bpm || 100);
    return song;
  }

  // .mxl = a zip holding the MusicXML. Unzipped here with the browser's own inflate.
  async function unzipMxl(buf) {
    const d = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This .mxl file is damaged (not a zip).');
    const count = d.getUint16(eocd + 10, true);
    let p = d.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (d.getUint32(p, true) !== 0x02014b50) break;
      const method = d.getUint16(p + 10, true), csize = d.getUint32(p + 20, true);
      const nlen = d.getUint16(p + 28, true), xlen = d.getUint16(p + 30, true), clen = d.getUint16(p + 32, true);
      const off = d.getUint32(p + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
      files[name] = { method, csize, off };
      p += 46 + nlen + xlen + clen;
    }
    const read = async (name) => {
      const f = files[name];
      const lh = f.off, dataAt = lh + 30 + d.getUint16(lh + 26, true) + d.getUint16(lh + 28, true);
      const raw = new Uint8Array(buf, dataAt, f.csize);
      if (f.method === 0) return new TextDecoder().decode(raw);
      if (f.method !== 8) throw new Error('This .mxl file uses an unusual compression.');
      const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(ds).text();
    };
    let target = null;
    if (files['META-INF/container.xml']) {
      const m = /full-path="([^"]+)"/.exec(await read('META-INF/container.xml'));
      if (m && files[m[1]]) target = m[1];
    }
    if (!target) target = Object.keys(files).find(n => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
    if (!target) throw new Error('No sheet music found inside this .mxl file.');
    return read(target);
  }

  // ─────────────────────────────────────────────── packing into the Studio's shape
  function guessKey(parts) {
    const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const hist = new Array(12).fill(0);
    parts.forEach(p => p.notes.forEach(([, m, l]) => { hist[((m % 12) + 12) % 12] += l; }));
    if (!hist.some(Boolean)) return null;
    let best = null;
    for (let r = 0; r < 12; r++) for (const [scale, prof] of [['major', major], ['minor', minor]]) {
      let sc = 0; for (let i = 0; i < 12; i++) sc += hist[(r + i) % 12] * prof[i];
      if (!best || sc > best[0]) best = [sc, r, scale];
    }
    return { root: best[1], scale: best[2] };
  }

  /** Unique non-empty 4-bar chunks -> patterns, four per track, spilling onto numbered tracks. */
  function pack(chunks, isEmpty) {
    const uniq = [], keys = [], where = [];
    chunks.forEach(c => {
      if (isEmpty(c)) { where.push(null); return; }
      const k = JSON.stringify(c);
      let i = keys.indexOf(k);
      if (i < 0) { i = uniq.length; uniq.push(c); keys.push(k); }
      where.push([Math.floor(i / 4), LETTERS[i % 4]]);
    });
    const groups = [];
    for (let t = 0; t * 4 < uniq.length; t++) groups.push(uniq.slice(t * 4, t * 4 + 4));
    return { groups, where };
  }

  function toSpec(song, label) {
    let last = 0;
    song.parts.forEach(p => p.notes.forEach(([s, , l]) => { last = Math.max(last, s + l); }));
    song.drums.forEach(dr => Object.keys(dr.hits).forEach(s => { last = Math.max(last, +s + 1); }));
    if (!last) throw new Error('No notes found in this file.');
    const totalBars = Math.ceil(last / STEPS_BAR);
    const nChunks = Math.ceil(totalBars / PAT_BARS);
    const used = new Set();
    const uniqueName = (n) => { let x = n, i = 2; while (used.has(x)) x = `${n} (${i++})`; used.add(x); return x; };
    const layout = [];   // [trackName, letters-per-chunk]
    const drums = [], synths = [];

    song.drums.forEach(dr => {
      const chunks = Array.from({ length: nChunks }, () => new Array(PAT_STEPS).fill('.'));
      Object.entries(dr.hits).forEach(([s, ch]) => { s = +s; const c = Math.floor(s / PAT_STEPS); if (c < nChunks) chunks[c][s - c * PAT_STEPS] = ch; });
      const strs = chunks.map(c => c.join(''));
      const { groups, where } = pack(strs, (c) => !/[^.]/.test(c));
      const base = uniqueName(dr.name);
      groups.forEach((pats, ti) => {
        const name = groups.length === 1 ? base : uniqueName(`${dr.name} ${ti + 1}`);
        const tr = { name, role: dr.role, bars: PAT_BARS };
        pats.forEach((pt, i) => { tr[LETTERS[i]] = pt; });
        drums.push(tr);
        layout.push([name, where.map(w => (w && w[0] === ti ? w[1] : '-'))]);
      });
    });
    song.parts.forEach(p => {
      const chunks = Array.from({ length: nChunks }, () => []);
      p.notes.forEach(([s, m, l]) => {
        if (s < 0) return;
        const c = Math.floor(s / PAT_STEPS);
        if (c >= nChunks) return;
        const rel = s - c * PAT_STEPS;
        chunks[c].push([rel, m, Math.max(1, Math.min(l, PAT_STEPS - rel))]);
      });
      chunks.forEach(c => c.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
      const { groups, where } = pack(chunks, (c) => !c.length);
      const base = (p.name || 'Part').slice(0, 24);
      groups.forEach((pats, ti) => {
        const name = uniqueName(groups.length === 1 ? base : `${base} ${ti + 1}`);
        const tr = { name, instrument: p.instrument, bars: PAT_BARS };
        pats.forEach((pt, i) => { tr[LETTERS[i]] = pt; });
        synths.push(tr);
        layout.push([name, where.map(w => (w && w[0] === ti ? w[1] : '-'))]);
      });
    });

    const sections = [];
    for (let start = 0; start < totalBars; start += SEC_BARS) {
      const bars = Math.min(SEC_BARS, totalBars - start);
      const play = {};
      layout.forEach(([name, per]) => {
        let s = '';
        for (let b = 0; b < bars; b++) s += per[Math.floor((start + b) / PAT_BARS)];
        if (/[^-]/.test(s)) play[name] = s;
      });
      sections.push({ name: `Bars ${start + 1}-${start + bars}`, bars, play });
    }
    const bpm = Math.max(40, Math.min(240, song.bpm || 100));
    return {
      id: 'file', label, blurb: `${bpm} BPM · ${drums.length + synths.length} tracks · opened from a file`,
      bpm, kit: 'acoustic', swing: 0, key: guessKey(song.parts), drums, synths, sections,
      _summary: { bars: totalBars, tracks: drums.length + synths.length,
                  notes: song.parts.reduce((a, p) => a + p.notes.length, 0),
                  hits: song.drums.reduce((a, dr) => a + Object.keys(dr.hits).length, 0) }
    };
  }

  /** File -> template spec. Throws an Error with a plain-English message. */
  async function read(file) {
    const name = file.name || 'Song';
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    const buf = await file.arrayBuffer();
    let song;
    if (ext === 'mid' || ext === 'midi' || ext === 'kar') song = readMidi(buf);
    else if (ext === 'mxl') song = readMusicXML(await unzipMxl(buf));
    else if (ext === 'xml' || ext === 'musicxml') song = readMusicXML(new TextDecoder().decode(buf));
    else if (ext === 'pdf') throw new Error('A PDF is a picture of the sheet music. Export MusicXML from the program that made it, or ask Claude to read the PDF into MusicXML first.');
    else throw new Error('Open a MusicXML (.musicxml, .xml, .mxl) or MIDI (.mid) file.');
    const fileTitle = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    const title = (song.title || '').replace(/\.(mxl|musicxml|xml|mid|midi)$/i, '').trim();
    const label = (title.length > 1 && !/^untitled/i.test(title) ? title : fileTitle).slice(0, 60);
    return toSpec(song, label);
  }

  return { read, readMidi, readMusicXML, unzipMxl, toSpec };
})();
