// studio-claude.js — the chat drawer that actually edits the song.
//
// Claude's replies come back as tool calls, not prose to parse. Each one is
// applied here through the same Project calls the buttons make, so a change
// Claude makes is indistinguishable from one you made by hand — saved,
// exported and arranged the same way. Every value is clamped here, since the
// schemas on the server deliberately carry no ranges.

(function () {
  const form = document.getElementById('claudeForm');
  const input = document.getElementById('claudeInput');
  const log = document.getElementById('claudeLog');
  if (!form) return;

  const OFF = Project.OFF;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const varIndex = (letter) => Math.max(0, Project.NAMES.indexOf(String(letter || 'A').toUpperCase()));

  /** Find a track by the name Claude used — exact, then case-insensitive, then by drum role / instrument. */
  function findTrack(name) {
    const n = String(name || '').trim().toLowerCase();
    const ts = Project.tracks();
    return ts.find(t => t.name === name)
      || ts.find(t => t.name.toLowerCase() === n)
      || ts.find(t => t.kind === 'drum' && t.sound.role === n)
      || ts.find(t => t.kind === 'synth' && t.instrument === n)
      || ts.find(t => t.name.toLowerCase().startsWith(n))
      || null;
  }

  /** ". x X o 2 3 4" → step values (see Project.stepInfo). */
  function parsePattern(str) {
    return String(str || '').replace(/\s+/g, '').split('').map(c =>
      c === 'x' ? 2 : c === 'X' ? 3 : c === 'o' ? 1 : (c >= '2' && c <= '4') ? (+c) * 10 + 2 : false);
  }

  function say(who, text, cls) {
    const el = document.createElement('div');
    el.className = 'cmsg ' + who + (cls ? ' ' + cls : '');
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function snapshot() {
    return Object.assign(Project.serialize(), { mixer: Mixer.serialize(), playing: Transport.isPlaying });
  }

  const APPLY = {
    set_tempo(a) {
      Project.setBpm(clamp(a.bpm, 40, 220));
      return `tempo ${Project.bpm()} BPM`;
    },
    set_drum_pattern(a) {
      const t = findTrack(a.track);
      if (!t || t.kind !== 'drum') return null;
      const steps = typeof a.pattern === 'string' ? parsePattern(a.pattern) : (a.steps || []).map(Boolean);
      if (!steps.length) return null;
      Project.setPatternSteps(t.id, varIndex(a.variation), steps);
      return `${t.name} ${a.variation}`;
    },
    set_notes(a) {
      const t = findTrack(a.track);
      if (!t || t.kind !== 'synth') return null;
      const max = t.bars * Project.STEPS_PER_BAR;
      let notes = (a.notes || [])
        .filter(n => n && n.step >= 0 && n.step < max)
        .map(n => ({ s: n.step | 0, m: clamp(n.midi | 0, 12, 108), l: clamp(n.length | 0 || 1, 1, max - n.step), sl: !!n.slide }));
      if (Instruments.isMono(t.instrument)) {
        const seen = new Set();
        notes = notes.filter(n => !seen.has(n.s) && seen.add(n.s));
      }
      Project.setNotes(t.id, varIndex(a.variation), notes);
      return `${t.name} ${a.variation}`;
    },
    add_instrument(a) {
      if (!Instruments.list().some(i => i.id === a.instrument)) return null;
      const name = String(a.name || Instruments.label(a.instrument)).slice(0, 40);
      const t = Project.addTrack({ kind: 'synth', name, instrument: a.instrument, bars: [1, 2, 4].includes(a.bars) ? a.bars : 2 });
      return `added ${t.name}`;
    },
    add_drum_lane(a) {
      if (!DrumKits.ROLES.some(r => r.id === a.role)) return null;
      const t = Project.addTrack({ kind: 'drum', name: String(a.name || DrumKits.roleLabel(a.role)).slice(0, 40), sound: { kit: Project.kit(), role: a.role } });
      return `added ${t.name}`;
    },
    set_instrument(a) {
      const t = findTrack(a.track);
      if (!t || t.kind !== 'synth') return null;
      Project.setInstrument(t.id, a.instrument);
      return `${t.name} → ${Instruments.label(a.instrument)}`;
    },
    set_drum_kit(a) {
      if (!DrumKits.KITS[a.kit]) return null;
      Project.setKit(a.kit);
      return `kit ${DrumKits.KITS[a.kit].label}`;
    },
    set_pattern_length(a) {
      const t = findTrack(a.track);
      if (!t || t.kind === 'audio') return null;
      Project.setTrackBars(t.id, [1, 2, 4].includes(a.bars) ? a.bars : 1);
      return `${t.name} ${t.bars} bars`;
    },
    switch_variation(a) {
      const v = varIndex(a.variation);
      if (String(a.track).toLowerCase() === 'all') { Project.setAllLive(v); return `everything → ${a.variation}`; }
      const t = findTrack(a.track);
      if (!t || t.kind === 'audio') return null;
      Project.setLive(t.id, v);
      return `${t.name} → ${a.variation}`;
    },
    set_arrangement(a) {
      const secs = (a.sections || []).slice(0, 32);
      if (!secs.length) return null;
      const list = secs.map(spec => {
        const bars = clamp(spec.bars | 0 || 4, 1, 64);
        const cells = {}, solo = [];
        (spec.tracks || []).forEach(x => {
          const t = findTrack(x.track);
          if (!t) return;
          const v = t.kind === 'audio' ? 0 : varIndex(x.variation);
          cells[t.id] = new Array(bars).fill(v);
          (x.muted_bars || []).forEach(n => { if (n >= 1 && n <= bars) cells[t.id][n - 1] = OFF; });
          if (x.solo) solo.push(t.id);
        });
        return { name: spec.name, bars, cells, solo };
      });
      Project.replaceSections(list);
      if (a.play_song) Project.setMode('song');
      return `song structure (${secs.length} sections)`;
    },
    set_sound_param(a) {
      const t = findTrack(a.track);
      if (!t || t.kind !== 'synth') return null;
      const k = Instruments.knobs(t.instrument).find(x => x.id === a.param);
      if (!k) return null;
      Project.setParam(t.id, k.id, clamp(a.value, k.min, k.max));
      return `${t.name} ${k.label.toLowerCase()}`;
    },
    set_swing(a) {
      Project.setSwing(clamp(a.amount, 0, 0.6));
      return `swing ${Math.round(Project.swing() * 100)}%`;
    },
    set_key(a) {
      if (a.scale === 'none') { Project.setKey(null); return 'key cleared'; }
      Project.setKey({ root: clamp(a.root | 0, 0, 11), scale: a.scale });
      return 'key set';
    },
    set_pump(a) {
      const t = findTrack(a.track);
      if (!t) return null;
      Project.setPump(t.id, clamp(a.amount, 0, 0.9));
      return `${t.name} pump`;
    },
    mute_track(a) {
      const t = findTrack(a.track);
      if (!t) return null;
      Mixer.setMuted(t.id, !!a.muted);
      return `${t.name} ${a.muted ? 'muted' : 'unmuted'}`;
    },
    set_track_volume(a) {
      const t = findTrack(a.track);
      if (!t) return null;
      Mixer.setVolume(t.id, clamp(a.volume, 0, 1.5));
      return `${t.name} volume`;
    }
  };

  function applyAll(actions) {
    const done = [];
    actions.forEach(act => {
      const fn = APPLY[act.name];
      if (!fn) return;
      try {
        const label = fn(act.input || {});
        if (label) done.push(label);
      } catch (e) {
        console.error('Could not apply', act.name, e);
      }
    });
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

  window.__bhsApplyClaude = applyAll;
})();
