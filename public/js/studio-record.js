// studio-record.js — the ● Rec button and audio uploads. Both end the same
// way: a new audio track with a waveform, a mixer strip and a row in the song.

(function () {
  const $ = (id) => document.getElementById(id);
  const recBtn = $('recBtn');
  const srcSel = $('recSource');
  const barsSel = $('recBars');
  const upload = $('audioUpload');
  if (!recBtn) return;

  const counts = { keys: 0, mix: 0, mic: 0 };
  const NAMES = { keys: 'Take', mix: 'Bounce', mic: 'Mic' };

  function barSec() {
    const st = Transport.getState();
    return st.secondsPerStep * st.stepsPerBar;
  }

  function addAudioTrack(buffer, bars, name, opts = {}) {
    const audioId = Project.newAudioId();
    Project.setAudio(audioId, buffer);
    const t = Project.addTrack({
      kind: 'audio', name, audioId, bars,
      live: opts.off ? Project.OFF : 0,
      cell: opts.off ? Project.OFF : 0
    });
    App.select(t.id);
    return t;
  }

  function paint(st) {
    recBtn.classList.toggle('recording', st === 'recording');
    recBtn.disabled = st === 'finishing';
    recBtn.innerHTML = st === 'recording' ? '&#9632; Stop rec' : st === 'finishing' ? 'Saving…' : '&#9679; Rec';
    srcSel.disabled = barsSel.disabled = st !== 'idle';
  }

  Recorder.onChange((s) => {
    paint(s.state);
    if (s.countingIn) recBtn.innerHTML = '1 · 2 · 3 · 4…';
    if (s.error) App.msg('Nothing was captured (' + s.error + '). Try again — keep it under a minute.', true);
    if (s.done && s.take) {
      const src = s.take.source;
      counts[src]++;
      const name = `${NAMES[src]} ${counts[src]}`;
      const t = addAudioTrack(s.take.buffer, s.take.bars, name, { off: src === 'mix' });
      // A voice gets the vocal chain straight away — switch it off in the editor if you want it raw.
      if (src === 'mic') Project.setCharacter(t.id, 'vocal', 0.6);
      App.msg(src === 'mix'
        ? `Bounced ${s.take.bars} bars to "${t.name}". It starts switched OFF so it doesn't double up — turn it on where you want it, and mute the parts it replaces.`
        : `Recorded ${s.take.bars} bar${s.take.bars === 1 ? '' : 's'} to "${t.name}". It's on in every section — drag, stretch or delete its blocks on the timeline to choose where it plays.` +
          (src === 'mic' ? ' Vocal polish is on; Tune (pitch correction) is in the editor below.' : ''));
    }
  });

  recBtn.addEventListener('click', async () => {
    if (!App.ensureAudio()) return;
    const st = Recorder.getState();
    if (st === 'recording') { await Recorder.stop(); return; }
    if (st !== 'idle') return;
    const bars = parseInt(barsSel.value, 10) || 0;
    const res = await Recorder.start(bars);
    if (!res.ok) { App.msg('Could not record: ' + res.error, true); return; }
    const src = Recorder.getSource();
    App.msg(src === 'keys' ? 'Recording what you play on the keys/pads' + (bars ? ` for ${bars} bars.` : ' — press Stop rec when done.')
      : src === 'mix' ? 'Recording everything you hear' + (bars ? ` for ${bars} bars.` : ' — press Stop rec when done.')
      : 'Recording the mic' + (bars ? ` for ${bars} bars.` : ' — press Stop rec when done.') + ' Headphones on, or it records the beat too.');
  });

  srcSel.addEventListener('change', async () => {
    App.ensureAudio();
    const res = await Recorder.setSource(srcSel.value);
    if (!res.ok) {
      App.msg('Microphone unavailable: ' + res.error, true);
      srcSel.value = 'keys';
      await Recorder.setSource('keys');
      return;
    }
    if (srcSel.value === 'mic') App.openPop($('recMenu'), srcSel);
  });

  const trim = $('micTrim');
  trim.addEventListener('input', () => {
    const ms = parseInt(trim.value, 10);
    $('micTrimVal').textContent = ms + 'ms';
    Recorder.setMicTrim(ms / 1000);
  });

  upload.addEventListener('change', async () => {
    const ac = App.ensureAudio();
    if (!ac) return;
    const files = Array.from(upload.files || []);
    for (const f of files) {
      App.msg('Loading ' + f.name + '…');
      try {
        const buffer = await ac.decodeAudioData(await f.arrayBuffer());
        const bars = Math.max(1, Math.min(64, Math.round(buffer.duration / barSec())));
        const t = addAudioTrack(buffer, bars, f.name.replace(/\.[^.]+$/, '').slice(0, 40));
        App.msg(`Added "${t.name}" — ${buffer.duration.toFixed(1)}s, looping every ${bars} bar${bars === 1 ? '' : 's'}. Its waveform is below.`);
      } catch (e) {
        App.msg('Could not read ' + f.name + ' — is it an audio file?', true);
      }
    }
    upload.value = '';
  });

  window.__bhsAddAudioTrack = addAudioTrack;
  paint('idle');
})();
