// studio-export.js — render the track to a .wav you can keep.
//
// Rendered offline rather than recorded: OfflineAudioContext runs as fast as
// the machine allows, is deterministic, and never drops a sample to a busy
// main thread. It runs the SAME Sequencer player the live studio uses, so the
// file is the song you heard — every section, bar mute and solo included —
// and now through a copy of the mixer (levels, pan, mute/solo) and the shared
// reverb and delay, which the old export left out.
//
// The live limiter is deliberately left out: a DynamicsCompressorNode has no
// lookahead and behaves differently offline, so the finished buffer is either
// mastered (Mastering) or peak-normalised instead.

(function () {
  const $ = (id) => document.getElementById(id);
  const btn = $('exportBtn');
  const msgEl = $('exportMsg');
  if (!btn) return;

  function msg(t, bad) {
    msgEl.textContent = t || '';
    msgEl.classList.toggle('bad', !!bad);
  }

  async function render(requestedBars, opts = {}) {
    // Every recorded instrument and drum the song uses must be in before the
    // render starts, or the file would get the synth stand-ins.
    if (typeof Samples !== 'undefined') await Samples.preloadFor(Project.tracks());
    const songMode = Project.mode() === 'song';
    const totalBars = songMode ? Project.songBars() : requestedBars;
    const live = Sequencer.init();
    const rate = live ? live.sampleRate : 44100;
    const st = Transport.getState();
    const stepSec = st.secondsPerStep;
    const totalSteps = totalBars * st.stepsPerBar;
    const TAIL = 2.0;
    const seconds = totalSteps * stepSec + TAIL;

    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oac = new OAC(2, Math.ceil(seconds * rate), rate);
    const bus = oac.createGain();
    bus.gain.value = Mixer.getMasterVolume();
    bus.connect(oac.destination);
    const fx = Effects.buildOffline(oac, bus, st.bpm);

    // A copy of each mixer strip inside the offline context.
    const strips = new Map();
    function stripFor(id) {
      if (strips.has(id)) return strips.get(id);
      const m = Mixer.get(id);
      const duck = oac.createGain();
      const g = oac.createGain();
      // the track's Character, built from the same numbers as the live strip
      const pt = Project.track(id);
      const ch = pt && pt.character && typeof Character !== 'undefined' ? Character.build(oac, pt.character.id, pt.character.amount) : null;
      if (ch) { duck.connect(ch.input); ch.output.connect(g); } else duck.connect(g);
      g.gain.value = m ? m.volume : 0.85;
      const pan = oac.createStereoPanner ? oac.createStereoPanner() : null;
      if (pan) { pan.pan.value = m ? m.pan : 0; g.connect(pan).connect(bus); } else g.connect(bus);
      if (m && m.reverb > 0) { const s = oac.createGain(); s.gain.value = m.reverb; g.connect(s).connect(fx.reverbIn); }
      if (m && m.delay > 0) { const s = oac.createGain(); s.gain.value = m.delay; g.connect(s).connect(fx.delayIn); }
      strips.set(id, duck);
      return duck;
    }

    const player = Sequencer.createPlayer({
      ac: oac,
      out: stripFor,
      duck: stripFor,
      audible: (id) => !Mixer.get(id) || Mixer.isAudible(id)
    });
    for (let s = 0; s < totalSteps; s++) {
      player.step({
        time: s * stepSec,
        bar: Math.floor(s / st.stepsPerBar),
        stepInBar: s % st.stepsPerBar,
        stepDur: stepSec,
        songMode
      });
    }

    let rendered = await oac.startRendering();
    if (opts.master && typeof Mastering !== 'undefined') {
      const res = await Mastering.master(rendered, { style: opts.style });
      return { rendered: res.buffer, norm: { applied: 1 }, seconds, totalBars, songMode, masterReport: res.report };
    }
    const norm = WavCodec.normalize(rendered, 0.98);
    return { rendered, norm, seconds, totalBars, songMode, masterReport: null };
  }

  function paintMenu() {
    const song = Project.mode() === 'song';
    $('exportBarsField').hidden = song;
    $('exportSongNote').hidden = !song;
    $('exportSongNote').textContent = `Song mode is on, so the whole song is rendered — ${Project.songBars()} bars.`;
  }

  btn.addEventListener('click', (e) => { paintMenu(); App.togglePop($('exportMenu'), e.currentTarget); });

  $('exportGo').addEventListener('click', async () => {
    const go = $('exportGo');
    go.disabled = true;
    const bars = parseInt($('exportBars').value, 10) || 8;
    const style = $('masterStyle').value;
    const wantMaster = style !== 'off';
    const song = Project.mode() === 'song';
    msg((song ? 'Rendering the whole song' : `Rendering ${bars} bars`) + (wantMaster ? ', then mastering…' : '…'));
    try {
      const { rendered, norm, totalBars, masterReport } = await render(bars, { master: wantMaster, style });
      const blob = new Blob([WavCodec.encode(rendered)], { type: 'audio/wav' });
      const name = ($('projName').value || 'bhs-track').trim().replace(/[^a-z0-9 _-]/gi, '') || 'bhs-track';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.wav';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      let line = `Downloaded ${name}.wav — ${totalBars} bars, ${rendered.duration.toFixed(1)}s, ${(blob.size / 1048576).toFixed(1)}MB.`;
      if (masterReport) line += ' Mastered: ' + masterReport.summary + '.';
      else if (norm.applied < 1) line += ' Turned down slightly to stop it clipping.';
      msg(line);
    } catch (e) {
      msg('Export failed: ' + (e && e.message ? e.message : e), true);
    } finally {
      go.disabled = false;
    }
  });

  // ── hear it mastered, right here ──
  let hearSrc = null;
  $('exportHear').addEventListener('click', async () => {
    const b = $('exportHear');
    if (hearSrc) { try { hearSrc.stop(); } catch (_) {} hearSrc = null; b.innerHTML = '&#9654; Hear it mastered'; return; }
    const ac = App.ensureAudio(); if (!ac) return;
    if (Transport.isPlaying) Transport.stop();
    const style = $('masterStyle').value;
    b.disabled = true;
    msg('Rendering and mastering…');
    try {
      const bars = parseInt($('exportBars').value, 10) || 8;
      const { rendered, masterReport } = await render(bars, { master: style !== 'off', style });
      hearSrc = ac.createBufferSource();
      hearSrc.buffer = rendered;
      hearSrc.connect(ac.destination);
      hearSrc.onended = () => { hearSrc = null; b.innerHTML = '&#9654; Hear it mastered'; };
      hearSrc.start();
      b.innerHTML = '&#9632; Stop';
      msg(masterReport ? 'Playing the mastered version — ' + masterReport.summary + '.' : 'Playing it exactly as mixed.');
    } catch (e) {
      msg('Could not render: ' + (e && e.message ? e.message : e), true);
    } finally {
      b.disabled = false;
    }
  });

  // Exposed so the browser test can render without clicking through a download.
  window.__bhsRender = render;
})();
