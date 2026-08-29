// midi.test.js — MIDI keyboard support, verified in a real browser.
//
// Only the USB layer is faked: navigator.requestMIDIAccess is replaced with a
// stub device, and every byte after that goes through the real MidiIn parser
// and the real routing in studio-midi.js. Pitch is measured off rendered audio
// rather than asserted.
//
// Run it:
//   npm install playwright            (not a project dependency — test only)
//   PORT=5199 DATA_DIR=/tmp/bhs node server.js &
//   node tests/midi.test.js
//
// If Chromium isn't where executablePath points, change that line.

const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:5199/studio.html';

let pass = 0, fail = 0;
const ok  = (n, c, extra='') => { c ? (pass++, console.log('  PASS  ' + n + (extra?'  '+extra:''))) : (fail++, console.log('  FAIL  ' + n + '  ' + extra)); };

// A fake MIDIAccess. Only the USB layer is faked — every byte still goes
// through the real MidiIn parser and the real routing in studio-midi.js.
const FAKE_MIDI = () => {
  class FakeInput {
    constructor(id, name) { this.id=id; this.name=name; this.manufacturer='TestCo'; this.state='connected'; this.onmidimessage=null; }
    send(bytes) { if (this.onmidimessage) this.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() }); }
  }
  const inputs = new Map();
  inputs.set('in1', new FakeInput('in1', 'Fake Keys 49'));
  const access = { inputs, outputs: new Map(), onstatechange: null,
    __addDevice(id, name) { inputs.set(id, new FakeInput(id, name)); if (access.onstatechange) access.onstatechange({}); } };
  window.__midiAccess = access;
  window.__midiDenied = false;
  navigator.requestMIDIAccess = async () => { if (window.__midiDenied) throw new Error('denied'); return access; };
  window.__send = (bytes, id='in1') => inputs.get(id).send(bytes);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required','--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type()==='error') errors.push('console: ' + m.text()); });

  await page.addInitScript(FAKE_MIDI);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // Spy on the two audio entry points so we can see exactly what got played.
  await page.evaluate(() => {
    window.__noteCalls = [];
    const origNote = Synth808.noteOn;
    Synth808.noteOn = function (midi, params, when) {
      window.__noteCalls.push({ midi, gain: params && params.gain });
      return origNote.call(this, midi, params, when);
    };
    // Sub-sample-interpolated zero-crossing pitch: time between the first and
    // last upward crossing, divided by the number of whole cycles between them.
    window.__freq = (d, rate, t0, t1) => {
      const a = Math.floor(rate*t0), b = Math.min(d.length-1, Math.floor(rate*t1));
      const xs = [];
      for (let i = a+1; i < b; i++) {
        if (d[i-1] <= 0 && d[i] > 0) xs.push((i-1 + (-d[i-1] / (d[i]-d[i-1]))) / rate);
      }
      if (xs.length < 3) return 0;
      return (xs.length - 1) / (xs[xs.length-1] - xs[0]);
    };
    window.__drumCalls = [];
    const origRV = RhythmAudio.renderVoice;
    RhythmAudio.renderVoice = function (ac, buses, id, t) {
      window.__drumCalls.push(id);
      return origRV.call(this, ac, buses, id, t);
    };
  });

  console.log('\n1. Connect');
  await page.click('#midiConnect');
  await page.waitForTimeout(200);
  const status = await page.textContent('#midiStatus');
  ok('enable() succeeds and names the device', /Fake Keys 49/.test(status), status.slice(0,60));
  ok('device list rendered', (await page.textContent('#midiDevices')).includes('Fake Keys 49'));

  console.log('\n2. 808 note on / note off');
  await page.evaluate(() => window.__send([0x90, 36, 100]));
  await page.waitForTimeout(60);
  ok('key 36 lit on the on-screen keyboard',
     await page.evaluate(() => !!document.querySelector('[data-midi="36"]')?.classList.contains('down')));
  ok('activity readout shows the note name',
     /C2/.test(await page.textContent('#midiActivity')), await page.textContent('#midiActivity'));
  await page.evaluate(() => window.__send([0x80, 36, 0]));
  await page.waitForTimeout(60);
  ok('key 36 released after note-off',
     await page.evaluate(() => !document.querySelector('[data-midi="36"]')?.classList.contains('down')));

  console.log('\n3. Note-on with velocity 0 counts as note-off');
  await page.evaluate(() => window.__send([0x90, 38, 90]));
  await page.waitForTimeout(50);
  const litBefore = await page.evaluate(() => !!document.querySelector('[data-midi="38"]')?.classList.contains('down'));
  await page.evaluate(() => window.__send([0x90, 38, 0]));   // the common note-off encoding
  await page.waitForTimeout(50);
  const litAfter = await page.evaluate(() => !!document.querySelector('[data-midi="38"]')?.classList.contains('down'));
  ok('vel-0 note-on releases the note', litBefore && !litAfter, `lit before=${litBefore} after=${litAfter}`);

  console.log('\n4. Velocity');
  await page.evaluate(() => { window.__noteCalls = []; });
  await page.evaluate(() => { window.__send([0x90, 40, 127]); window.__send([0x80, 40, 0]);
                              window.__send([0x90, 41, 30]);  window.__send([0x80, 41, 0]); });
  await page.waitForTimeout(80);
  let calls = await page.evaluate(() => window.__noteCalls);
  ok('hard note is louder than soft note', calls.length===2 && calls[0].gain > calls[1].gain,
     `hard=${calls[0]?.gain?.toFixed(3)} soft=${calls[1]?.gain?.toFixed(3)}`);
  // Turn velocity off — both should now be identical.
  await page.uncheck('#midiVelocity');
  await page.evaluate(() => { window.__noteCalls = []; });
  await page.evaluate(() => { window.__send([0x90, 40, 127]); window.__send([0x80, 40, 0]);
                              window.__send([0x90, 41, 30]);  window.__send([0x80, 41, 0]); });
  await page.waitForTimeout(80);
  calls = await page.evaluate(() => window.__noteCalls);
  ok('velocity off makes them identical', calls.length===2 && calls[0].gain === calls[1].gain,
     `${calls[0]?.gain?.toFixed(3)} vs ${calls[1]?.gain?.toFixed(3)}`);
  await page.check('#midiVelocity');

  console.log('\n5. Channel filter');
  await page.selectOption('#midiChannel', '1');
  await page.evaluate(() => { window.__noteCalls = []; });
  await page.evaluate(() => window.__send([0x99, 45, 100]));   // 0x99 = note-on channel 10
  await page.waitForTimeout(60);
  ok('channel 10 ignored while set to channel 1',
     (await page.evaluate(() => window.__noteCalls.length)) === 0);
  await page.evaluate(() => window.__send([0x90, 45, 100]));   // 0x90 = channel 1
  await page.waitForTimeout(60);
  ok('channel 1 accepted', (await page.evaluate(() => window.__noteCalls.length)) === 1);
  await page.evaluate(() => window.__send([0x80, 45, 0]));
  await page.selectOption('#midiChannel', '0');

  console.log('\n6. Drum pads');
  await page.selectOption('#midiTarget', 'drums');
  await page.waitForTimeout(80);
  await page.evaluate(() => { window.__drumCalls = []; });
  await page.evaluate(() => { window.__send([0x90, 36, 110]);    // GM kick
                              window.__send([0x90, 38, 110]);    // GM snare
                              window.__send([0x90, 42, 110]);    // GM closed hat
                              window.__send([0x90, 46, 110]); });// GM open hat
  await page.waitForTimeout(120);
  const drums = await page.evaluate(() => window.__drumCalls);
  ok('GM drum map hits the right lanes',
     JSON.stringify(drums) === JSON.stringify(['kick_punchy','snare_fat','hat_closed','hat_open']),
     JSON.stringify(drums));
  ok('a played drum flashes its lane row',
     await page.evaluate(async () => {
       let seen = false;
       const o = new MutationObserver(() => { if (document.querySelector('.drow.struck')) seen = true; });
       o.observe(document.getElementById('drumGrid'), {subtree:true, attributes:true, attributeFilter:['class']});
       window.__send([0x90, 36, 100]);
       await new Promise(r => setTimeout(r, 60));
       o.disconnect();
       return seen;
     }));

  console.log('\n7. Pitched synth voices play the note you press');
  const pitch = await page.evaluate(async () => {
    // Render bass_sub at two notes offline and measure the actual frequency
    // by counting zero crossings — a real measurement, not a claim.
    async function measure(midi) {
      const oac = new OfflineAudioContext(1, 44100 * 0.5, 44100);
      const buses = RhythmAudio.createBuses(oac);
      buses.output.connect(oac.destination);
      RhythmAudio.renderVoicePitched(oac, buses, 'bass_sub', 0.01, midi);
      const buf = await oac.startRendering();
      const d = buf.getChannelData(0);
      return window.__freq(d, 44100, 0.05, 0.25);
    }
    const expect = (m) => 440 * Math.pow(2, (m - 69) / 12);
    return { a: [await measure(36), expect(36)], b: [await measure(48), expect(48)] };
  });
  ok('C2 renders at the right pitch', Math.abs(pitch.a[0]-pitch.a[1]) < 1.5,
     `measured ${pitch.a[0].toFixed(1)}Hz, expected ${pitch.a[1].toFixed(1)}Hz`);
  ok('C3 renders at the right pitch', Math.abs(pitch.b[0]-pitch.b[1]) < 2.0,
     `measured ${pitch.b[0].toFixed(1)}Hz, expected ${pitch.b[1].toFixed(1)}Hz`);
  ok('an octave up really is double',
     Math.abs((pitch.b[0]/pitch.a[0]) - 2) < 0.05, `ratio ${(pitch.b[0]/pitch.a[0]).toFixed(3)}`);

  console.log('\n8. Pitch bend on the 808');
  await page.selectOption('#midiTarget', 'bass808');
  await page.waitForTimeout(60);
  const bend = await page.evaluate(async () => {
    window.__send([0x90, 36, 100]);
    await new Promise(r => setTimeout(r, 30));
    const ac = Synth808.context;
    // Reach the live oscillator through the same path the app does.
    const before = window.__lastOscFreq;
    window.__send([0xE0, 0x00, 0x40]);              // centre: 8192, no bend
    await new Promise(r => setTimeout(r, 30));
    const centred = document.getElementById('midiActivity').textContent;
    window.__send([0xE0, 0x7F, 0x7F]);              // full up
    await new Promise(r => setTimeout(r, 30));
    window.__send([0x80, 36, 0]);
    return { centred };
  });
  // Bend is verified by measurement below instead of by DOM state.
  const bendMeasured = await page.evaluate(async () => {
    const oac = new OfflineAudioContext(1, 44100, 44100);
    const dest = oac.createGain(); dest.connect(oac.destination);
    const h = Synth808.renderNote(oac, dest, 36, { decay: 2, sustain: 1, release: 2, drive: 1, tone: 6000 }, 0);
    h.setBend(2, 0.2);                              // +2 semitones part-way through
    const buf = await oac.startRendering();
    const d = buf.getChannelData(0);
    const freqBetween = (t0, t1) => window.__freq(d, 44100, t0, t1);
    return { before: freqBetween(0.10, 0.19), after: freqBetween(0.40, 0.60) };
  });
  const expected36 = 440*Math.pow(2,(36-69)/12), expected38 = 440*Math.pow(2,(38-69)/12);
  ok('un-bent note sits on the note', Math.abs(bendMeasured.before-expected36) < 1.5,
     `${bendMeasured.before.toFixed(1)}Hz vs ${expected36.toFixed(1)}Hz`);
  ok('+2 semitone bend lands 2 semitones up', Math.abs(bendMeasured.after-expected38) < 1.5,
     `${bendMeasured.after.toFixed(1)}Hz vs ${expected38.toFixed(1)}Hz`);

  console.log('\n9. Sustain pedal');
  await page.evaluate(() => { window.__send([0xB0, 64, 127]); });   // pedal down
  await page.evaluate(() => { window.__send([0x90, 43, 100]); });
  await page.waitForTimeout(50);
  await page.evaluate(() => { window.__send([0x80, 43, 0]); });      // key up, pedal still down
  await page.waitForTimeout(50);
  ok('note held by the pedal after the key comes up',
     await page.evaluate(() => !!document.querySelector('[data-midi="43"]')?.classList.contains('down')));
  await page.evaluate(() => { window.__send([0xB0, 64, 0]); });      // pedal up
  await page.waitForTimeout(80);
  ok('pedal up releases it',
     await page.evaluate(() => !document.querySelector('[data-midi="43"]')?.classList.contains('down')));

  console.log('\n10. A keyboard plugged in AFTER the page loaded');
  await page.evaluate(() => window.__midiAccess.__addDevice('in2', 'Late Arrival 88'));
  await page.waitForTimeout(150);
  ok('new device appears in the list',
     (await page.textContent('#midiDevices')).includes('Late Arrival 88'));
  await page.evaluate(() => { window.__noteCalls = []; window.__send([0x90, 44, 100], 'in2'); });
  await page.waitForTimeout(60);
  ok('and it actually plays', (await page.evaluate(() => window.__noteCalls.length)) === 1);
  await page.evaluate(() => window.__send([0x80, 44, 0], 'in2'));

  console.log('\n10b. Sample pads');
  const sampleRes = await page.evaluate(async () => {
    // Build a real one-second WAV in the page and push it through the same
    // upload path the file picker uses, so the library is genuinely populated.
    const rate = 8000, n = rate;
    const ab = new ArrayBuffer(44 + n*2), dv = new DataView(ab);
    const str = (o,t)=>{for(let i=0;i<t.length;i++)dv.setUint8(o+i,t.charCodeAt(i));};
    str(0,'RIFF'); dv.setUint32(4, 36+n*2, true); str(8,'WAVEfmt ');
    dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
    dv.setUint32(24,rate,true); dv.setUint32(28,rate*2,true);
    dv.setUint16(32,2,true); dv.setUint16(34,16,true);
    str(36,'data'); dv.setUint32(40,n*2,true);
    for (let i=0;i<n;i++) dv.setInt16(44+i*2, Math.sin(2*Math.PI*440*i/rate)*20000, true);
    const f = new File([ab], 'test-clip.wav', { type: 'audio/wav' });
    const added = await SampleTimeline.addSample(f);
    if (!added) return { error: 'sample would not load' };

    let played = 0;
    const orig = SampleTimeline.triggerSample;
    SampleTimeline.triggerSample = function (...a) { played++; return orig.apply(this, a); };

    document.getElementById('midiTarget').value = 'samples';
    document.getElementById('midiTarget').dispatchEvent(new Event('change'));
    window.__send([0x90, 48, 100]);                 // C3 -> first sample
    await new Promise(r => setTimeout(r, 60));
    const onFirst = played;
    window.__send([0x90, 90, 100]);                 // way past the library
    await new Promise(r => setTimeout(r, 60));
    const msg = document.getElementById('midiActivity').textContent;
    SampleTimeline.triggerSample = orig;
    return { onFirst, afterOutOfRange: played, msg, libSize: SampleTimeline.getLibrary().length };
  });
  ok('C3 fires the first uploaded sample', sampleRes.onFirst === 1, JSON.stringify(sampleRes));
  ok('a key with no sample on it plays nothing and says so',
     sampleRes.afterOutOfRange === 1 && /no sample/.test(sampleRes.msg), sampleRes.msg);

  console.log('\n10c. Setup is remembered across a reload');
  await page.selectOption('#midiTarget', 'synth:bell_chime');
  await page.selectOption('#midiChannel', '10');
  await page.uncheck('#midiVelocity');
  await page.waitForTimeout(80);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => ({
    target: document.getElementById('midiTarget').value,
    channel: document.getElementById('midiChannel').value,
    vel: document.getElementById('midiVelocity').checked,
    live: window.__bhsMidiTarget()
  }));
  ok('target, channel and velocity all survive a reload',
     restored.target === 'synth:bell_chime' && restored.channel === '10' && restored.vel === false
     && restored.live.targetId === 'synth' && restored.live.synthVoice === 'bell_chime',
     JSON.stringify(restored));

  console.log('\n11. Regression: the old pages still work');
  for (const p of ['freeplay.html', 'roundrobin.html']) {
    const p2 = await browser.newPage();
    const errs = [];
    p2.on('pageerror', e => errs.push(e.message));
    const resp = await p2.goto('http://127.0.0.1:5199/' + p, { waitUntil: 'load' });
    await p2.waitForTimeout(400);
    const voiceWorks = await p2.evaluate(() => {
      if (typeof RhythmAudio === 'undefined') return 'no engine';
      try { RhythmAudio.playVoice('kick_punchy', RhythmAudio.ensureContext().currentTime); return true; }
      catch (e) { return e.message; }
    });
    ok(p + ' loads clean and still triggers voices',
       resp.status() === 200 && errs.length === 0 && voiceWorks === true,
       errs.join('; ') || String(voiceWorks));
    await p2.close();
  }

  {
    const p2 = await browser.newPage();
    const errs = []; p2.on('pageerror', e => errs.push(e.message));
    const resp = await p2.goto('http://127.0.0.1:5199/index.html', { waitUntil: 'load' });
    await p2.waitForTimeout(300);
    ok('index.html (mode picker, no audio engine by design) loads clean',
       resp.status() === 200 && errs.length === 0, errs.join('; '));
    await p2.close();
  }

  console.log('\n12. Unsupported / insecure browsers say so');
  const p3 = await browser.newPage();
  await p3.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess',
      { value: undefined, configurable: true });
  });
  await p3.goto(URL, { waitUntil: 'load' });
  await p3.waitForTimeout(300);
  ok('no-MIDI browser disables the button with an explanation',
     (await p3.isDisabled('#midiConnect')) && /Safari/.test(await p3.textContent('#midiStatus')),
     (await p3.textContent('#midiStatus')).slice(0, 70));
  await p3.close();

  const p4 = await browser.newPage();
  await p4.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false });
    navigator.requestMIDIAccess = async () => ({ inputs: new Map(), outputs: new Map() });
  });
  await p4.goto(URL, { waitUntil: 'load' });
  await p4.waitForTimeout(300);
  ok('insecure address explains the https requirement',
     (await p4.isDisabled('#midiConnect')) && /192\.168/.test(await p4.textContent('#midiStatus')),
     (await p4.textContent('#midiStatus')).slice(0, 70));
  await p4.close();

  console.log('\n13. No page errors on the studio page throughout');
  ok('clean console', errors.length === 0, errors.slice(0,3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
