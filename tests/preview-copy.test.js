// preview-copy.test.js — the ▶ "hear it first" buttons, copying a pattern to another instrument,
// and transposing the notes of one bar (or all of them).
//
//   npm install --no-save playwright
//   node tests/preview-copy.test.js        (starts its own server)

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  PASS  ' + n + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + n + '  ' + extra); }
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { env: Object.assign({}, process.env, { PORT: '5303', DATA_DIR: dir, APP_PASSWORD: '' }), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5303/studio.html');
    await page.waitForSelector('.ss-tpl');
    await page.evaluate(() => StartScreen.choose('trap'));
    await page.waitForTimeout(300);

    // Count what actually gets played, without touching the song.
    await page.evaluate(() => {
      window.__heard = { drums: [], notes: [] };
      const hit = DrumKits.hit, noteOn = Instruments.noteOn;
      DrumKits.hit = function (ac, dest, sound) { window.__heard.drums.push(sound.kit + '|' + sound.role); return hit.apply(this, arguments); };
      Instruments.noteOn = function (ac, dest, id) { window.__heard.notes.push(id); return noteOn.apply(this, arguments); };
    });
    const tracksNow = () => page.evaluate(() => Project.tracks().length);
    const heard = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__heard)));

    // ── + Add instrument ──
    console.log('Hear it first');
    const before = await tracksNow();
    await page.click('#addTrackBtn');
    const drumRows = page.locator('#addMenu .menurow');
    ok('Add menu rows have a ▶', (await drumRows.count()) >= 10, String(await drumRows.count()));
    await page.locator('#addMenu .menurow', { hasText: 'Tom' }).locator('.pv').click();
    await page.waitForTimeout(400);
    let h = await heard();
    ok('Drum ▶ plays that drum', h.drums.some(d => /\|tom$/.test(d)), JSON.stringify(h.drums));
    ok('...without adding a lane', (await tracksNow()) === before);
    ok('...and the menu stays open', await page.locator('#addMenu').isVisible());

    await page.locator('#addMenu .submenu', { hasText: 'Synth keys' }).click();
    await page.waitForSelector('#addMenu .menurow');
    await page.locator('#addMenu .menurow', { hasText: 'Organ' }).locator('.pv').click();
    await page.waitForTimeout(500);
    h = await heard();
    ok('Instrument ▶ plays a chord (3 notes) of that instrument', h.notes.filter(n => n === 'organ').length === 3, JSON.stringify(h.notes));
    ok('...still nothing added', (await tracksNow()) === before);
    await page.locator('#addMenu .menurow', { hasText: 'Organ' }).locator('.menuitem').click();
    await page.waitForTimeout(200);
    ok('Choosing the name still adds it', (await tracksNow()) === before + 1);

    // A recorded instrument downloads first, then plays the real sound.
    const real = await page.evaluate(() => Instruments.list().find(i => i.id === 'real-piano') ? 'real-piano' : null);
    const t0 = Date.now();
    const played = await page.evaluate(async () => { window.__heard.notes.length = 0; return await Preview.play({ instrument: 'real-piano' }); });
    ok('Recorded instrument previews', played === true && (await page.evaluate(() => Samples.instrumentReady('real-piano'))), (Date.now() - t0) + ' ms');

    // A long library loop is cut short.
    const loopId = await page.evaluate(() => { const l = DrumKits.library().flatMap(g => g.items).find(i => i.loop); return l && l.id; });
    if (loopId) {
      const cut = await page.evaluate(async (id) => {
        const ac = App.ensureAudio(); let stopAt = null;
        const mk = ac.createBufferSource.bind(ac);
        ac.createBufferSource = () => { const s = mk(); const st = s.stop.bind(s); s.stop = (t) => { stopAt = t - ac.currentTime; return st(t); }; return s; };
        await Preview.play({ sound: { kit: 'lib', role: id } });
        ac.createBufferSource = mk;
        return stopAt;
      }, loopId);
      ok('A loop preview stops by itself within ~3.5 s', cut != null && cut < 3.6, String(cut));
    }
    await page.keyboard.press('Escape');

    // ── ▶ beside the sound boxes ──
    await page.evaluate(() => App.select('t2'));       // show the drum machine
    await page.waitForSelector('.drow[data-id="t2"]');
    const lane = page.locator('.drow[data-id="t2"]');
    ok('Drum lane has a ▶ by its sound box', (await lane.locator('.lane-wrap .pv').count()) === 1);
    const soundBefore = await page.evaluate(() => JSON.stringify(Project.track('t2').sound));
    await page.evaluate(() => { window.__heard.drums.length = 0; });
    await lane.locator('.pv').click();
    await page.waitForTimeout(300);
    h = await heard();
    ok('Lane ▶ plays the lane\'s sound and changes nothing', h.drums.length >= 1 && (await page.evaluate(() => JSON.stringify(Project.track('t2').sound))) === soundBefore, JSON.stringify(h.drums));

    // pick a different sound in the box, ▶ plays the box value
    await page.selectOption('.drow[data-id="t2"] .lane-sound', 'house|snare');
    await page.evaluate(() => { window.__heard.drums.length = 0; });
    await lane.locator('.pv').click();
    await page.waitForTimeout(300);
    h = await heard();
    ok('▶ follows the box', h.drums.includes('house|snare'), JSON.stringify(h.drums));

    const hasPads = await page.evaluate(() => !!document.querySelector('#padRoom'));
    if (hasPads) {
      ok('Each pad has a ▶', (await page.locator('#padRoom .padcell .padunder .pv').count()) === (await page.locator('#padRoom .padcell').count()));
    }
    await page.evaluate(() => App.select(Project.tracks().find(t => t.kind === 'synth').id));
    await page.waitForTimeout(200);
    ok('Keyboard dock has a ▶ by Sound', (await page.locator('#soundField .pv').count()) === 1);
    ok('Piano roll has a ▶ by Sound', (await page.locator('#editor .ed-head .pv').count()) >= 1);

    // ── copy to another instrument ──
    console.log('Copy to another instrument');
    const r = await page.evaluate(() => {
      const syn = Project.tracks().filter(t => t.kind === 'synth');
      const a = syn[0], b = syn[1], drums = Project.tracks().filter(t => t.kind === 'drum');
      Project.setNotes(a.id, 0, [{ s: 0, m: 60, l: 2 }, { s: 8, m: 64, l: 4 }, { s: 40, m: 67, l: 4 }]);
      const aBefore = JSON.stringify(a.patterns[0]);
      const ok1 = Project.copyPatternTo(a.id, 0, b.id, 2);
      const copied = JSON.parse(JSON.stringify(b.patterns[2]));
      const mismatch = Project.copyPatternTo(a.id, 0, drums[0].id, 0);
      const same = Project.copyPatternTo(a.id, 0, a.id, 1);
      Project.setPatternSteps(drums[0].id, 1, [true, false, false, false]);
      const d1 = Project.copyPatternTo(drums[0].id, 1, drums[1].id, 3);
      const dsteps = drums[1].patterns[3].slice(0, 4).map(x => !!x);
      return { ok1, copied, mismatch, same, d1, dsteps, aBars: a.bars, bBars: b.bars, aStill: JSON.stringify(a.patterns[0]) === aBefore };
    });
    ok('Piano roll -> another instrument', r.ok1 && r.copied.length >= 2 && r.copied[0].m === 60, JSON.stringify(r.copied));
    ok('Notes past the end of a shorter target are dropped', r.aBars === r.bBars || r.copied.every(n => n.s < r.bBars * 16));
    ok('The source is untouched', r.aStill === true);
    ok('A drum pattern will not go onto an instrument (or onto itself)', r.mismatch === false && r.same === false);
    ok('Drum lane -> another drum lane', r.d1 === true && r.dsteps[0] === true);

    // locks: a locked row in the target is never overwritten
    const lk = await page.evaluate(() => {
      const syn = Project.tracks().filter(t => t.kind === 'synth');
      const a = syn[0], b = syn[1];
      Project.setNotes(a.id, 3, [{ s: 0, m: 60, l: 2 }, { s: 4, m: 62, l: 2 }]);
      Project.setNotes(b.id, 3, [{ s: 0, m: 70, l: 2 }]);
      Project.toggleRowLock(b.id, 60);
      Project.copyPatternTo(a.id, 3, b.id, 3);
      const out = b.patterns[3].map(n => n.m).sort((x, y) => x - y);
      Project.toggleRowLock(b.id, 60);
      return out;
    });
    ok('A locked row in the target keeps out the copy', !lk.includes(60) && lk.includes(62), JSON.stringify(lk));

    // the real menus
    await page.evaluate(() => { const a = Project.tracks().find(t => t.kind === 'synth'); App.select(a.id); });
    await page.waitForTimeout(250);
    await page.locator('#editor .ed-head button', { hasText: 'Copy to…' }).first().click();
    await page.locator('#trackMenu .submenu', { hasText: 'another instrument' }).click();
    const targetName = await page.evaluate(() => Project.tracks().filter(t => t.kind === 'synth')[1].name);
    await page.locator('#trackMenu .submenu', { hasText: targetName }).click();
    const letterBtn = page.locator('#trackMenu .menuitem', { hasText: /^B/ });
    ok('Letters show whether they are empty or would be replaced', /empty|replaced/.test(await letterBtn.textContent()));
    await letterBtn.click();
    const via = await page.evaluate(() => {
      const syn = Project.tracks().filter(t => t.kind === 'synth');
      return { src: JSON.stringify(syn[0].patterns[syn[0].edit].map(n => [n.s, n.m])), dst: JSON.stringify(syn[1].patterns[1].map(n => [n.s, n.m])) };
    });
    ok('Menu path copies the pattern', via.src === via.dst && via.src !== '[]', via.dst);

    // drum lane menu
    await page.evaluate(() => App.select(Project.tracks().find(t => t.kind === 'drum').id));
    await page.waitForTimeout(250);
    await page.locator('#editor .ed-head button', { hasText: 'Copy lane to…' }).click();
    ok('Drum machine has Copy lane to… with another-lane option', await page.locator('#trackMenu .submenu', { hasText: 'another drum lane' }).count() === 1);
    await page.keyboard.press('Escape');

    // ── transpose ──
    console.log('Transpose');
    const tr = await page.evaluate(() => {
      const a = Project.addTrack({ kind: 'synth', name: 'Tr', instrument: 'piano', bars: 4 });
      window.__trId = a.id;
      Project.setNotes(a.id, 0, [{ s: 2, m: 60, l: 2 }, { s: 6, m: 64, l: 4, vel: 0.5 }, { s: 20, m: 67, l: 2 }, { s: 40, m: 72, l: 2 }]);
      const mine = (v = 0) => Project.track(a.id).patterns[v].map(n => n.s + ':' + n.m).sort().join(' ');
      const start = mine();
      const bar1 = Project.transposeNotes(a.id, 0, 0, 16, -12);
      const afterBar1 = mine();
      const vel = Project.track(a.id).patterns[0].find(n => n.s === 6).vel;
      Project.transposeNotes(a.id, 0, 0, 16, 12);
      const roundTrip = mine() === start;
      const all = Project.transposeNotes(a.id, 0, 0, a.bars * 16, 2);
      const afterAll = mine();
      Project.transposeNotes(a.id, 0, 0, a.bars * 16, -2);
      Project.toggleNoteLock(a.id, 0, 2, 60);
      const lockedRun = Project.transposeNotes(a.id, 0, 0, 16, -12);
      const lockedState = mine();
      Project.toggleNoteLock(a.id, 0, 2, 60);
      Project.transposeNotes(a.id, 0, 0, 16, 12);          // put bar 1 back (the 64 note moved down above)
      Project.setNotes(a.id, 1, [{ s: 0, m: 126, l: 2 }]);
      const off = Project.transposeNotes(a.id, 1, 0, 16, 12);
      return { start, bar1, afterBar1, vel, roundTrip, all, afterAll, lockedRun, lockedState, off };
    });
    ok('One bar moves down an octave, the others stay', tr.bar1.moved === 2 && tr.afterBar1 === '20:67 2:48 40:72 6:52', tr.afterBar1);
    ok('A moved note keeps its volume', tr.vel === 0.5);
    ok('Down then up is a round trip', tr.roundTrip === true);
    ok('Whole pattern, up a whole step', tr.all.moved === 4 && tr.afterAll === '20:69 2:62 40:74 6:66', tr.afterAll);
    ok('A locked note stays put', tr.lockedRun.skippedLocked === 1 && /2:60/.test(tr.lockedState), tr.lockedState);
    ok('Notes that would leave the keyboard stay', tr.off.moved === 0 && tr.off.skippedRange === 1);

    await page.evaluate(() => { Project.setLive(window.__trId, 0); App.select(window.__trId); });
    await page.waitForTimeout(250);
    const notesIn = (lo, hi) => page.evaluate(([id, lo, hi]) => Project.track(id).patterns[0].filter(n => n.s >= lo && n.s < hi).map(n => n.m).sort((x, y) => x - y), [window.__trId || null, lo, hi]);
    const id = await page.evaluate(() => window.__trId);
    const grab = (lo, hi) => page.evaluate(([id, lo, hi]) => Project.track(id).patterns[0].filter(n => n.s >= lo && n.s < hi).map(n => n.m).sort((x, y) => x - y), [id, lo, hi]);
    const b1 = await grab(0, 16), b2 = await grab(16, 32);
    await page.locator('#editor .ed-head button', { hasText: 'Transpose…' }).click();
    await page.locator('#trackMenu .submenu', { hasText: 'Bar 1 only' }).click();
    await page.locator('#trackMenu .menuitem', { hasText: 'Down an octave' }).click();
    const a1 = await grab(0, 16), a2 = await grab(16, 32);
    ok('The menu path works (Transpose… > Bar 1 only > Down an octave)',
      JSON.stringify(a1) === JSON.stringify(b1.map(m => m - 12)) && JSON.stringify(a2) === JSON.stringify(b2), JSON.stringify([b1, a1, b2, a2]));

    ok('No page errors', errors.length === 0, errors.join(' | '));
  } catch (e) {
    fail++; console.log('  FAIL  crashed: ' + (e.stack || e));
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
