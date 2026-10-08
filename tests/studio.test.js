// studio.test.js — BHS Studio, verified in a real browser.
//
// Covers the redesign end to end: the per-track song sections (letters, bar
// mutes, solo), pattern lengths, instruments and kits, the dock (keys, pads,
// knobs, "Write notes"), recording a take, uploads with a waveform, export,
// save/load (including projects saved by the old studio), Ask Claude's action
// apply, and the MIDI keyboard. Only the USB layer of MIDI is faked; every
// byte after that goes through the real parser and routing.
//
// Run it:
//   npm install --no-save playwright      (test only — not a project dependency)
//   PORT=5199 DATA_DIR=/tmp/bhs node server.js &
//   node tests/studio.test.js
//
// If Chromium isn't where executablePath points, set CHROME_PATH.

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 5199);
const URL = BASE + '/studio.html';

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  PASS  ' + n + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + n + '  ' + extra); }
};

const FAKE_MIDI = () => {
  class FakeInput {
    constructor(id, name) { this.id = id; this.name = name; this.manufacturer = 'TestCo'; this.state = 'connected'; this.onmidimessage = null; }
    send(bytes) { if (this.onmidimessage) this.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() }); }
  }
  const inputs = new Map();
  inputs.set('in1', new FakeInput('in1', 'Fake Keys 49'));
  const access = { inputs, outputs: new Map(), onstatechange: null };
  navigator.requestMIDIAccess = async () => access;
  window.__send = (bytes) => inputs.get('in1').send(bytes);
};

