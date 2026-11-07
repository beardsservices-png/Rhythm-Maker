// studio-preview.js — hear a sound before choosing it.
//
// A tiny ▶ next to every place a sound is picked: the + Add instrument menus
// (instruments, drum lanes, the sound library), a track's Sound box, a drum
// lane's sound box, a pad's sound box and the keyboard dock. It plays the
// sound without adding it or changing anything in the song.
//
//   Preview.play({ instrument: 'real-piano' })           a short chord, or one note for a bass
//   Preview.play({ sound: { kit: 'studio', role: 'snare' } })   a drum hit or a library sound
//   Preview.button(() => spec)                           a ▶ button that plays whatever spec() says now
//
// Recorded sounds are downloaded first (the ▶ shows … meanwhile) so what you
// hear is the real recording, not the synth stand-in. Each preview goes through
// its own little gain node, so starting another one fades the last out, and a
// long loop never keeps playing under the next sound.

const Preview = (() => {
  let current = null;     // the gain node of the preview playing now
  let token = 0;          // a newer preview cancels one still downloading

  function fadeOut(node, ac) {
    try {
      node.gain.cancelScheduledValues(ac.currentTime);
      node.gain.setTargetAtTime(0, ac.currentTime, 0.03);
    } catch (_) { /* already gone */ }
    setTimeout(() => { try { node.disconnect(); } catch (_) { /* already gone */ } }, 500);
  }

  function begin(ac) {
    if (current) fadeOut(current, ac);
    const g = ac.createGain();
    g.gain.value = 1;
    const master = typeof Mixer !== 'undefined' && Mixer.masterNode ? Mixer.masterNode() : null;
    g.connect(master || ac.destination);
    current = g;
    return g;
  }

  /** The note a preview plays: the middle of the instrument's own range. */
  function noteFor(id) {
    const r = Instruments.range(id) || [48, 84];
    return Math.round((r[0] + r[1]) / 2);
  }

  function playInstrument(ac, id) {
    const g = begin(ac);
    const root = noteFor(id);
    const r = Instruments.range(id) || [48, 84];
    const bassy = r[1] <= 64;                       // basses play one note, not a chord
    const steps = bassy ? [0] : [0, 4, 7];
    const t0 = ac.currentTime + 0.03;
    const params = Instruments.defaults(id);
    steps.forEach((st, i) => {
      const h = Instruments.noteOn(ac, g, id, root + st, 0.8, t0 + i * 0.16, params);
      if (h && h.release) h.release(t0 + 1.1 + i * 0.16);
    });
  }

  function playSound(ac, sound) {
    const g = begin(ac);
    if (sound.kit === 'lib') {
      Samples.libShot(ac, g, sound.role, ac.currentTime + 0.02, 0.9, { bpm: Project.bpm(), maxSeconds: 3 });
    } else {
      DrumKits.hit(ac, g, sound, ac.currentTime + 0.02, 0.95);
    }
  }

  /** Download what the sound needs, then resolve. */
  function ready(spec) {
    if (typeof Samples === 'undefined') return Promise.resolve();
    if (spec.instrument) {
      return Samples.hasInstrument(spec.instrument) && !Samples.instrumentReady(spec.instrument)
        ? Samples.loadInstrument(spec.instrument) : Promise.resolve();
    }
    const s = spec.sound;
    if (!s) return Promise.resolve();
    if (s.kit === 'lib') return Samples.loadLib(s.role);
    const name = DrumKits.sampleOf(s);
    return name ? Samples.loadDrum(name) : Promise.resolve();
  }

  /** Play a spec. Resolves when the sound has started (or was replaced by a newer one). */
  function play(spec) {
    const ac = App.ensureAudio();           // inside the click, so the browser allows sound
    if (!ac || !spec || !(spec.instrument || spec.sound)) return Promise.resolve(false);
    const mine = ++token;
    return ready(spec).catch(() => null).then(() => {
      if (mine !== token) return false;
      if (spec.instrument) playInstrument(ac, spec.instrument); else playSound(ac, spec.sound);
      return true;
    });
  }

  /** A small ▶ that previews whatever getSpec() returns when it is pressed. */
  function button(getSpec, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pv';
    b.textContent = '▶';
    b.title = label || 'Hear this sound (doesn’t add or change anything)';
    b.setAttribute('aria-label', 'Hear this sound');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const spec = getSpec();
      if (!spec) return;
      b.classList.add('loading');
      b.textContent = '…';
      play(spec).finally(() => { b.classList.remove('loading'); b.textContent = '▶'; });
    });
    // Never let a press on ▶ start a drag, select a lane, or close a menu.
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }

  return { play, button };
})();
