// studio-voice.js — keeps every audio track's pitch-corrected copy up to date.
//
// Tune (engine/tune.js) works on a whole take at once, so it runs whenever its
// inputs change: Tune switched on or changed, the song's key changed (the
// notes it snaps to), or the take's audio arrived (e.g. after opening a song).
// The corrected copy is never saved — it's rebuilt from the original, which
// stays untouched, so switching Tune off always gives you the raw take back.

(function () {
  if (typeof Tune === 'undefined') return;
  const made = new Map();     // trackId -> signature of the copy it has (or is making)

  const keySig = () => { const k = Project.key(); return k ? k.root + k.scale : 'chromatic'; };

  function check() {
    Project.tracks().forEach(t => {
      if (t.kind !== 'audio' || !t.tune) { made.delete(t.id); return; }
      const raw = Project.getAudio(t.audioId);
      if (!raw) return;
      const sig = t.audioId + '|' + t.tune + '|' + keySig();
      if (made.get(t.id) === sig && Project.hasProcessed(t.id)) return;
      if (made.get(t.id) === sig) return;           // already being made
      made.set(t.id, sig);
      App.msg(`Tuning "${t.name}"…`);
      // Let the message paint before the (second or two of) number crunching.
      setTimeout(() => {
        const cur = Project.track(t.id);
        if (!cur || made.get(t.id) !== sig) return;
        const ac = Sequencer.context() || Synth808.ensureContext();
        try {
          const res = Tune.process(ac, raw, { key: Project.key(), mode: cur.tune });
          if (made.get(t.id) !== sig) return;
          Project.setProcessed(t.id, res.buffer);
          App.msg(res.voicedShare < 0.05
            ? `"${t.name}" has almost no singing in it to tune — Tune works on a voice or a single melody line.`
            : `"${t.name}" is tuned${Project.key() ? ' to the song\'s key' : ' to the nearest notes (pick a Key in the piano roll to keep it in key)'}.`);
        } catch (e) {
          console.error(e);
          made.delete(t.id);
          App.msg('Tune failed on this clip: ' + (e && e.message ? e.message : e), true);
        }
      }, 30);
    });
  }

  Project.on((r) => { if (['tune', 'key', 'load', 'audio', 'tracks'].includes(r)) check(); });
  window.__bhsTune = { pending: () => Array.from(made.keys()).some(id => !Project.hasProcessed(id)) };
})();
