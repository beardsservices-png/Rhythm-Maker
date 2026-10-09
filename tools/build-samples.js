// build-samples.js — fetches the recorded instruments and drum hits the Studio
// plays, trims and levels them, and writes small mono MP3s to public/samples/
// plus public/js/engine/sample-manifest.js (the map the Samples engine reads).
//
// You only run this to change the sample set; the results are committed.
//   node tools/build-samples.js            (needs ffmpeg with libmp3lame)
//
// Every source is free to redistribute — see CREDITS below, which also lands in
// the manifest so the manual can show it.
//
// Each sample is pitch-checked on the way through: a file whose detected pitch
// is more than half a semitone from its name is reported, so a wrong octave in
// someone's file naming can't sneak in.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'samples');
const CACHE = path.join(os.tmpdir(), 'bhs-sample-cache');
fs.mkdirSync(CACHE, { recursive: true });

const TONEJS = 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/';
const DANIGB = 'https://raw.githubusercontent.com/danigb/samples/main/audio/';
const VCSL = 'https://raw.githubusercontent.com/sgossner/VCSL/master/';
const enc = (p) => encodeURI(p).replace(/#/g, '%23');
const RATE = 44100;

const CREDITS = [
  { what: 'Grand Piano', who: 'Splendid Grand Piano (Steinway) via sfzinstruments', license: 'Public domain' },
  { what: 'Electric Piano', who: 'jRhodes3d — 1977 Rhodes Mark I, sampled by J. Learman', license: 'Samples CC BY-NC; music you make with them is yours (CC0)' },
  { what: 'Upright Bass', who: '1958 Otto Rubner double bass, played and mapped by D. Smolken', license: 'Samples CC BY-NC; music you make with them is yours (CC0)' },
  { what: 'Strings, Violin, Cello, Brass, Flute, Sax, Guitars, Electric Bass, Harp', who: 'tonejs-instruments by Nicholas Brosowsky (from VSCO2, Karoryfer, Univ. of Iowa MIS and Freesound)', license: 'CC BY 3.0' },
  { what: 'Vibraphone, Marimba, Kalimba, claps, hi-hats, shaker, tambourine, cowbell, congas, bongos, claves, cymbal', who: 'Versilian Community Sample Library (VCSL)', license: 'CC0 (public domain)' },
  { what: 'Kicks, snares, toms, cymbals, snaps', who: 'Sonic Pi sample pack (Freesound contributors) via Sample Pi', license: 'CC0 (public domain)' }
];

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function midiOf(name) {
  const m = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  return 12 * (parseInt(m[3], 10) + 1) + NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
/** Keep notes roughly every `gap` semitones inside [lo, hi]. */
function spread(list, lo, hi, gap) {
  const sorted = list.filter(x => x.midi >= lo && x.midi <= hi).sort((a, b) => a.midi - b.midi);
  const out = [];
  sorted.forEach(x => { if (!out.length || x.midi - out[out.length - 1].midi >= gap) out.push(x); });
  return out;
}
const tonejs = (inst, notes) => notes.split(' ').map(n => ({ midi: midiOf(n), url: TONEJS + inst + '/' + n.replace('#', 's') + '.mp3' }));

// ── melodic instruments ─────────────────────────────────────────────
const INSTRUMENTS = {
  'real-piano': {
    cap: 7, gap: 3,
    src: 'A0 A1 A2 A3 A4 A5 A6 C2 C3 C4 C6 C7 D#5 D#6 D1 D2 D3 D4 D5 D6 E1 E2 E3 E4 E5 E6 F#5 F#6 F1 F2 F3 F4 F5 F6 G#2 G#4 G#5 G#6 G1 G2 G3 G4 G5 G6 A#2 A#4 A#5 A#6'
      .split(' ').map(n => ({ midi: midiOf(n), url: DANIGB + 'splendid-grand-piano/' + encodeURIComponent('Mf-' + n) + '.m4a' })),
    lo: 21, hi: 84
  },
  'real-epiano': {
    cap: 6, gap: 3, lo: 29, hi: 96,
    src: [[29, 'F1'], [35, 'B1'], [40, 'E2'], [45, 'A2'], [50, 'D3'], [55, 'G3'], [59, 'B3'], [62, 'D4'], [65, 'F4'], [71, 'B4'], [76, 'E5'], [81, 'A5'], [86, 'D6'], [91, 'G6'], [96, 'C7']]
      .map(([m, n]) => ({ midi: m, url: DANIGB + 'jlearman/rhodes-mki/jRhodes3d-mono/' + encodeURIComponent(`A_0${String(m).padStart(2, '0')}__${n}_${m >= 71 ? 4 : 3}`) + '.m4a' }))
  },
  'real-strings': {
    cap: 6, gap: 3, lo: 36, hi: 96,
    src: tonejs('cello', 'C2 D#2 G2 A2 C3 D#3 F#3').concat(tonejs('violin', 'A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 C7'))
  },
  'real-violin': { cap: 6, gap: 2, lo: 55, hi: 100, src: tonejs('violin', 'A3 A4 A5 A6 C4 C5 C6 C7 E4 E5 E6 G4 G5 G6') },
  'real-cello': { cap: 6, gap: 3, lo: 36, hi: 76, src: tonejs('cello', 'C2 D#2 G2 A2 C3 D#3 F#3 A3 C4 D#4 F#4 A4 C5') },
  'real-trumpet': { cap: 4, gap: 2, lo: 52, hi: 86, src: tonejs('trumpet', 'C6 D5 D#4 F3 F4 F5 G4 A3 A5 A#4 C4') },
  'real-trombone': { cap: 4, gap: 3, lo: 34, hi: 72, src: tonejs('trombone', 'A#1 D#2 F2 G#2 A#2 C3 D#3 F3 G#3 A#3 C4 D#4 F4') },
  'real-horn': { cap: 4, gap: 2, lo: 33, hi: 84, src: tonejs('french-horn', 'A1 C2 D#2 G2 D3 F3 A3 C4 D5 F5') },
  'real-flute': { cap: 4, gap: 2, lo: 60, hi: 96, src: tonejs('flute', 'C4 E4 A4 C5 E5 A5 C6 E6 A6 C7') },
  'real-sax': { cap: 4, gap: 3, lo: 49, hi: 82, src: tonejs('saxophone', 'C#3 E3 G3 A#3 C#4 E4 G4 A#4 C#5 E5 G5') },
  'real-guitar': { cap: 4, gap: 3, lo: 40, hi: 76, src: tonejs('guitar-acoustic', 'E2 G2 A#2 C#3 E3 G3 A#3 C#4 E4 G4 A#4 C#5') },
  'real-nylon': { cap: 4, gap: 3, lo: 40, hi: 84, src: tonejs('guitar-nylon', 'E2 G#2 B2 D3 E3 G3 A3 C#4 E4 G#4 B4 C#5 E5 G5') },
  'real-ebass': { cap: 3, gap: 3, lo: 28, hi: 67, src: tonejs('bass-electric', 'E1 G1 A#1 C#2 E2 G2 A#2 C#3 E3 G3 A#3 C#4') },
  'real-upright': {
    cap: 3, gap: 2, lo: 24, hi: 67,
    src: ['c1', 'eb1', 'g1', 'bb1', 'd2', 'f2', 'a2', 'c3', 'e3', 'g3', 'a3']
      .map(n => ({ midi: midiOf(n[0].toUpperCase() + n.slice(1)), url: DANIGB + 'dsmolken/double-bass/pizz/pizz_' + n + '_mb.m4a' }))
  },
  'real-harp': { cap: 4, gap: 3, lo: 36, hi: 96, src: tonejs('harp', 'D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6') },
  'real-vibes': {
    cap: 5, gap: 2, lo: 41, hi: 89,
    src: 'F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5'.split(' ').map(n => ({ midi: midiOf(n), url: VCSL + enc(`Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_${n}_v2_rr1_Main.wav`) }))
  },
  'real-marimba': {
    cap: 2.5, gap: 2, lo: 41, hi: 96,
    src: 'F1 C2 G2 B2 F3 C4 G4 B4 F5 C6'.split(' ').map(n => ({ midi: midiOf(n), url: VCSL + enc(`Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_${n}_med_01.wav`) }))
  },
  'real-kalimba': {
    cap: 3, gap: 1, lo: 40, hi: 84,
    src: [['B2', 8], ['C#3', 7], ['D#3', 6], ['F#3', 5], ['G#3', 4], ['B3', 3], ['C#4', 2], ['D#4', 13], ['F#4', 14], ['A4', 1], ['B4', 15]]
      .map(([n, k]) => ({ midi: midiOf(n), url: VCSL + enc(`Idiophones/Plucked Idiophones/Kalimba, Kenya/Mbira6_Normal_MainSpirit_${n}_k${k}_vl3_rr2.wav`) }))
  }
};

// ── drum one-shots ───────────────────────────────────────────────────
const SP = (p) => DANIGB + 'sample-pi/drums/one-shots/' + p + '.m4a';
const VC = (p) => VCSL + enc('Idiophones/Struck Idiophones/' + p + '.wav');
const VM = (p) => VCSL + enc('Membranophones/Struck Membranophones/' + p + '.wav');
const DRUMS = {
  'kick-acoustic': [SP('kick/drum_bass_hard'), 1.2],
  'kick-heavy': [SP('kick/drum_heavy_kick'), 1.2],
  'kick-boom': [SP('kick/bd_boom'), 1.5],
  'kick-fat': [SP('kick/bd_fat'), 1.2],
  'kick-808': [SP('kick/bd_808'), 1.5],
  'kick-house': [SP('kick/bd_haus'), 1.0],
  'snare-acoustic': [SP('snare/drum_snare_hard'), 1.0],
  'snare-soft': [SP('snare/drum_snare_soft'), 1.0],
  'snare-dub': [SP('snare/sn_dub'), 1.0],
  'snare-generic': [SP('snare/sn_generic'), 1.0],
  'snare-electro': [SP('snare/elec_snare'), 0.8],
  'snare-hi': [SP('snare/elec_hi_snare'), 0.8],
  'clap-group': [VC('Claps/Clap_rr1'), 1.0],
  'clap-solo': [VC('Claps/SoloClap_vl3'), 0.8],
  'snap': [SP('percussion/perc_snap'), 0.6],
  'hat-closed': [VC('Hi-Hat Cymbal/HiHat_HitC_v3_rr1_Mid'), 0.5],
  'hat-pi': [SP('cymbal/drum_cymbal_closed'), 0.5],
  'hat-pedal': [SP('cymbal/drum_cymbal_pedal'), 0.5],
  'hat-open': [VC('Hi-Hat Cymbal/HiHat_HitO_rr1_Mid'), 1.5],
  'hat-open-pi': [SP('cymbal/drum_cymbal_open'), 1.5],
  'hat-electro': [SP('cymbal/elec_cymbal'), 1.2],
  'crash': [SP('other/drum_splash_hard'), 2.5],
  'crash-big': [VC('Suspended Cymbal 1/susCymb1_hit_f1'), 3.0],
  'tom-lo': [SP('tom/drum_tom_lo_hard'), 1.2],
  'tom-mid': [SP('tom/drum_tom_mid_hard'), 1.0],
  'tom-hi': [SP('tom/drum_tom_hi_hard'), 1.0],
  'tom-electro': [SP('electric/elec_fuzz_tom'), 0.8],
  'rim-claves': [VC('Claves/Claves1_Hit_v2_rr1_Mid'), 0.5],
  'rim-wood': [SP('electric/elec_wood'), 0.5],
  'shaker': [VC('Shaker, Small/Mid_Shaker_Slap_rr1'), 0.6],
  'tamb': [VC('Tambourine 1/Tamb1_Hit_v2_rr1_Mid'), 0.8],
  'cowbell': [VC('Cowbells/Cowbell1_Hit_v3_rr1_Mid'), 0.8],
  'conga': [VM('Conga/Conga_HitN_v2_rr1_Sum'), 0.8],
  'bongo': [VM('Bongos/BongoH_Hit1_v2_rr1_Mid'), 0.6]
};

// ── plumbing ──────────────────────────────────────────────────────────
async function download(url) {
  const file = path.join(CACHE, Buffer.from(url).toString('base64url').slice(-120));
  if (fs.existsSync(file)) return file;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return file; }
    if (r.status === 404) throw new Error('404 ' + url);
    await new Promise(res => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error('download failed ' + url);
}

/** Decode to mono float32, start trimmed to the attack, capped and faded. */
function decode(file, cap) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  let x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  // start a hair before the first sample above -40 dB of the peak
  const th = peak * 0.01;
  let s = 0; while (s < x.length && Math.abs(x[s]) < th) s++;
  s = Math.max(0, s - Math.round(RATE * 0.002));
  x = x.slice(s, Math.min(x.length, s + Math.round(cap * RATE)));
  const fade = Math.min(x.length, Math.round(RATE * 0.25));
  if (x.length >= Math.round(cap * RATE) - 1) for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
  return x;
}
const peakOf = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };

