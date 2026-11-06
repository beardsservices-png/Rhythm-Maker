// song-file.test.js — "Open a song file" (sheet music / MIDI) and the password.
//
// Run it (needs: npm install --no-save playwright):
//   node tests/song-file.test.js
// It starts two servers of its own: one open (as before), one with APP_PASSWORD set.
//
// Fixtures: chorale.musicxml / chorale.mxl = Bach BWV 244.54 (public domain,
// music21 corpus); band.mid = a made-up 8-bar bass / piano / drums loop.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  PASS  ' + n + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + n + '  ' + extra); }
};

function startServer(port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, APP_PASSWORD: '' }, env), stdio: 'ignore' });
  return new Promise(res => setTimeout(() => res(p), 700));
}

(async () => {
  const open = await startServer(5301, {});
  const locked = await startServer(5302, { APP_PASSWORD: 'open sesame' });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
  });
  try {
    // ── Opening song files ─────────────────────────────────────────
    console.log('Open a song file');
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5301/studio.html');
    await page.waitForSelector('#ssOpenFile', { state: 'visible' });

    const openFile = async (name) => {
      await page.evaluate(() => { document.getElementById('startScreen').hidden || null; });
      if (await page.locator('#startScreen').isHidden()) await page.evaluate(() => StartScreen.show(true));
      page.once('dialog', d => d.accept());
      await page.setInputFiles('#ssFile', path.join(FIX, name));
      await page.waitForFunction(() => document.getElementById('startScreen').hidden || !document.getElementById('ssFileMsg').hidden
        && document.getElementById('ssFileMsg').classList.contains('err'), null, { timeout: 8000 });
      await page.waitForTimeout(600);   // the save to the library
    };
    const snapshot = () => page.evaluate(() => ({
      bpm: Project.bpm(),
      tracks: Project.tracks().map(t => ({ name: t.name, kind: t.kind, inst: t.instrument, role: t.sound && t.sound.role,
                                          first: t.kind === 'synth' ? t.patterns[0].slice(0, 4).map(n => [n.s, n.m, n.l]) : null,
                                          steps: t.kind === 'drum' ? t.patterns[0].slice(0, 16).map(Boolean) : null })),
      bars: Project.sections ? Project.sections().reduce((a, s) => a + s.bars, 0) : null,
      name: document.getElementById('projName').value
    }));

    await openFile('chorale.musicxml');
    let s = await snapshot();
    ok('MusicXML: four voices, four tracks', s.tracks.map(t => t.name).join(',') === 'Soprano,Alto,Tenor,Bass', s.tracks.map(t => t.name).join(','));
    ok('MusicXML: pickup bar keeps barlines (soprano starts on beat 4)', JSON.stringify(s.tracks[0].first) === '[[12,69,4],[16,74,4],[20,72,4],[24,70,4]]', JSON.stringify(s.tracks[0].first));
    ok('MusicXML: 13 bars, same as the built-in Bach chorale', s.bars === 13, String(s.bars));
    ok('MusicXML: voices get voices, bass gets cello', s.tracks[0].inst === 'gm-choir-aahs' && s.tracks[3].inst === 'real-cello', s.tracks.map(t => t.inst).join(','));
    const saved1 = await (await page.request.get('http://127.0.0.1:5301/api/projects')).json();
    ok('Saved to the library under the song name', saved1.names.includes(s.name), JSON.stringify(saved1.names));

    const viaXml = s;
    await openFile('chorale.mxl');
    s = await snapshot();
    ok('.mxl (zipped MusicXML) reads the same as the plain file',
      JSON.stringify(s.tracks.map(t => t.first)) === JSON.stringify(viaXml.tracks.map(t => t.first)) && s.bars === viaXml.bars);
    const saved2 = await (await page.request.get('http://127.0.0.1:5301/api/projects')).json();
    ok('A second copy never overwrites the first', saved2.names.length === 2 && saved2.names.some(n => / 2$/.test(n)), JSON.stringify(saved2.names));

    await openFile('band.mid');
    s = await snapshot();
    const by = Object.fromEntries(s.tracks.map(t => [t.name, t]));
    ok('MIDI: tempo read from the file', s.bpm === 120, String(s.bpm));
    ok('MIDI: each drum sound is its own track', by.Kick && by.Snare && by['Hi-hat'] && by.Kick.kind === 'drum', Object.keys(by).join(','));
    ok('MIDI: kick on 1 and 3, snare on 2 and 4',
      by.Kick.steps.map((v, i) => v ? i : -1).filter(i => i >= 0).join() === '0,8' &&
      by.Snare.steps.map((v, i) => v ? i : -1).filter(i => i >= 0).join() === '4,12');
    ok('MIDI: bass program 33 -> electric bass', by.Bass && by.Bass.inst === 'real-ebass', by.Bass && by.Bass.inst);
    ok('MIDI: piano part kept', by.Piano && by.Piano.first[0][1] === 60);
    ok('MIDI: 8 bars', s.bars === 8, String(s.bars));

    // It plays.
    await page.evaluate(() => { App.ensureAudio(); Transport.start ? Transport.start() : document.getElementById('playBtn').click(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { if (Transport.isPlaying) Transport.stop(); });
    ok('Plays with no errors', errors.length === 0, errors.join(' | '));

    // A PDF is explained, not attempted.
    await page.evaluate(() => StartScreen.show(true));
    const pdf = path.join(os.tmpdir(), 'song.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    page.once('dialog', d => d.accept());
    await page.setInputFiles('#ssFile', pdf);
    await page.waitForFunction(() => document.getElementById('ssFileMsg').classList.contains('err'));
    ok('A PDF gets a plain explanation', /picture of the sheet music/.test(await page.textContent('#ssFileMsg')));
    await page.close();

    // ── The password ───────────────────────────────────────────────
    console.log('Password');
    const L = 'http://127.0.0.1:5302';
    const ctx = await browser.newContext();
    const r = ctx.request;
    ok('Health check stays open', (await r.get(L + '/health')).status() === 200);
    ok('Saved songs refuse without the password', (await r.get(L + '/api/projects')).status() === 401);
    ok('Ask Claude refuses without the password', (await r.post(L + '/api/studio-assist', { data: {} })).status() === 401);
    ok('Samples refuse without the password', (await r.get(L + '/js/engine/song-file.js', { maxRedirects: 0 })).status() === 401);
    const home = await r.get(L + '/studio.html', { maxRedirects: 0 });
    ok('A page sends you to sign in', home.status() === 302 && /\/login\.html\?next=%2Fstudio\.html/.test(home.headers().location), home.headers().location);
    const bad = await r.post(L + '/api/login', { data: { password: 'nope' } });
    ok('Wrong password is refused', bad.status() === 401);

    const lp = await ctx.newPage();
    await lp.goto(L + '/studio.html');
    ok('Sign-in page shows', await lp.locator('#pw').isVisible());
    await lp.fill('#pw', 'open sesame');
    await lp.click('#go');
    await lp.waitForURL(/studio\.html/);
    await lp.waitForSelector('#ssOpenFile', { state: 'visible' });
    ok('Right password lands you back on the Studio', true);
    ok('Signed in: saved songs open', (await r.get(L + '/api/projects')).status() === 200);
    const cookie = (await ctx.cookies()).find(c => c.name === 'rs_auth');
    ok('Cookie is HttpOnly and lasts', cookie && cookie.httpOnly && cookie.expires > Date.now() / 1000 + 300 * 86400);
    await lp.goto(L + '/api/logout');
    ok('Sign out works', (await r.get(L + '/api/projects')).status() === 401);
    await ctx.close();

    const o = await browser.newContext();
    ok('No password set = open, as before', (await o.request.get('http://127.0.0.1:5301/api/projects')).status() === 200
      && (await o.request.get('http://127.0.0.1:5301/studio.html', { maxRedirects: 0 })).status() === 200);
    await o.close();
  } catch (e) {
    fail++; console.log('  FAIL  crashed: ' + (e.stack || e));
  } finally {
    await browser.close();
    open.kill(); locked.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
