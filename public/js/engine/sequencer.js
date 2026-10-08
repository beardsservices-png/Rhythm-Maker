// sequencer.js — turns the Project into sound, one sixteenth at a time.
//
// One PLAYER walks every track on every step: drum lanes fire hits, melodic
// tracks start notes, audio tracks queue a bar of their clip. The same player
// runs live (driven by the Transport, into the mixer strips) and offline
// (driven by a plain loop, into an OfflineAudioContext for the .wav export) —
// so the file you download is the arrangement you heard, by construction.
//
// What plays where is decided per bar:
//   pattern mode — each track's live pattern, looping at its own length
//   song mode    — the section's cell for that track and bar (or OFF), with
//                  the section's solo applied. Patterns restart at each
//                  section, so a 2-bar riff always starts on its section.
//
// Audio tracks are queued ONE BAR AT A TIME (buffer offset = where that bar
// sits in the clip). That makes bar mutes, section changes and pause/resume
// trivially exact — there is no long-running source to keep in phase.

const Sequencer = (() => {
  const SPB = 16;

  function cut(h, when) {
    if (!h) return;
    if (h.cut) h.cut(when); else if (!h.stopped) h.release(when);
  }

  /**
   * @param target {ac, out(trackId) -> AudioNode, live?: bool, audible?(trackId) -> bool}
   */
  function createPlayer(target) {
    const ac = target.ac;
    let abs = 0;
    let fresh = true;
    const mono = new Map();      // trackId -> { h, end }
    const poly = [];             // { h, end(time) }
    const sources = new Set();

    function stateFor(t, ev) {
      if (ev.songMode) return Project.songStateAt(t, ev.bar);
      return { v: t.live, phase: ev.bar };
    }

    function playAudioBar(t, st, ev) {
      const buf = Project.getAudio(t.audioId);
      if (!buf) return;
      const barSec = SPB * ev.stepDur;
      const into = ev.stepInBar * ev.stepDur;
      const offset = (((st.phase % t.bars) + t.bars) % t.bars) * barSec + into;
      if (offset >= buf.duration) return;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = t.gain == null ? 1 : t.gain;
      src.connect(g).connect(target.out(t.id));
      src.start(ev.time, offset, Math.min(barSec - into, buf.duration - offset));
      sources.add(src);
      src.onended = () => sources.delete(src);
    }

    function playNotes(t, pat, idx, ev) {
      const out = target.out(t.id);
      if (t.instrument === '808' || Instruments.isMono(t.instrument)) {
        const n = pat.find(x => x.s === idx);
        if (!n) return;
        const cur = mono.get(t.id);
        const vel = n.vel == null ? 0.9 : n.vel;
        if (n.sl && cur && !cur.h.stopped && cur.end >= abs) {
          // Glide the note that's still sounding instead of restarting it —
          // the 808 slide.
          cur.h.slideTo(n.m, Math.min(0.12, ev.stepDur * 0.7), ev.time);
          cur.end = abs + n.l;
        } else {
          if (cur && !cur.h.stopped) cur.h.release(ev.time);
          const h = Instruments.noteOn(ac, out, t.instrument, n.m, vel, ev.time, t.params);
          if (h) mono.set(t.id, { h, end: abs + n.l });
        }
        return;
      }
      for (const n of pat) {
        if (n.s !== idx) continue;
        const h = Instruments.noteOn(ac, out, t.instrument, n.m, n.vel == null ? 0.85 : n.vel, ev.time, t.params);
        if (!h) continue;
        const end = ev.time + n.l * ev.stepDur;
        h.release(end);
        poly.push({ h, end });
      }
    }

    /**
     * @param ev {time, bar, stepInBar, stepDur, songMode}
     */
    function step(ev) {
      if (target.live && ev.stepInBar === 0 && !ev.songMode) Project.applyPending();
      for (const t of Project.tracks()) {
        if (target.audible && !target.audible(t.id)) continue;
        const st = stateFor(t, ev);
        if (t.kind === 'audio') {
          if (st.v >= 0 && (ev.stepInBar === 0 || fresh)) playAudioBar(t, st, ev);
          continue;
        }
        if (st.v < 0 || !t.patterns) continue;
        const pat = t.patterns[st.v];
        if (!pat) continue;
        const len = t.bars * SPB;
        const idx = ((((st.phase % t.bars) + t.bars) % t.bars) * SPB + ev.stepInBar) % len;
        if (t.kind === 'drum') {
          if (pat[idx]) DrumKits.hit(ac, target.out(t.id), t.sound, ev.time, 1);
        } else {
          playNotes(t, pat, idx, ev);
        }
      }
      // Mono notes end when their length runs out — unless a slide on this
      // very step picked them up, which playNotes has already done.
      mono.forEach((m) => {
        if (!m.h.stopped && m.end <= abs) m.h.release(ev.time - ev.stepDur * 0.08);
      });
      if (poly.length > 64) {
        const now = ac.currentTime;
        for (let i = poly.length - 1; i >= 0; i--) if (poly[i].end < now) poly.splice(i, 1);
      }
      fresh = false;
      abs++;
    }

    function stopAll() {
      const now = ac.currentTime;
      mono.forEach(m => cut(m.h, now));
      mono.clear();
      poly.forEach(p => cut(p.h, now));
      poly.length = 0;
      sources.forEach(s => { try { s.stop(now + 0.01); } catch (_) {} });
      sources.clear();
      abs = 0;
      fresh = true;
    }

    return { step, stopAll };
  }

  // ── live wiring ────────────────────────────────────────────────────
  let ctx = null;
  let live = null;
  let liveBus = null;                 // everything played by hand, for recording
  const liveIns = new Map();          // trackId -> GainNode
  const history = [];                 // recent scheduled steps, for note recording
  let wasPlaying = false;

  function syncMixer() {
    if (!ctx) return;
    const ids = new Set(Project.tracks().map(t => t.id));
    Project.tracks().forEach(t => {
      if (!Mixer.get(t.id)) {
        Mixer.addTrack(t.id, t.name, { volume: t.kind === 'drum' ? 0.85 : 0.8 });
      } else {
        Mixer.setLabel(t.id, t.name);
      }
    });
    Mixer.ids().forEach(id => {
      if (!ids.has(id)) {
        Mixer.removeTrack(id);
        const li = liveIns.get(id);
        if (li) { li.disconnect(); liveIns.delete(id); }
      }
    });
    Mixer.setOrder(Project.tracks().map(t => t.id));
  }

  function syncLoop() {
    if (Project.mode() === 'song') Transport.setLoop(0, Math.max(1, Project.songBars()) * SPB, true);
    else Transport.setLoop(0, SPB, false);
  }

  function init() {
    if (ctx) return ctx;
    ctx = Synth808.ensureContext();
    if (!ctx) return null;
    Mixer.init(ctx);
    liveBus = ctx.createGain();
    syncMixer();
    live = createPlayer({ ac: ctx, out: (id) => Mixer.input(id), live: true });

    Transport.onStep((ev) => {
      const st = Transport.getState();
      const e = { time: ev.time, bar: ev.bar, stepInBar: ev.stepInBar, stepDur: st.secondsPerStep, songMode: Project.mode() === 'song' };
      live.step(e);
      history.push(e);
      if (history.length > 48) history.shift();
    });
    Transport.onStateChange((s) => {
      if (wasPlaying && !s.playing) { live.stopAll(); history.length = 0; }
      wasPlaying = s.playing;
    });

    Project.on((reason) => {
      if (reason === 'load') {
        // A different song: start every strip from its defaults rather than
        // inheriting the last song's faders.
        Mixer.ids().forEach(id => Mixer.removeTrack(id));
        liveIns.forEach(g => g.disconnect());
        liveIns.clear();
      }
      if (reason === 'tracks' || reason === 'load') syncMixer();
      if (reason === 'mode' || reason === 'sections' || reason === 'load') syncLoop();
    });
    syncLoop();
    Transport.setBpm(Project.bpm());
    return ctx;
  }

  /**
   * Where hand-played notes for a track go in: through the track's own mixer
   * strip (so its fader and effects apply) and also to the live bus the
   * recorder can capture — "record what I'm playing" without the beat.
   */
  function liveInput(trackId) {
    if (!init()) return null;
    let g = liveIns.get(trackId);
    if (!g) {
      g = ctx.createGain();
      g.connect(Mixer.input(trackId));
      g.connect(liveBus);
      liveIns.set(trackId, g);
    }
    return g;
  }

  /** The scheduled step nearest an audio-clock time — for quantising recorded notes. */
  function stepAt(time) {
    let best = null, d = Infinity;
    history.forEach(e => { const x = Math.abs(e.time - time); if (x < d) { d = x; best = e; } });
    return best;
  }

  /** Which pattern + step index a track is on during a scheduled step. */
  function trackPosition(t, e) {
    const st = e.songMode ? Project.songStateAt(t, e.bar) : { v: t.live, phase: e.bar };
    const idx = ((((st.phase % t.bars) + t.bars) % t.bars) * SPB + e.stepInBar);
    return { v: st.v, idx };
  }

  return {
    createPlayer, init, liveInput, stepAt, trackPosition,
    liveBus: () => liveBus,
    context: () => ctx
  };
})();