/** A 1.5-second 220 Hz sine, as a 16-bit mono WAV, for the upload test. */
function sineWav(file) {
  const rate = 44100, n = Math.floor(rate * 1.5);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 12000), 44 + i * 2);
  fs.writeFileSync(file, buf);
  return buf;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(FAKE_MIDI);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  ok('start screen greets you with templates', await page.evaluate(() =>
    StartScreen.isOpen() && document.querySelectorAll('.ss-tpl').length === Templates.list().length + 1));
  await page.evaluate(() => StartScreen.choose('demo'));
  await page.waitForTimeout(150);

  // A recorder for what the sequencer plays, run offline so it's exact.
  const helpers = () => page.evaluate(() => {
    window.__events = (songMode, bars) => {
      const ev = [];
      const ac = new OfflineAudioContext(1, 4410, 44100);
      const sink = ac.createGain();
      const hit = DrumKits.hit, note = Instruments.noteOn;
      DrumKits.hit = (a, d, sound, when, vel) => { ev.push({ kind: 'drum', role: sound.role, kit: sound.kit, t: when, vel }); };
      Instruments.noteOn = (a, d, id, midi, vel, when) => { ev.push({ kind: 'note', id, midi, vel, t: when }); return note(a, d, id, midi, vel, when); };
      try {
        const p = Sequencer.createPlayer({ ac, out: () => sink });
        const stepDur = 0.1;
        for (let s = 0; s < bars * 16; s++) p.step({ time: s * stepDur, bar: Math.floor(s / 16), stepInBar: s % 16, stepDur, songMode });
      } finally { DrumKits.hit = hit; Instruments.noteOn = note; }
      return ev.map(e => Object.assign(e, { bar: Math.floor(Math.round(e.t / 0.1) / 16), step: Math.round(e.t / 0.1) % 16 }));
    };
    window.__track = (name) => Project.tracks().find(t => t.name === name);
  });
  await helpers();

  // ────────────────────────────────────────────────────────────────
  console.log('\n1. Layout — everything you need while recording is on one screen');
  const inView = await page.evaluate(() => ['#playBtn', '#arrangeGrid', '.drumgrid', '#keyboard', '#knobs'].map(sel => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.top < innerHeight;
  }));
  ok('transport, song grid, drum machine, keyboard and 808 knobs all visible at 1440×900', inView.every(Boolean), JSON.stringify(inView));
  ok('page itself does not scroll', await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2));
  ok('demo song has 8 tracks and 4 sections',
     await page.evaluate(() => Project.tracks().length === 8 && Project.sections().length === 4));

  // ────────────────────────────────────────────────────────────────
  console.log('\n2. Song mode — each instrument has its own letter, bar mutes and solo per section');
  let ev = await page.evaluate(() => window.__events(true, 24));
  const of = (role, f) => ev.filter(e => e.kind === 'drum' && e.role === role && (!f || f(e)));
  ok('intro: hats sit out bars 1–2 and come in on bar 3', of('hat', e => e.bar < 2).length === 0 && of('hat', e => e.bar >= 2 && e.bar < 4).length > 0);
  ok('intro: no kick', of('kick', e => e.bar < 4).length === 0);
  ok('verse plays kick A (no hit on step 15)', of('kick', e => e.bar >= 4 && e.bar < 12 && e.step === 14).length === 0 && of('kick', e => e.bar >= 4 && e.bar < 12).length > 0);
  ok('hook plays kick B (hit on step 15)', of('kick', e => e.bar >= 12 && e.bar < 20 && e.step === 14).length === 8);
  ok('clap only in the hook', of('clap', e => e.bar < 12 || e.bar >= 20).length === 0 && of('clap', e => e.bar >= 12 && e.bar < 20).length > 0);
  const n808 = (b) => ev.filter(e => e.kind === 'note' && e.id === '808' && e.bar === b).length;
  ok('808 drops out for the last bar of the hook only', n808(18) > 0 && n808(19) === 0, `bar18=${n808(18)} bar19=${n808(19)}`);
  const keysBar = (b) => ev.filter(e => e.kind === 'note' && e.id === 'epiano' && e.bar === b).map(e => e.midi).sort();
  ok('2-bar keys pattern: Cm on its first bar, Ab on its second', keysBar(4).join() === '60,63,67' && keysBar(5).join() === '56,60,63', keysBar(4) + ' / ' + keysBar(5));

  await page.evaluate(() => { const v = Project.sections()[1]; Project.toggleSolo(v.id, window.__track('Snare').id); });
  ev = await page.evaluate(() => window.__events(true, 24));
  const verse = ev.filter(e => e.bar >= 4 && e.bar < 12);
  ok('solo in the verse: only the snare plays there', verse.length > 0 && verse.every(e => e.kind === 'drum' && e.role === 'snare'));
  ok('…and the hook is untouched by that solo', ev.some(e => e.bar >= 12 && e.bar < 20 && e.role === 'kick'));
  await page.evaluate(() => { const v = Project.sections()[1]; Project.toggleSolo(v.id, window.__track('Snare').id); });

  await page.evaluate(() => { const v = Project.sections()[1]; const id = window.__track('Snare').id; Project.toggleBarMute(v.id, id, 2); Project.toggleBarMute(v.id, id, 3); });
  ev = await page.evaluate(() => window.__events(true, 24));
  ok('snare muted for 2 bars of the verse, then continues', of('snare', e => e.bar === 6 || e.bar === 7).length === 0 && of('snare', e => e.bar === 8).length > 0);
  await page.evaluate(() => { const v = Project.sections()[1]; const id = window.__track('Snare').id; Project.toggleBarMute(v.id, id, 2); Project.toggleBarMute(v.id, id, 3); });

  // ────────────────────────────────────────────────────────────────
  console.log('\n3. The song grid UI');
  const clapChip = 'div.arow.track:nth-child(4) .lane .sblock:nth-child(2) .chip';
  ok('clap is silent in the verse to start', (await page.textContent(clapChip)).trim() === '—');
  await page.click(clapChip);
  ok('clicking its letter brings it in on A',
     await page.evaluate(() => Project.sections()[1].cells[window.__track('Clap').id].every(v => v === 0)));
  // Drag across two bars of the kick in the verse to mute them.
  const cellsBox = await page.evaluate(() => {
    const cs = document.querySelectorAll(`.bc[data-track="${window.__track('Kick').id}"][data-sec="${Project.sections()[1].id}"]`);
    const a = cs[4].getBoundingClientRect(), b = cs[5].getBoundingClientRect();
    return { ax: a.x + a.width / 2, ay: a.y + a.height / 2, bx: b.x + b.width / 2, by: b.y + b.height / 2 };
  });
  await page.mouse.move(cellsBox.ax, cellsBox.ay);
  await page.mouse.down();
  await page.mouse.move(cellsBox.bx, cellsBox.by, { steps: 4 });
  await page.mouse.up();
  ok('dragging across two bars mutes exactly those bars',
     await page.evaluate(() => Project.sections()[1].cells[window.__track('Kick').id].join() === '0,0,0,0,-1,-1,0,0'),
     await page.evaluate(() => Project.sections()[1].cells[window.__track('Kick').id].join()));
  await page.click('[data-brush="2"]');
  await page.click(`.bc[data-track="${await page.evaluate(() => window.__track('Hi-hat').id)}"][data-sec="${await page.evaluate(() => Project.sections()[2].id)}"][data-bar="7"]`);
  ok('the C brush paints a single bar to pattern C',
     await page.evaluate(() => Project.sections()[2].cells[window.__track('Hi-hat').id][7] === 2));
  await page.click('[data-brush="mute"]');
  const nSec = await page.evaluate(() => Project.sections().length);
  await page.click('#addSectionBtn');
  ok('+ Section adds a copy of the last section',
     await page.evaluate((n) => Project.sections().length === n + 1 &&
       JSON.stringify(Object.values(Project.sections()[n].cells).map(c => c[0])) !== '[]', nSec));

  // ────────────────────────────────────────────────────────────────
  console.log('\n4. Loop-parts mode and live switching');
  ev = await page.evaluate(() => { Project.setMode('pattern'); Project.setAllLive(0); return window.__events(false, 2); });
  ok('loop mode plays every track\'s live letter', of('kick', e => e.bar === 0).map(e => e.step).join() === '0,6,10');
  await page.evaluate(() => Project.setLive(window.__track('Kick').id, 1));
  ev = await page.evaluate(() => window.__events(false, 1));
  ok('switching the kick to B adds its step-15 hit', of('kick').map(e => e.step).join() === '0,6,10,14');
  await page.evaluate(() => Project.setLive(window.__track('Kick').id, 0));

  // ────────────────────────────────────────────────────────────────
  console.log('\n5. Drum machine editor + kits');
  await page.evaluate(() => App.select(window.__track('Kick').id));
  await page.waitForTimeout(50);
  await page.click('.drow[data-id="t1"] .dcell[data-step="3"]');
  ok('clicking a step adds a kick hit', await page.evaluate(() => Project.stepInfo(Project.pattern('t1', 0)[3]).level === 2));
  await page.click('.drow[data-id="t1"] .dcell[data-step="3"]');
  ok('clicking it again removes it', await page.evaluate(() => Project.pattern('t1', 0)[3] === false));
  await page.selectOption('.ed-head select', 'boombap');
  ok('changing the kit re-voices every drum lane', await page.evaluate(() => Project.tracks().filter(t => t.kind === 'drum').every(t => t.sound.kit === 'boombap')));
  await page.selectOption('.drow[data-id="t2"] .lane-sound', 'house|snare');
  ok('one lane can borrow a sound from another kit', await page.evaluate(() => window.__track('Snare').sound.kit === 'house'));
  ev = await page.evaluate(() => window.__events(false, 1));
  ok('the sequencer uses the lane\'s own kit', ev.some(e => e.role === 'snare' && e.kit === 'house') && ev.some(e => e.role === 'kick' && e.kit === 'boombap'));
  const rendered = await page.evaluate(async () => {
    const ac = new OfflineAudioContext(1, 22050, 44100);
    const out = [];
    for (const kit of DrumKits.KIT_ORDER) for (const r of DrumKits.ROLES) {
      DrumKits.hit(ac, ac.destination, { kit, role: r.id }, 0, 1);
    }
    const b = await ac.startRendering();
    let peak = 0; b.getChannelData(0).forEach(v => { peak = Math.max(peak, Math.abs(v)); });
    return { peak, kits: DrumKits.KIT_ORDER.length };
  });
  ok('every kit × every drum sound renders audio', rendered.peak > 0.05, `peak ${rendered.peak.toFixed(2)}, ${rendered.kits} kits`);

  // ────────────────────────────────────────────────────────────────
  console.log('\n6. Instruments — add one, play it, write notes in the piano roll');
  const instPeaks = await page.evaluate(async () => {
    const out = {};
    for (const i of Instruments.list()) {
      const ac = new OfflineAudioContext(1, 44100, 44100);
      const h = Instruments.noteOn(ac, ac.destination, i.id, i.id === '808' ? 36 : 60, 0.9, 0.01);
      h.release(0.5);
      const b = await ac.startRendering();
      let p = 0; b.getChannelData(0).forEach(v => { p = Math.max(p, Math.abs(v)); });
      out[i.id] = +p.toFixed(3);
    }
    return out;
  });
  ok('all ' + Object.keys(instPeaks).length + ' instruments make sound', Object.values(instPeaks).every(p => p > 0.02), JSON.stringify(instPeaks));
  await page.click('#addTrackBtn');
  await page.click('#addMenu .menuitem:has-text("Strings")');
  await page.waitForTimeout(100);
  ok('Strings track added and selected', await page.evaluate(() => { const t = Project.track(App.selected()); return t && t.instrument === 'strings'; }));
  ok('…it has a mixer strip', await page.evaluate(() => !!Mixer.get(App.selected())));
  ok('…and the on-screen keys now play it', await page.evaluate(() => Keys.target() === App.selected()));
  ok('…with its own knobs in the dock', (await page.textContent('#knobs')).includes('Vibrato'));
  await page.evaluate(() => { window.__played = []; const o = Instruments.noteOn; Instruments.noteOn = function (...a) { window.__played.push(a[2] + ':' + a[3]); return o.apply(this, a); }; window.__restore = () => { Instruments.noteOn = o; }; });
  await page.keyboard.down('KeyQ'); await page.waitForTimeout(40); await page.keyboard.up('KeyQ');
  ok('computer key Q plays the strings', await page.evaluate(() => window.__played.some(p => p.startsWith('strings:'))), await page.evaluate(() => window.__played.join()));
  await page.evaluate(() => window.__restore());
  // piano roll: click empty to add, drag to lengthen
  const lane = await page.evaluate(() => { const r = document.querySelector('.roll-lane').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const cw = await page.evaluate(() => parseFloat(document.querySelector('.roll-inner').style.getPropertyValue('--cw')));
  await page.evaluate(() => { document.querySelector('.roll').scrollTop = 0; });
  const lane2 = await page.evaluate(() => { const r = document.querySelector('.roll-lane').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await page.mouse.move(lane2.x + cw * 2 + 3, lane2.y + 14 * 3 + 5);
  await page.mouse.down();
  await page.mouse.move(lane2.x + cw * 9 + 3, lane2.y + 14 * 3 + 5, { steps: 5 });
  await page.mouse.up();
  const notes = await page.evaluate(() => Project.pattern(App.selected(), 0));
  ok('click-drag in the piano roll adds a note from step 3 to step 10', notes.length === 1 && notes[0].s === 2 && notes[0].l === 8, JSON.stringify(notes));
  const noteBox = await page.evaluate(() => { const r = document.querySelector('.rnote').getBoundingClientRect(); return { x: r.x + 6, y: r.y + 5 }; });
  await page.mouse.click(noteBox.x, noteBox.y);
  ok('clicking the note deletes it', await page.evaluate(() => Project.pattern(App.selected(), 0).length === 0));
  await page.selectOption('#keysSound', 'flute');
  ok('the dock\'s Sound box changes the instrument', await page.evaluate(() => Project.track(App.selected()).instrument === 'flute'));

  // ────────────────────────────────────────────────────────────────
  console.log('\n7. Drum pads, and "Write notes" while it plays');
  await page.selectOption('#keysTarget', 'drums');
  ok('pads mode shows one pad per drum lane',
     await page.evaluate(() => document.querySelectorAll('.pad').length === Project.tracks().filter(t => t.kind === 'drum').length));
  await page.evaluate(() => { window.__hits = []; const o = DrumKits.hit; DrumKits.hit = function (...a) { window.__hits.push(a[2].role); return o.apply(this, a); }; window.__restore = () => { DrumKits.hit = o; }; });
  await page.click('.pad >> nth=1');
  ok('tapping a pad plays that drum', await page.evaluate(() => window.__hits.includes('snare')));
  await page.evaluate(() => window.__restore());

  await page.evaluate(() => { const k = window.__track('Keys'); Keys.setTarget(k.id); Project.setMode('pattern'); Project.clearPattern(k.id, 2); Project.setLive(k.id, 2); });
  await page.click('#recNotes');
  await page.click('#playBtn');
  await page.waitForTimeout(700);
  await page.evaluate(() => Keys.noteOn(72, 0.8));
  await page.waitForTimeout(450);
  await page.evaluate(() => Keys.noteOff(72));
  await page.waitForTimeout(100);
  const written = await page.evaluate(() => Project.pattern(window.__track('Keys').id, 2));
  ok('a note played while it runs is written into the pattern, snapped to the grid',
     written.length === 1 && written[0].m === 72 && written[0].l >= 2 && written[0].l <= 4, JSON.stringify(written));
  await page.click('#recNotes');

  // ────────────────────────────────────────────────────────────────
  console.log('\n8. Record a take from what I play — becomes an audio track');
  await page.selectOption('#recBars', '1');
  await page.selectOption('#recSource', 'keys');
  const before = await page.evaluate(() => Project.tracks().length);
  await page.click('#recBtn');
  const holdNotes = page.evaluate(async () => {
    for (let i = 0; i < 8; i++) { Keys.noteOn(60 + (i % 3) * 4, 0.9); await new Promise(r => setTimeout(r, 200)); Keys.noteOff(60 + (i % 3) * 4); }
  });
  await page.waitForFunction((n) => Project.tracks().length > n, before, { timeout: 12000 }).catch(() => {});
  await holdNotes;
  const take = await page.evaluate(() => {
    const t = Project.tracks()[Project.tracks().length - 1];
    const b = t.kind === 'audio' ? Project.getAudio(t.audioId) : null;
    let rms = 0; if (b) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) rms += d[i] * d[i]; rms = Math.sqrt(rms / d.length); }
    const st = Transport.getState();
    return { name: t.name, kind: t.kind, bars: t.bars, rms, dur: b && b.duration, barSec: st.secondsPerStep * 16, live: t.live };
  });
  ok('a "Take" audio track appears after 1 bar', take.kind === 'audio' && /^Take/.test(take.name) && take.bars === 1, JSON.stringify(take));
  ok('…its length is exactly one bar', take.dur && Math.abs(take.dur - take.barSec) < 0.01, `${take.dur && take.dur.toFixed(3)}s vs ${take.barSec.toFixed(3)}s`);
  ok('…and it captured the playing (not silence)', take.rms > 0.005, 'rms ' + (take.rms || 0).toFixed(4));
  ok('…and it shows a waveform', await page.evaluate(() => {
    const c = document.querySelector('.wave canvas'); if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let amber = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 110 && d[i + 2] < 100) amber++;
    return amber > 200;
  }));

  await page.selectOption('#recSource', 'mix');
  const before2 = await page.evaluate(() => Project.tracks().length);
  await page.click('#recBtn');
  await page.waitForFunction((n) => Project.tracks().length > n, before2, { timeout: 12000 }).catch(() => {});
  const bounce = await page.evaluate(() => { const t = Project.tracks()[Project.tracks().length - 1]; const b = Project.getAudio(t.audioId);
    let rms = 0; if (b) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) rms += d[i] * d[i]; rms = Math.sqrt(rms / d.length); }
    return { name: t.name, live: t.live, rms, status: document.getElementById('status').textContent }; });
  ok('whole-mix bounce records the beat', /^Bounce/.test(bounce.name) && bounce.rms > 0.005, JSON.stringify(bounce));
  ok('…and starts switched off so it doesn\'t double up', bounce.live === -1);
  await page.click('#playBtn');

  // ────────────────────────────────────────────────────────────────
  console.log('\n9. Upload an audio file');
  const wavPath = path.join(os.tmpdir(), 'bhs-sine.wav');
  sineWav(wavPath);
  await page.setInputFiles('#audioUpload', wavPath);
  await page.waitForFunction(() => Project.tracks().some(t => t.name === 'bhs-sine'), null, { timeout: 5000 }).catch(() => {});
  const up = await page.evaluate(() => { const t = Project.tracks().find(t => t.name === 'bhs-sine'); return t && { bars: t.bars, has: !!Project.getAudio(t.audioId) }; });
  ok('upload becomes an audio track with its audio', up && up.has && up.bars >= 1, JSON.stringify(up));
  ev = await page.evaluate(() => { Project.setMode('pattern'); return window.__events(false, 1); });
  // (audio is queued as buffer sources, not hits — check it via export below)

  // ────────────────────────────────────────────────────────────────
  console.log('\n10. Export');
  const ex = await page.evaluate(async () => {
    Project.setMode('song');
    const r = await window.__bhsRender(8, { master: false });
    const d = r.rendered.getChannelData(0);
    let rms = 0; for (let i = 0; i < d.length; i++) rms += d[i] * d[i];
    const st = Transport.getState();
    return { bars: r.totalBars, dur: r.rendered.duration, expect: Project.songBars() * st.secondsPerStep * 16 + 2, rms: Math.sqrt(rms / d.length) };
  });
  ok('song-mode export renders the whole song', ex.bars > 20 && Math.abs(ex.dur - ex.expect) < 0.05, JSON.stringify(ex));
  ok('…and it has sound', ex.rms > 0.01, 'rms ' + ex.rms.toFixed(3));
  const muteCheck = await page.evaluate(async () => {
    Project.setMode('pattern');
    Project.tracks().forEach(t => Mixer.setMuted(t.id, true));
    const r = await window.__bhsRender(2, { master: false });
    Project.tracks().forEach(t => Mixer.setMuted(t.id, false));
    let peak = 0; r.rendered.getChannelData(0).forEach(v => { peak = Math.max(peak, Math.abs(v)); });
    return peak;
  });
  ok('export respects mixer mutes (everything muted → silence)', muteCheck < 1e-4, 'peak ' + muteCheck);

  // ────────────────────────────────────────────────────────────────
  console.log('\n11. Save and open — audio included');
  const snap = await page.evaluate(() => ({ n: Project.tracks().length, audio: Project.tracks().filter(t => t.kind === 'audio').length }));
  await page.fill('#projName', 'test-redesign');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('saved', /Saved "test-redesign" with/.test(await page.textContent('#status')), await page.textContent('#status'));
  await page.evaluate(() => Project.reset());
  await page.evaluate(() => window.__bhsLoad('test-redesign'));
  await page.waitForFunction(() => /Opened/.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  const back = await page.evaluate(() => ({ n: Project.tracks().length,
    audio: Project.tracks().filter(t => t.kind === 'audio' && Project.getAudio(t.audioId)).length }));
  ok('every track comes back, with every clip\'s audio', back.n === snap.n && back.audio === snap.audio, JSON.stringify({ snap, back }));

  // An old-studio (v2) project, with one recorded loop.
  const v2 = {
    savedAt: '2026-01-01', bpm: 120, version: 2,
    bass: { current: 1, banks: [[{ midi: 36, slide: false }, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
                                [null, null, { midi: 40, slide: false }, { midi: 43, slide: true }, null, null, null, null, null, null, null, null, null, null, null, null], null, null] },
    drumParts: [0, 1, 2, 3, 4, 5].map(i => ({ current: 0, banks: [Array.from({ length: 16 }, (_, s) => s % (i + 2) === 0), null, null, null] })),
    drumsMuted: [false, false, false, false, false, false],
    voice: { drive: 12 },
    song: { blocks: [{ v: 0, bars: 2 }, { v: 1, bars: 3 }], enabled: true },
    mixer: { master: 0.9, tracks: { 'drum:0': { volume: 0.4, pan: 0, muted: false, soloed: false, reverb: 0, delay: 0 } } },
    loops: [{ index: 0, bars: 1, volume: 0.9 }]
  };
  await page.evaluate(async (d) => {
    await fetch('/api/projects/old-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: d }) });
  }, v2);
  const wav = fs.readFileSync(wavPath);
  await page.evaluate(async (bytes) => {
    await fetch('/api/projects/old-v2/audio/0', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: new Uint8Array(bytes) });
  }, Array.from(wav));
  await page.evaluate(() => window.__bhsLoad('old-v2'));
  await page.waitForFunction(() => /Opened "old-v2"/.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  const mig = await page.evaluate(() => ({
    ids: Project.tracks().map(t => t.id).join(),
    bpm: Project.bpm(), mode: Project.mode(),
    secs: Project.sections().map(s => s.bars + ':' + s.cells['drum:0'][0]).join(),
    bass: Project.pattern('bass', 1), live: Project.track('bass').live, drive: Project.track('bass').params.drive,
    kit: Project.track('drum:0').sound.kit, vol: Mixer.get('drum:0').volume, loop: !!Project.getAudio(0)
  }));
  ok('old project: 6 drum lanes, the 808 and the loop', mig.ids === 'drum:0,drum:1,drum:2,drum:3,drum:4,drum:5,bass,loop:0', mig.ids);
  ok('old project: tempo, song mode and sections carried over', mig.bpm === 120 && mig.mode === 'song' && mig.secs === '2:0,3:1', JSON.stringify(mig));
  ok('old project: 808 patterns (incl. slide), sound and faders carried over',
     mig.bass.length === 2 && mig.bass[1].sl === true && mig.live === 1 && mig.drive === 12 && mig.kit === 'classic' && Math.abs(mig.vol - 0.4) < 1e-6, JSON.stringify(mig));
  ok('old project: recorded loop audio restored', mig.loop);

  // ────────────────────────────────────────────────────────────────
  console.log('\n12. Ask Claude — its actions apply through the same code as the buttons');
  await page.evaluate(() => { Project.reset(); });
  const done = await page.evaluate(() => window.__bhsApplyClaude([
    { name: 'add_instrument', input: { instrument: 'strings', name: 'Strings', bars: 2 } },
    { name: 'set_notes', input: { track: 'Strings', variation: 'A', notes: [{ step: 0, midi: 60, length: 32, slide: false }, { step: 0, midi: 63, length: 32, slide: false }] } },
    { name: 'set_drum_pattern', input: { track: 'Hi-hat', variation: 'C', steps: Array.from({ length: 16 }, () => true) } },
    { name: 'set_arrangement', input: { play_song: true, sections: [
      { name: 'Intro', bars: 4, tracks: [{ track: 'Strings', variation: 'A', muted_bars: [], solo: false }] },
      { name: 'Drop', bars: 8, tracks: [
        { track: 'Kick', variation: 'B', muted_bars: [], solo: false },
        { track: 'Hi-hat', variation: 'C', muted_bars: [], solo: false },
        { track: 'Snare', variation: 'A', muted_bars: [7, 8], solo: false },
        { track: '808', variation: 'A', muted_bars: [], solo: false }] }] } },
    { name: 'set_sound_param', input: { track: '808', param: 'drive', value: 99 } },
    { name: 'set_tempo', input: { bpm: 140 } }
  ]));
  const cl = await page.evaluate(() => {
    const s = Project.sections(); const id = (n) => window.__track(n).id;
    return {
      n: s.length, mode: Project.mode(), bpm: Project.bpm(),
      introStrings: s[0].cells[id('Strings')].join(), introKick: s[0].cells[id('Kick')].join(),
      dropSnare: s[1].cells[id('Snare')].join(), dropHat: s[1].cells[id('Hi-hat')][0],
      drive: window.__track('808').params.drive
    };
  });
  ok('actions applied', done.length === 6, done.join(' | '));
  ok('new instrument, its notes, and a new hat pattern', await page.evaluate(() => window.__track('Strings').patterns[0].length === 2 && window.__track('Hi-hat').patterns[2].every(Boolean)));
  ok('arrangement: listed tracks play, unlisted are silent, muted bars honoured',
     cl.n === 2 && cl.introStrings === '0,0,0,0' && cl.introKick === '-1,-1,-1,-1' && cl.dropSnare === '0,0,0,0,0,0,-1,-1' && cl.dropHat === 2, JSON.stringify(cl));
  ok('values are clamped (drive 99 → 20) and song mode is on', cl.drive === 20 && cl.mode === 'song' && cl.bpm === 140, JSON.stringify(cl));

  // ────────────────────────────────────────────────────────────────
  console.log('\n13. MIDI keyboard');
  await page.evaluate(() => { Project.reset(); Keys.setTarget(window.__track('808').id); });
  await page.click('#midiBtn');
  await page.click('#midiConnect');
  await page.waitForTimeout(200);
  ok('connects and names the device', /Fake Keys 49/.test(await page.textContent('#midiDevices')));
  await page.evaluate(() => { window.__mn = []; const o = Instruments.noteOn; Instruments.noteOn = function (...a) { window.__mn.push({ id: a[2], midi: a[3], vel: a[4] }); return o.apply(this, a); }; });
  await page.evaluate(() => window.__send([0x90, 36, 100]));
  await page.waitForTimeout(50);
  ok('a MIDI note plays the dock\'s instrument and lights the key',
     await page.evaluate(() => window.__mn.some(n => n.id === '808' && n.midi === 36) && document.querySelector('.key[data-midi="36"]').classList.contains('down')));
  await page.evaluate(() => window.__send([0x90, 36, 0]));
  await page.waitForTimeout(50);
  ok('velocity-0 note-on releases it', await page.evaluate(() => !document.querySelector('.key[data-midi="36"]').classList.contains('down')));
  await page.evaluate(() => { window.__mn = []; window.__send([0x90, 40, 127]); window.__send([0x80, 40, 0]); window.__send([0x90, 41, 20]); window.__send([0x80, 41, 0]); });
  await page.waitForTimeout(50);
  const mv = await page.evaluate(() => window.__mn.map(n => n.vel));
  ok('velocity reaches the instrument', mv.length === 2 && mv[0] > mv[1], JSON.stringify(mv));
  await page.selectOption('#midiChannel', '1');
  await page.evaluate(() => { window.__mn = []; window.__send([0x99, 45, 100]); });
  await page.waitForTimeout(40);
  ok('channel filter ignores other channels', await page.evaluate(() => window.__mn.length === 0));
  await page.selectOption('#midiChannel', '0');
  await page.selectOption('#midiTarget', 'drums');
  await page.evaluate(() => { window.__mh = []; const o = DrumKits.hit; DrumKits.hit = function (...a) { window.__mh.push(a[2].role); return o.apply(this, a); }; });
  await page.evaluate(() => { window.__send([0x99, 36, 100]); window.__send([0x99, 38, 100]); window.__send([0x99, 42, 100]); });
  await page.waitForTimeout(50);
  ok('drum target maps General MIDI notes to the right lanes', await page.evaluate(() => window.__mh.join() === 'kick,snare,hat'), await page.evaluate(() => window.__mh.join()));
  await page.selectOption('#midiTarget', 'dock');

  // ────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────
  console.log('\n13b. Accents, rolls and swing');
  ev = await page.evaluate(() => {
    Project.reset(); Project.setMode('pattern');
    const h = window.__track('Hi-hat');
    const p = new Array(16).fill(false); p[0] = 3; p[2] = 1; p[4] = 32; p[8] = 42; p[12] = 2;
    Project.setPatternSteps(h.id, 0, p);
    return window.__events(false, 1).filter(e => e.role === 'hat');
  });
  ok('an accent is louder than a normal hit, a ghost note softer',
     ev.find(e => Math.abs(e.t) < 1e-9).vel > ev.find(e => Math.abs(e.t - 1.2) < 1e-9).vel &&
     ev.find(e => Math.abs(e.t - 0.2) < 1e-9).vel < 1, JSON.stringify(ev.slice(0, 3).map(e => e.vel)));
  const rollTimes = (from) => ev.filter(e => e.t >= from - 1e-9 && e.t < from + 0.1 - 1e-9).map(e => +e.t.toFixed(4));
  ok('a ×3 roll plays three hits inside its sixteenth', rollTimes(0.4).join() === '0.4,0.4333,0.4667', rollTimes(0.4).join());
  ok('a ×4 roll plays four', rollTimes(0.8).length === 4);
  ev = await page.evaluate(() => {
    const h = window.__track('Hi-hat');
    const p = new Array(16).fill(false); p[0] = 2; p[1] = 2; p[2] = 2; p[3] = 2;
    Project.setPatternSteps(h.id, 0, p);
    Project.setSwing(0.3);
    const r = window.__events(false, 1).filter(e => e.role === 'hat').map(e => +e.t.toFixed(4));
    Project.setSwing(0);
    return r;
  });
  ok('swing pushes every second sixteenth late (30% → 0.03s at 0.1s steps)', ev.join() === '0,0.13,0.2,0.33', ev.join());
  await page.evaluate(() => App.select(window.__track('Hi-hat').id));
  await page.waitForTimeout(80);
  await page.click('.dbrush:has-text("Roll ×3")');
  await page.click(`.drow[data-id="${await page.evaluate(() => window.__track('Hi-hat').id)}"] .dcell[data-step="7"]`);
  ok('the Roll ×3 brush places a triplet roll, shown as ×3',
     await page.evaluate(() => { const t = window.__track('Hi-hat'); return Project.stepInfo(Project.pattern(t.id, t.edit)[7]).roll === 3 &&
       document.querySelector(`.drow[data-id="${t.id}"] .dcell[data-step="7"]`).textContent === '×3'; }));
  await page.click('.dbrush:has-text("Hit")');

  // ────────────────────────────────────────────────────────────────
  console.log('\n13c. Undo and redo');
  await page.evaluate(() => { Mixer.setVolume(window.__track('Kick').id, 0.5); App.select(window.__track('Kick').id); });
  await page.waitForTimeout(400);
  await page.click(`.drow[data-id="${await page.evaluate(() => window.__track('Kick').id)}"] .dcell[data-step="5"]`);
  await page.waitForTimeout(400);
  ok('step placed', await page.evaluate(() => !!Project.pattern(window.__track('Kick').id, 0)[5]));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  ok('Ctrl+Z takes it back', await page.evaluate(() => !Project.pattern(window.__track('Kick').id, 0)[5]));
  ok('…without touching the mixer', await page.evaluate(() => Math.abs(Mixer.get(window.__track('Kick').id).volume - 0.5) < 1e-6));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  ok('Ctrl+Shift+Z puts it back', await page.evaluate(() => !!Project.pattern(window.__track('Kick').id, 0)[5]));
  await page.evaluate(() => { Project.removeTrack(window.__track('Clap').id); });
  await page.waitForTimeout(400);
  await page.click('#undoBtn');
  await page.waitForTimeout(100);
  ok('undo brings back a deleted track, with its mixer strip', await page.evaluate(() => !!window.__track('Clap') && !!Mixer.get(window.__track('Clap').id)));

  // ────────────────────────────────────────────────────────────────
  console.log('\n13d. Key highlight and chord helper');
  await page.evaluate(() => { Project.setKey({ root: 0, scale: 'minor' }); App.select(window.__track('Keys').id); Project.setLive(window.__track('Keys').id, 3); Project.clearPattern(window.__track('Keys').id, 3); });
  await page.waitForTimeout(100);
  ok('rows in C minor are lit, others dimmed', await page.evaluate(() =>
    document.querySelectorAll('.rrow.inkey').length > 0 && document.querySelectorAll('.rrow.outkey').length > 0));
  await page.click('.chordbtn');
  const rowY = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.rrow')];
    const c = rows.find(r => r.querySelector('.rkey').title === 'C4');
    c.scrollIntoView({ block: 'center' });
    const lane = document.querySelector('.roll-lane').getBoundingClientRect();
    const r = c.getBoundingClientRect();
    return { x: lane.x + 5, y: r.y + r.height / 2 };
  });
  await page.mouse.click(rowY.x, rowY.y);
  const chord = await page.evaluate(() => Project.pattern(window.__track('Keys').id, 3).map(n => n.m).sort((a, b) => a - b));
  ok('with Chords on, clicking C4 in C minor places C–E♭–G', chord.join() === '60,63,67', chord.join());
  await page.click('.chordbtn');

  // ────────────────────────────────────────────────────────────────
  console.log('\n13e. Pump and metronome');
  const pumps = await page.evaluate(() => {
    Project.setMode('pattern'); Project.setAllLive(0);
    Project.setPump(window.__track('Keys').id, 0.6);
    const ac = new OfflineAudioContext(1, 4410, 44100);
    const calls = [];
    const fake = { gain: { setTargetAtTime: (v, t) => calls.push([+v.toFixed(2), t]) } };
    const p = Sequencer.createPlayer({ ac, out: () => ac.destination, duck: (id) => (id === window.__track('Keys').id ? fake : null) });
    for (let s = 0; s < 16; s++) p.step({ time: s * 0.1, bar: 0, stepInBar: s, stepDur: 0.1, songMode: false });
    return calls;
  });
  ok('every kick ducks a pumped track and lets it back up', pumps.length >= 6 && pumps.length % 2 === 0 && pumps.every((c, i) => c[0] === (i % 2 ? 1 : 0.4)), JSON.stringify(pumps));
  const pumpedRender = await page.evaluate(async () => {
    const r = await window.__bhsRender(1, { master: false });
    return r.rendered.duration > 0;
  });
  ok('export renders with pump on', pumpedRender);
  await page.evaluate(() => Project.setPump(window.__track('Keys').id, 0));

  await page.evaluate(() => { window.__clicks = []; const o = Sequencer.click; Sequencer.click = (t, d) => { window.__clicks.push([t, d]); return o(t, d); }; });
  await page.click('#clickBtn');
  await page.click('#playBtn');
  await page.waitForTimeout(1500);
  await page.click('#playBtn');
  await page.click('#clickBtn');
  ok('Click plays the metronome on the beats, accent on the downbeat', await page.evaluate(() =>
    window.__clicks.length >= 2 && window.__clicks[0][1] === true && window.__clicks.slice(1, 4).every(c => c[1] === false)), await page.evaluate(() => window.__clicks.length));
  await page.evaluate(() => { window.__clicks = []; });
  await page.selectOption('#recSource', 'keys');
  await page.selectOption('#recBars', '1');
  const nBefore = await page.evaluate(() => Project.tracks().length);
  await page.click('#recBtn');
  await page.waitForTimeout(100);
  const ci = await page.evaluate(() => ({ clicks: window.__clicks.map(c => c[0]), playing: Transport.isPlaying, label: document.getElementById('recBtn').textContent }));
  ok('recording from stop counts in one bar of clicks first', ci.clicks.length === 4 && /1 · 2/.test(ci.label), JSON.stringify(ci));
  await page.waitForFunction((n) => Project.tracks().length > n, nBefore, { timeout: 25000 }).catch(() => {});
  ok('…then the take starts on the downbeat and lasts one bar', await page.evaluate(() => {
    const t = Project.tracks()[Project.tracks().length - 1];
    const b = t.kind === 'audio' && Project.getAudio(t.audioId);
    const st = Transport.getState();
    return !!b && Math.abs(b.duration - st.secondsPerStep * 16) < 0.01;
  }), await page.evaluate(() => { const t = Project.tracks()[Project.tracks().length - 1];
    return t.name + ' | ' + document.getElementById('status').textContent + ' | rec=' + Recorder.getState(); }));
  if (await page.evaluate(() => Transport.isPlaying)) await page.click('#playBtn');

  // ────────────────────────────────────────────────────────────────
  console.log('\n13f. Templates');
  const tpl = await page.evaluate(async () => {
    const out = {};
    for (const t of Templates.list()) {
      Project.restore(Templates.build(t.id));
      Project.setMode('pattern');
      const r = await window.__bhsRender(2, { master: false });
      let rms = 0; const d = r.rendered.getChannelData(0); for (let i = 0; i < d.length; i++) rms += d[i] * d[i];
      out[t.id] = { rms: +Math.sqrt(rms / d.length).toFixed(3), tracks: Project.tracks().length, secs: Project.sections().length, bpm: Project.bpm() };
    }
    return out;
  });
  ok('every template builds and makes sound (blank is silent)',
     Object.entries(tpl).every(([id, v]) => id === 'blank' ? v.rms === 0 : v.rms > 0.01), JSON.stringify(tpl));
  await page.evaluate(() => StartScreen.show(true));
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('.ss-tpl[data-id="trap"]');
  await page.waitForTimeout(150);
  ok('choosing Trap on the start screen loads it in song mode with hi-hat rolls', await page.evaluate(() =>
    !StartScreen.isOpen() && Project.bpm() === 140 && Project.mode() === 'song' &&
    window.__track('Hi-hat').patterns[1].some(v => Project.stepInfo(v) && Project.stepInfo(v).roll > 1)));

  // ────────────────────────────────────────────────────────────────
  console.log('\n13g. Autosave — close the tab, come back, carry on');
  await page.setInputFiles('#audioUpload', path.join(os.tmpdir(), 'bhs-sine.wav'));
  await page.waitForFunction(() => Project.tracks().some(t => t.name === 'bhs-sine'), null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { Project.renameTrack(window.__track('Pluck').id, 'Lead line'); Project.setSwing(0.21); });
  await page.waitForTimeout(1800);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  ok('start screen offers "Continue where you left off"', await page.evaluate(() =>
    StartScreen.isOpen() && !document.getElementById('ssContinue').hidden && /Continue/.test(document.getElementById('ssContinue').textContent)));
  await page.click('#ssContinue');
  await page.waitForTimeout(600);
  await helpers();
  ok('the song comes back exactly — renamed track, swing, template', await page.evaluate(() =>
    !!window.__track('Lead line') && Math.abs(Project.swing() - 0.21) < 1e-9 && Project.bpm() === 140));
  ok('…including the uploaded audio', await page.evaluate(() => { const t = window.__track('bhs-sine'); return !!t && !!Project.getAudio(t.audioId); }));

  console.log('\n14. Other pages, and browsers without MIDI');
  const p2 = await browser.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  const resp = await p2.goto(BASE + '/practice.html', { waitUntil: 'load' });
  await p2.waitForTimeout(300);
  ok('Practice Mode still loads cleanly', resp.status() === 200 && errs2.length === 0, errs2.join('; '));
  await p2.close();
  const p3 = await browser.newPage();
  await p3.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { value: undefined, configurable: true }); });
  await p3.goto(URL, { waitUntil: 'load' });
  await p3.waitForTimeout(300);
  ok('no-MIDI browser disables Connect with an explanation',
     (await p3.isDisabled('#midiConnect')) && /Safari/.test(await p3.evaluate(() => document.getElementById('midiStatus').textContent)));
  await p3.close();
  const p5 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs5 = [];
  p5.on('pageerror', e => errs5.push(e.message));
  await p5.goto(URL, { waitUntil: 'load' });
  await p5.waitForTimeout(300);
  ok('phone width loads without errors or sideways page scroll',
     errs5.length === 0 && await p5.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), errs5.join('; '));
  await p5.close();

  console.log('\n14b. Installable app');
  const pwa = await page.evaluate(async () => {
    const m = await (await fetch('/manifest.webmanifest')).json();
    const reg = await navigator.serviceWorker.getRegistration();
    return { name: m.name, display: m.display, icons: m.icons.length, sw: !!reg };
  });
  ok('manifest + service worker in place (installs to the home screen, opens offline)',
     pwa.name === 'Rhythm Shop' && pwa.display === 'standalone' && pwa.icons >= 3 && pwa.sw, JSON.stringify(pwa));

  console.log('\n15. No page errors throughout');
  ok('clean console', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
