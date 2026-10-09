// make-manual.js — takes the screenshots for the user manual (public/manual.html)
// straight from the running app, and records where each numbered callout goes.
//
// Re-run it whenever the screen changes, so the pictures never go stale:
//   npm install --no-save playwright
//   PORT=5199 DATA_DIR=/tmp/bhs node server.js &
//   node tools/make-manual.js
//
// Writes public/manual/<shot>.png and public/manual/callouts.json.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 5199);
const OUT = path.join(__dirname, '..', 'public', 'manual');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const callouts = {};

  async function shot(id, region, marks, opts = {}) {
    const data = await page.evaluate(([region, marks, pad]) => {
      const pageBox = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
      let clip;
      if (region === 'viewport') clip = { x: scrollX, y: scrollY, w: innerWidth, h: innerHeight };
      else { const el = document.querySelector(region); clip = pageBox(el); }
      clip = { x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad), w: clip.w + pad * 2, h: clip.h + pad * 2 };
      const out = [];
      marks.forEach(([sel, n]) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const b = pageBox(el);
        out.push({ n, x: (b.x - clip.x) / clip.w * 100, y: (b.y - clip.y) / clip.h * 100, w: b.w / clip.w * 100, h: b.h / clip.h * 100 });
      });
      return { clip, out };
    }, [region, marks, opts.pad == null ? 8 : opts.pad]);
    const c = data.clip;
    await page.screenshot({ path: path.join(OUT, id + '.png'), clip: { x: c.x, y: c.y, width: c.w, height: c.h }, fullPage: region !== 'viewport' });
    callouts[id] = data.out;
    console.log('shot', id, data.out.length, 'callouts');
  }

  // The dock is pinned to the window, so in a full-page capture it lands mid-picture; hide it for those.
  const collapseDock = (on) => page.evaluate((on) => { document.getElementById('dock').style.display = on ? 'none' : ''; }, on);

  await page.goto(BASE + '/studio.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // ── start screen
  await shot('start', '.ss-card', [['.ss-tpl[data-id="trap"]', 1], ['.ss-tpl[data-id="blank"]', 2], ['.ss-saved', 3], ['.ss-close', 4]]);

  await page.evaluate(() => StartScreen.choose('trap'));
  await page.waitForTimeout(300);
  await page.evaluate(() => App.select(Project.tracks().find(t => t.name === 'Kick').id));

  // ── the whole screen, while it plays
  await page.click('#playBtn');
  await page.waitForTimeout(6500);
  await shot('overview', 'viewport', [
    ['#playBtn', 1], ['.tb-mode', 2], ['#recBtn', 3], ['#arrangePanel', 4], ['#editorPanel .panel-head', 5],
    ['#keyboard', 6], ['#knobs', 7], ['.tb-help', 8]
  ], { pad: 0 });

  // ── what's making the sound
  await page.evaluate(() => {
    ['Kick', 'Hi-hat', '808'].forEach(n => {
      const t = Project.tracks().find(x => x.name === n);
      const row = document.querySelector(`.tl-row.track[data-id="${t.id}"]`);
      row.classList.add('hit'); row._hitT = 1;
    });
  });
  await page.click('#playBtn');
  await page.evaluate(() => {
    // freeze the lights + playhead for the picture
    ['Kick', 'Hi-hat', '808'].forEach(n => {
      const t = Project.tracks().find(x => x.name === n);
      document.querySelector(`.tl-row.track[data-id="${t.id}"]`).classList.add('hit');
    });
    const ph = document.querySelector('.tl-playhead');
    const head = document.querySelector('.tl-head');
    ph.hidden = false;
    ph.style.left = head.offsetWidth + 6.4 * parseFloat(getComputedStyle(document.body).getPropertyValue('--bar')) + 'px';
  });
  await shot('sound', '#arrangePanel', [
    ['.tl-row.track.hit .led', 1], ['.tl-playhead', 2], ['.tl-row.track .clip', 3], ['.tl-row.track .tname', 4], ['.tl-row.track .editbtn', 5]
  ]);
  await page.evaluate(() => document.querySelectorAll('.tl-row.hit').forEach(r => r.classList.remove('hit')));

  // ── the timeline, with a block selected
  await page.evaluate(() => window.__bhsTimeline.select(Project.tracks().find(t => t.name === 'Snare').id, 4));
  await page.waitForTimeout(100);
  await shot('timeline', '#arrangePanel', [
    ['.tl-sec', 1], ['.tl-nums', 2], ['.clip.selected', 3], ['.clip.selected .clip-edge.r', 4], ['#clipBar', 5],
    ['.tl-row.track .ms.m', 6], ['#addSectionBtn', 7], ['#addTrackBtn', 8]
  ]);
  await page.evaluate(() => window.__bhsTimeline.select(null, -1));

  // ── drum machine
  await collapseDock(true);
  await page.evaluate(() => App.select(Project.tracks().find(t => t.name === 'Hi-hat').id));
  await page.evaluate(() => Project.setEdit(Project.tracks().find(t => t.name === 'Hi-hat').id, 1));
  await page.waitForTimeout(150);
  // a few hits with their own volume / left-right, so the lane has something to show
  await page.evaluate(() => {
    const h = Project.tracks().find(t => t.name === 'Hi-hat');
    Project.pattern(h.id, 1).forEach((v, i) => { if (v) Project.setStepMix(h.id, 1, i, { vel: 0.35 + 0.6 * ((i % 4) / 3) }); });
  });
  await page.waitForTimeout(150);
  await shot('drums', '#editorPanel', [
    ['#editorTitle select', 1], ['.ed-head select', 2], ['.dbrushes', 3], ['.drumtools .field', 4],
    ['.drow.sel .lane-sound', 5], ['.drow.sel .letters', 6], ['.drow.sel .dcells', 7], ['.drow .dname', 8]
  ]);

  await shot('mixlane', '#editor .drumgrid', [['.vrow .vlabel', 1], ['.vrow .mixmode', 2], ['.vrow .vcell.has', 3]]);
  await page.evaluate(() => Project.setCharacter(Project.tracks().find(t => t.name === 'Hi-hat').id, 'punchy', 0.6));
  await page.waitForTimeout(150);
  await shot('character', '#editor .drumtools', [['#editor .drumtools .charsel', 1], ['#editor .drumtools .charamt', 2]], { pad: 4 });

  // ── piano roll
  await page.evaluate(() => App.select(Project.tracks().find(t => t.name === 'Piano').id));
  await page.waitForTimeout(150);
  await shot('roll', '#editorPanel', [
    ['.ed-head select', 1], ['.ed-head .letters', 2], ['.ed-head .field:nth-of-type(2) select', 3], ['.ed-head .field:nth-of-type(3) select', 4],
    ['.chordbtn', 5], ['.rnote', 6], ['.rrow.keyroot .rkey', 7], ['.roll-lane', 8], ['.rmix-lane', 9], ['.mixrow .mixmode', 10], ['#editor .ed-head .charfield', 11]
  ]);
  await page.evaluate(() => App.select(Project.tracks().find(t => t.name === '808').id));
  await page.waitForTimeout(150);
  await shot('roll808', '#editorPanel', [['.slidebtn.on', 1], ['.rnote.slide', 2]]);

  // ── mixer
  await page.evaluate(() => App.showTab('mix'));
  await page.waitForTimeout(100);
  await shot('mixer', '#editorPanel', [
    ['.strip .fader', 1], ['.strip .panknob', 2], ['.strip .sendrow', 3], ['.strip .pumprow', 4], ['.strip .stripbtns', 5], ['#masterVol', 6], ['.strip .stripchar', 7]
  ]);
  await page.evaluate(() => App.showTab('edit'));
  await collapseDock(false);

  // ── dock
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('dock', '#dock', [
    ['#keysTarget', 1], ['#keysSound', 2], ['#octDown', 3], ['#slideBtn', 4], ['#recNotes', 5], ['#keyboard', 6], ['#knobs', 7], ['#dockToggle', 8]
  ], { pad: 0 });

  // ── top bar: recording, click, undo
  await shot('topbar', '.topbar', [
    ['#undoBtn', 1], ['#playBtn', 2], ['#clickBtn', 3], ['#recBtn', 4], ['#recSource', 5], ['#recBars', 6], ['#bpm', 7], ['.tb-mode', 8],
    ['#saveBtn', 9], ['#exportBtn', 10]
  ], { pad: 0 });

  // ── an audio track's waveform
  const wav = path.join(require('os').tmpdir(), 'manual-sine.wav');
  if (!fs.existsSync(wav)) {
    const rate = 44100, n = rate * 3, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) { const env = Math.exp(-((i / rate) % 0.43) * 6); buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 110 * i / rate) * 14000 * env), 44 + i * 2); }
    fs.writeFileSync(wav, buf);
  }
  await page.setInputFiles('#audioUpload', wav);
  await page.waitForTimeout(800);
  await collapseDock(true);
  await page.evaluate(() => { const t = Project.tracks().find(x => x.kind === 'audio'); Project.setCharacter(t.id, 'vocal', 0.6); });
  await page.waitForTimeout(150);
  await shot('audio', '#editorPanel', [['.wave', 1], ['.ed-head .sbars', 2], ['.ed-head input[type=range]', 3], ['.voicehead .charsel', 4], ['.voicehead .tunesel', 5]]);
  await collapseDock(false);

  // ── export + mastering
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#exportBtn');
  await page.waitForTimeout(150);
  await shot('export', '#exportMenu', [['#exportBarsField', 1], ['#masterStyle', 2], ['#exportHear', 3], ['#exportGo', 4]], { pad: 6 });
  await page.keyboard.press('Escape');

  // ── open / save
  await page.click('#openBtn');
  await page.waitForTimeout(300);
  await shot('open', '#openMenu', [['#projList', 1], ['#newProjBtn', 2]], { pad: 6 });
  await page.keyboard.press('Escape');

  // ── the guided tour, on its "press Play" step
  await page.evaluate(() => { window.scrollTo(0, 0); Tour.start(); Tour.next(); document.getElementById('status').classList.remove('show'); });
  await page.waitForTimeout(500);
  await shot('tour', 'viewport', [['.tour-card', 1], ['.tour-ring', 2]], { pad: 0 });
  await page.evaluate(() => Tour.stop());

  // ── Ask Claude
  await page.click('#claudeBtn');
  await page.waitForTimeout(150);
  await shot('claude', '#claudeDrawer', [['#claudeLog', 1], ['#claudeInput', 2]], { pad: 0 });

  fs.writeFileSync(path.join(OUT, 'callouts.json'), JSON.stringify(callouts, null, 1));
  await browser.close();
  console.log('done →', OUT);
})();
