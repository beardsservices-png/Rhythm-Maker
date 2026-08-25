// studio-export.js — render the track to a .wav you can keep.
//
// Rendered offline rather than recorded in real time: OfflineAudioContext runs
// as fast as the machine allows, is deterministic, and never drops a sample to
// a busy main thread. That is only possible because both engines can now build
// their voices into a stated context — audio nodes cannot cross contexts, so
// every node in the render is created fresh inside the offline one.
//
// The master compressor is deliberately LEFT OUT of the render. A
// DynamicsCompressorNode has no lookahead, overshoots, and is documented to
// behave differently offline than in realtime — so including it makes the file
// not match what you heard. Instead the finished buffer is peak-normalised,
// which guarantees no clipping exactly, in one pass.

(function () {
  const btn = document.getElementById('exportBtn');
  const barsSel = document.getElementById('exportBars');
  const msgEl = document.getElementById('exportMsg');
  if (!btn) return;

  function msg(t, bad) {
    msgEl.textContent = t || '';
    msgEl.classList.toggle('bad', !!bad);
  }

  function collect(type) {
    const ev = new CustomEvent(type, { detail: {} });
    window.dispatchEvent(ev);
    return ev.detail;
  }

  const DRUM_LANES = ['kick_punchy', 'snare_fat', 'hat_closed', 'hat_open', 'clap_classic', 'perc_shaker'];

  async function render(requestedBars, opts = {}) {
    // In song mode the arrangement decides both the length and which
    // variation each bar plays, so the file is the whole song rather than
    // whatever happens to be selected on screen.
    const songMode = typeof Song !== 'undefined' && Song.isEnabled();
    const totalBars = songMode ? Song.totalBars() : requestedBars;
    const variationForBar = songMode
      ? (bar) => Song.variationAt(bar)
      : null;

    const live = Synth808.ensureContext();
    const rate = live ? live.sampleRate : 44100;
    const st = Transport.getState();
    const stepSec = st.secondsPerStep;
    const stepsPerBar = st.stepsPerBar;
    const totalSteps = totalBars * stepsPerBar;

    // A tail so the last note's release isn't chopped off.
    const TAIL = 2.0;
    const seconds = totalSteps * stepSec + TAIL;

    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oac = new OAC(2, Math.ceil(seconds * rate), rate);

    // Master sum. No compressor here — see the note at the top.
    const bus = oac.createGain();
    bus.gain.value = 1;
    bus.connect(oac.destination);

    const drumBuses = RhythmAudio.createBuses(oac);
    drumBuses.output.connect(bus);

    const bassOut = oac.createGain();
    bassOut.gain.value = 1;
    bassOut.connect(bus);

    const seq = collect('bhs:collect-sequencer');
    const drums = collect('bhs:collect-drums');
    const voice = collect('bhs:collect-voice');
    // Resolve a part's pattern for a given bar: the arrangement's variation in
    // song mode, otherwise whatever is currently selected.
    const bassAt = (bar) => variationForBar
      ? Variations.bank('bass', variationForBar(bar))
      : Variations.active('bass');
    const laneAt = (li, bar) => variationForBar
      ? Variations.bank('drum:' + li, variationForBar(bar))
      : Variations.active('drum:' + li);
    const laneCount = (drums.parts || []).length;
    const muted = drums.muted || [];
    const params = voice.params || {};

    // Bassline. Mirrors the live sequencer's logic, including holding a note
    // through the next step when that step slides into it.
    let held = null;
    for (let s = 0; s < totalSteps; s++) {
      const bar = Math.floor(s / stepsPerBar);
      const pattern = bassAt(bar) || [];
      const patLen = pattern.length || 16;
      const i = s % patLen;
      const note = pattern[i];
      const t = s * stepSec;
      if (!note) {
        if (held) { held.release(t); held = null; }
        continue;
      }
      if (note.slide && held && !held.stopped) {
        held.slideTo(note.midi, Math.min(0.12, stepSec * 0.7), t);
      } else {
        if (held && !held.stopped) held.release(t);
        held = Synth808.renderNote(oac, bassOut, note.midi, params, t);
      }
      const next = pattern[(i + 1) % patLen];
      if (!(next && next.slide) && held) held.release(t + stepSec * 0.92);
    }

    // Drums.
    for (let s = 0; s < totalSteps; s++) {
      const t = s * stepSec;
      const bar = Math.floor(s / stepsPerBar);
      for (let li = 0; li < laneCount; li++) {
        if (muted[li]) continue;
        const lane = laneAt(li, bar);
        if (lane && lane[s % (lane.length || 16)]) {
          RhythmAudio.renderVoice(oac, drumBuses, DRUM_LANES[li], t);
        }
      }
    }

    // Sample timeline clips.
    if (typeof SampleTimeline !== 'undefined') {
      const tlClips = SampleTimeline.getClips();
      const tlLib = SampleTimeline.getLibrary();
      const tlBus = [];
      for (let t = 0; t < SampleTimeline.TRACKS; t++) {
        const g = oac.createGain(); g.gain.value = 1; g.connect(bus); tlBus.push(g);
      }
      tlClips.forEach(c => {
        const sample = tlLib.find(s => s.id === c.sampleId);
        if (!sample) return;
        const startTime = c.startBar * stepSec * stepsPerBar;
        if (startTime >= totalSteps * stepSec) return;   // outside the requested render length
        const src = oac.createBufferSource();
        src.buffer = sample.buffer;
        src.connect(tlBus[c.track]);
        const duration = Math.min(c.lengthBars * stepSec * stepsPerBar, sample.duration - c.offsetSec);
        if (duration > 0) src.start(startTime, c.offsetSec, duration);
      });
    }

    // Loops, repeated to fill the render.
    Looper.getSlots().forEach(slot => {
      if (!slot.buffer || slot.state !== 'playing') return;
      const g = oac.createGain();
      g.gain.value = slot.volume;
      g.connect(bus);
      const src = oac.createBufferSource();
      src.buffer = slot.buffer;
      src.loop = true;
      src.connect(g);
      src.start(0);
      src.stop(totalSteps * stepSec);
    });

    let rendered = await oac.startRendering();

    // Mastering already ends in an exact peak scale, so normalising on top
    // would be a second, redundant gain change.
    let masterReport = null;
    if (opts.master && typeof Mastering !== 'undefined') {
      const res = await Mastering.master(rendered);
      rendered = res.buffer;
      masterReport = res.report;
      return { rendered, norm: { applied: 1 }, seconds, totalBars, songMode, masterReport };
    }

    const norm = WavCodec.normalize(rendered, 0.98);
    return { rendered, norm, seconds, totalBars, songMode, masterReport };
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const bars = parseInt(barsSel.value, 10) || 8;
    const songMode = typeof Song !== 'undefined' && Song.isEnabled();
    msg((songMode ? 'Rendering the whole arrangement' : `Rendering ${bars} bars`) +
        (document.getElementById('masterToggle').checked ? ', then mastering…' : '…'));
    try {
      const wantMaster = document.getElementById('masterToggle').checked;
      const { rendered, norm, totalBars, masterReport } = await render(bars, { master: wantMaster });
      const blob = new Blob([WavCodec.encode(rendered)], { type: 'audio/wav' });

      const name = (document.getElementById('projName').value || 'bhs-track')
        .trim().replace(/[^a-z0-9 _-]/gi, '') || 'bhs-track';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.wav';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);

      const mb = (blob.size / 1048576).toFixed(1);
      let line = `Downloaded ${name}.wav — ${totalBars} bars, ${rendered.duration.toFixed(1)}s, ${mb}MB.`;
      if (masterReport) line += ' Mastered: ' + masterReport.summary + '.';
      else if (norm.applied < 1) line += ' Turned down slightly to stop it clipping.';
      msg(line);
    } catch (e) {
      msg('Export failed: ' + (e && e.message ? e.message : e), true);
    } finally {
      btn.disabled = false;
    }
  });

  // Exposed so the browser test can render without clicking through a download.
  window.__bhsRender = render;
})();
