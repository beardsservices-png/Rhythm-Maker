// studio-claude.js — the chat box that actually edits the song.
//
// Claude's replies come back as tool calls, not prose to parse. Each one is
// applied here against the same modules the buttons drive, so a change Claude
// makes is indistinguishable from one you made by hand — including being
// saved, exported and undone the same way.

(function () {
  const form = document.getElementById('claudeForm');
  const input = document.getElementById('claudeInput');
  const log = document.getElementById('claudeLog');
  if (!form) return;

  const LANES = ['kick', 'snare', 'hat', 'openhat', 'clap', 'shaker'];
  const laneIndex = (name) => LANES.indexOf(name);
  const varIndex = (letter) => Math.max(0, Variations.NAMES.indexOf(letter));

  function say(who, text, cls) {
    const el = document.createElement('div');
    el.className = 'cmsg ' + who + (cls ? ' ' + cls : '');
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function collect(type) {
    const ev = new CustomEvent(type, { detail: {} });
    window.dispatchEvent(ev);
    return ev.detail;
  }

  /** Everything Claude needs to edit what's actually there. */
  function snapshot() {
    const drums = collect('bhs:collect-drums');
    const seq = collect('bhs:collect-sequencer');
    const voice = collect('bhs:collect-voice');
    const song = collect('bhs:collect-song');
    const st = Transport.getState();
    return {
      bpm: st.bpm,
      playing: Transport.isPlaying,
      drums: (drums.parts || []).map((p, i) => ({
        current: p.current, banks: p.banks, muted: !!(drums.muted || [])[i]
      })),
      bass: seq.part,
      voice: voice.params,
      song: song.song,
      loops: Looper.getSlots().filter(s => s.buffer)
        .map(s => ({ index: s.index, bars: s.bars, volume: +s.volume.toFixed(2) }))
    };
  }

  const APPLY = {
    set_tempo(a) {
      Transport.setBpm(a.bpm);
      const el = document.getElementById('seqBpm');
      if (el) { el.value = String(a.bpm); document.getElementById('seqBpmVal').textContent = a.bpm; }
      return `tempo → ${a.bpm} BPM`;
    },
    set_drum_pattern(a) {
      const li = laneIndex(a.lane);
      if (li < 0) return null;
      const bank = Variations.bank('drum:' + li, varIndex(a.variation));
      if (!bank) return null;
      for (let i = 0; i < 16; i++) bank[i] = !!a.steps[i];
      return `${a.lane} ${a.variation}`;
    },
    set_bass_pattern(a) {
      const bank = Variations.bank('bass', varIndex(a.variation));
      if (!bank) return null;
      for (let i = 0; i < 16; i++) {
        const n = a.notes[i];
        bank[i] = (n && typeof n.midi === 'number') ? { midi: n.midi, slide: !!n.slide } : null;
      }
      return `bassline ${a.variation}`;
    },
    switch_variation(a) {
      const v = varIndex(a.variation);
      if (a.part === 'all') { Variations.selectAll(v); return `everything → ${a.variation}`; }
      const id = a.part === 'bass' ? 'bass' : 'drum:' + laneIndex(a.part);
      Variations.select(id, v);
      return `${a.part} → ${a.variation}`;
    },
    set_arrangement(a) {
      Song.setBlocks(a.sections.map(s => ({ v: varIndex(s.variation), bars: s.bars })));
      Song.setEnabled(!!a.enable);
      return `arrangement (${a.sections.length} sections)`;
    },
    set_voice_param(a) {
      const cur = collect('bhs:collect-voice').params || {};
      cur[a.param] = a.value;
      window.dispatchEvent(new CustomEvent('bhs:apply-voice', { detail: { params: cur } }));
      return `808 ${a.param}`;
    },
    mute_lane(a) {
      const li = laneIndex(a.lane);
      if (li < 0) return null;
      window.dispatchEvent(new CustomEvent('bhs:set-drum-mute', {
        detail: { lane: li, muted: !!a.muted }
      }));
      return `${a.lane} ${a.muted ? 'muted' : 'unmuted'}`;
    },
    set_loop_volume(a) {
      Looper.setVolume(a.slot - 1, a.volume);
      return `loop ${a.slot} volume`;
    }
  };

  function applyAll(actions) {
    const done = [];
    actions.forEach(act => {
      const fn = APPLY[act.name];
      if (!fn) return;
      try {
        const label = fn(act.input);
        if (label) done.push(label);
      } catch (e) {
        console.error('Could not apply', act.name, e);
      }
    });
    // One redraw after the batch rather than per action.
    window.dispatchEvent(new CustomEvent('bhs:refresh-views'));
    return done;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    say('you', message);
    const thinking = say('claude', 'Thinking…', 'pending');

    try {
      const res = await fetch('/api/studio-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, state: snapshot() })
      });
      const data = await res.json();
      thinking.remove();

      if (!res.ok) { say('claude', data.error || 'Something went wrong.', 'bad'); return; }

      const changed = applyAll(data.actions || []);
      say('claude', data.reply || 'Done.');
      if (changed.length) say('claude', 'Changed: ' + changed.join(', '), 'meta');
      else if (!(data.actions || []).length) say('claude', 'Nothing was changed.', 'meta');
    } catch (err) {
      thinking.remove();
      say('claude', 'Could not reach the server.', 'bad');
    }
  });
})();
