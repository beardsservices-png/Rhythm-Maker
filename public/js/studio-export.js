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

  async function render(totalBars) {
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
    const pattern = seq.pattern || [];
    const lanes = drums.lanes || [];
    const muted = drums.muted || [];
    const params = voice.params || {};

    // Bassline. Mirrors the live sequencer's logic, including holding a note
    // through the next step when that step slides into it.
    let held = null;
    const patLen = pattern.length || 16;
    for (let s = 0; s < totalSteps; s++) {
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
      lanes.forEach((lane, li) => {
        if (!lane || muted[li]) return;
        if (lane[s % (lane.length || 16)]) {
          RhythmAudio.renderVoice(oac, drumBuses, DRUM_LANES[li], t);
        }
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

    const rendered = await oac.startRendering();
    const norm = WavCodec.normalize(rendered, 0.98);
    return { rendered, norm, seconds };
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const bars = parseInt(barsSel.value, 10) || 8;
    msg(`Rendering ${bars} bars…`);
    try {
      const { rendered, norm } = await render(bars);
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
      msg(`Downloaded ${name}.wav — ${bars} bars, ${rendered.duration.toFixed(1)}s, ${mb}MB` +
          (norm.applied < 1 ? ' (turned down slightly to stop it clipping).' : '.'));
    } catch (e) {
      msg('Export failed: ' + (e && e.message ? e.message : e), true);
    } finally {
      btn.disabled = false;
    }
  });

  // Exposed so the browser test can render without clicking through a download.
  window.__bhsRender = render;
})();