/** Pitch of the steady part (autocorrelation, parabolic peak) — just for checking names. */
function pitchOf(x) {
  const start = Math.round(RATE * 0.12), n = Math.min(8192, x.length - start);
  if (n < 2048) return null;
  const seg = x.subarray(start, start + n);
  const minLag = Math.floor(RATE / 2200), maxLag = Math.floor(RATE / 30);
  let best = -1, bestLag = 0;
  const r = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1 && lag < n / 2; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + lag < n; i++) { s += seg[i] * seg[i + lag]; e1 += seg[i] * seg[i]; e2 += seg[i + lag] * seg[i + lag]; }
    r[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
  }
  // first strong peak (avoids octave-down picks)
  const top = Math.max(...r.slice(minLag, maxLag));
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] > 0.9 * top && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { bestLag = lag; best = r[lag]; break; }
  }
  if (!bestLag) return null;
  const a = r[bestLag - 1], b = r[bestLag], c = r[bestLag + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  const f = RATE / (bestLag + shift);
  return 69 + 12 * Math.log2(f / 440);
}

function encode(x, gain, out) {
  const buf = Buffer.alloc(x.length * 4);
  for (let i = 0; i < x.length; i++) buf.writeFloatLE(Math.max(-1, Math.min(1, x[i] * gain)), i * 4);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k', out], { input: buf });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { instruments: {}, drums: {}, credits: CREDITS };
  const problems = [];

  for (const [id, spec] of Object.entries(INSTRUMENTS)) {
    const list = spread(spec.src.filter(s => s.midi != null), spec.lo, spec.hi, spec.gap);
    const decoded = [];
    for (const s of list) {
      try { decoded.push({ midi: s.midi, x: decode(await download(s.url), spec.cap) }); }
      catch (e) { problems.push(id + ': ' + e.message); }
    }
    const peak = Math.max(...decoded.map(d => peakOf(d.x)));
    const gain = 0.89 / peak;           // the instrument's loudest note peaks at −1 dBFS; the rest keep their balance
    fs.mkdirSync(path.join(OUT, id), { recursive: true });
    manifest.instruments[id] = [];
    // Some libraries name notes an octave off from MIDI's C4 = 60. When most
    // of an instrument's notes sound a whole octave from their names, shift
    // them all (inharmonic notes that defeat the pitch check go along too).
    decoded.forEach(d => { const p = pitchOf(d.x); d.off = p == null ? null : p - d.midi; });
    const octs = decoded.filter(d => d.off != null).map(d => Math.round(d.off / 12) * 12);
    const tally = {}; octs.forEach(o => { tally[o] = (tally[o] || 0) + 1; });
    const shift = +Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || 0;
    if (shift) problems.push(`${id}: named ${shift > 0 ? shift / 12 + ' octave(s) low' : -shift / 12 + ' octave(s) high'} — shifted`);
    for (const d of decoded) {
      d.midi += shift;
      const off = d.off == null ? null : d.off - shift;
      if (off != null && Math.abs(off) > 0.5) problems.push(`${id} ${d.midi}: sounds ${off.toFixed(2)} semitones off` + (Math.abs(off) > 1 ? ' — left out' : ''));
      if (off != null && Math.abs(off) > 1) continue;
      const name = String(d.midi) + '.mp3';
      encode(d.x, gain, path.join(OUT, id, name));
      manifest.instruments[id].push(d.midi);
    }
    manifest.instruments[id].sort((a, b) => a - b);
    console.log(id, manifest.instruments[id].length, 'notes');
  }

  fs.mkdirSync(path.join(OUT, 'drums'), { recursive: true });
  for (const [id, [url, cap]] of Object.entries(DRUMS)) {
    try {
      const x = decode(await download(url), cap);
      encode(x, 0.89 / peakOf(x), path.join(OUT, 'drums', id + '.mp3'));
      manifest.drums[id] = +(x.length / RATE).toFixed(2);
    } catch (e) { problems.push('drum ' + id + ': ' + e.message); }
  }
  console.log('drums', Object.keys(manifest.drums).length);

  const js = '// sample-manifest.js — GENERATED by tools/build-samples.js. Do not edit by hand.\n' +
    '// Which notes each recorded instrument has (MIDI numbers; files are samples/<id>/<midi>.mp3),\n' +
    '// the drum one-shots (samples/drums/<id>.mp3 → length in seconds), and who made them.\n' +
    'const SAMPLE_MANIFEST = ' + JSON.stringify(manifest, null, 1) + ';\n';
  fs.writeFileSync(path.join(ROOT, 'public', 'js', 'engine', 'sample-manifest.js'), js);
  let bytes = 0;
  (function walk(d) { fs.readdirSync(d).forEach(f => { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else bytes += s.size; }); })(OUT);
  console.log('total', (bytes / 1048576).toFixed(1), 'MB');
  if (problems.length) { console.log('\nCHECK:'); problems.forEach(p => console.log('  ' + p)); }
})();
