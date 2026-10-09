// project-model.js — the song itself: tracks, their patterns, and the sections
// that say what each track does over time.
//
// THE MODEL (the groovebox / Ableton-session / FL-playlist idea):
//
//   TRACK   one instrument — a drum lane, a melodic instrument, or an audio
//           clip. Every drum lane is its own track, so the hats and the snare
//           can be arranged separately.
//   PATTERN each track owns four: A, B, C, D. A pattern is 1, 2 or 4 bars.
//   SECTION a named stretch of the song ("Verse", 8 bars). For EVERY track,
//           every bar of a section holds which pattern plays there, or OFF.
//           So one section can be Kick A + Clap C + Hat B, and the snare can
//           sit out bars 3–4 and come back. A section can also SOLO tracks.
//
// The old studio flipped every instrument to the same letter at once — "A then
// B" — which made two beats, not a song. Storing a letter per track per bar is
// what fixes that, and keeping it inside sections means moving, resizing or
// duplicating a section carries its whole layout with it.
//
// Two ways to play: PATTERN mode loops whatever each track is set to live
// (jamming, building parts); SONG mode plays the sections in order.

const Project = (() => {
  const STEPS_PER_BAR = 16;
  const NAMES = ['A', 'B', 'C', 'D'];
  const COUNT = 4;
  const OFF = -1;

  let state = null;
  const audio = new Map();      // audioId -> AudioBuffer (never serialised)
  const processed = new Map();  // trackId -> pitch-corrected copy of its take (rebuilt, never saved)
  const listeners = new Set();

  function emit(reason, detail) {
    listeners.forEach(fn => { try { fn(reason, detail); } catch (e) { console.error(e); } });
  }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));
  function newId() { return 't' + (state.nextId++); }

  function blankPattern(kind, bars) {
    return kind === 'drum' ? new Array(bars * STEPS_PER_BAR).fill(false) : [];
  }

  // ── tracks ─────────────────────────────────────────────────────────
  function tracks() { return state.tracks; }
  function track(id) { return state.tracks.find(t => t.id === id) || null; }

  function makeTrack(spec) {
    const kind = spec.kind;
    const bars = spec.bars || 1;
    const t = {
      id: spec.id || newId(),
      kind,
      name: spec.name || 'Track',
      bars,
      live: kind === 'audio' && spec.live == null ? 0 : (spec.live == null ? 0 : spec.live),
      pending: null,
      edit: 0
    };
    if (kind === 'drum') t.sound = Object.assign({ kit: state.kit, role: 'kick' }, spec.sound || {});
    if (kind === 'synth') {
      t.instrument = spec.instrument || '808';
      t.params = Object.assign(Instruments.defaults(t.instrument), spec.params || {});
    }
    if (kind === 'audio') {
      t.audioId = spec.audioId;
      t.gain = spec.gain == null ? 1 : spec.gain;
    }
    if (kind !== 'audio') t.patterns = Array.from({ length: COUNT }, () => blankPattern(kind, bars));
    return t;
  }

  function addTrack(spec) {
    const t = makeTrack(spec);
    // Drum lanes stay together at the top, like a drum machine.
    if (t.kind === 'drum') {
      let at = -1;
      state.tracks.forEach((x, i) => { if (x.kind === 'drum') at = i; });
      state.tracks.splice(at + 1, 0, t);
    } else {
      state.tracks.push(t);
    }
    const fill = spec.cell == null ? 0 : spec.cell;
    state.sections.forEach(s => { s.cells[t.id] = new Array(s.bars).fill(fill); });
    emit('tracks', { added: t.id });
    return t;
  }

  function removeTrack(id) {
    const i = state.tracks.findIndex(t => t.id === id);
    if (i < 0) return;
    const [t] = state.tracks.splice(i, 1);
    state.sections.forEach(s => { delete s.cells[id]; s.solo = s.solo.filter(x => x !== id); });
    if (t.kind === 'audio' && !state.tracks.some(x => x.audioId === t.audioId)) audio.delete(t.audioId);
    emit('tracks', { removed: id });
  }

  function renameTrack(id, name) {
    const t = track(id); if (!t) return;
    t.name = String(name || '').slice(0, 40) || t.name;
    emit('tracks');
  }

  function moveTrack(id, dir) {
    const i = state.tracks.findIndex(t => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.tracks.length) return;
    [state.tracks[i], state.tracks[j]] = [state.tracks[j], state.tracks[i]];
    emit('tracks');
  }

  /** Pattern length in bars. Growing repeats what's there, so it keeps playing the same. */
  function setTrackBars(id, bars) {
    const t = track(id); if (!t) return;
    bars = Math.max(1, Math.min(t.kind === 'audio' ? 64 : 4, bars | 0));
    if (bars === t.bars) return;
    if (t.patterns) {
      const oldSteps = t.bars * STEPS_PER_BAR, newSteps = bars * STEPS_PER_BAR;
      t.patterns = t.patterns.map(p => {
        if (t.kind === 'drum') {
          const out = new Array(newSteps).fill(false);
          for (let i = 0; i < newSteps; i++) out[i] = p[i % oldSteps] || false;
          return out;
        }
        const out = [];
        for (let rep = 0; rep * oldSteps < newSteps; rep++) {
          p.forEach(n => { const s = n.s + rep * oldSteps; if (s < newSteps) out.push(Object.assign({}, n, { s, l: Math.min(n.l, newSteps - s) })); });
        }
        return out;
      });
    }
    t.bars = bars;
    emit('pattern', { track: id });
  }

  function setSound(id, sound) {
    const t = track(id); if (!t || t.kind !== 'drum') return;
    t.sound = Object.assign({}, t.sound, sound);
    emit('sound', { track: id });
  }

  function setInstrument(id, instrument) {
    const t = track(id); if (!t || t.kind !== 'synth') return;
    t.instrument = instrument;
    t.params = Instruments.defaults(instrument);
    emit('sound', { track: id });
  }

  function setParam(id, key, value) {
    const t = track(id); if (!t || !t.params) return;
    t.params[key] = value;
    emit('param', { track: id, key });
  }

  function setKit(kit) {
    if (!DrumKits.KITS[kit]) return;
    state.kit = kit;
    state.tracks.forEach(t => { if (t.kind === 'drum') t.sound.kit = kit; });
    emit('sound', { kit });
  }

  // ── patterns ───────────────────────────────────────────────────────
  function pattern(id, v) {
    const t = track(id);
    return t && t.patterns ? t.patterns[v] : null;
  }

  function toggleStep(id, v, i) {
    const p = pattern(id, v); if (!p) return false;
    p[i] = !p[i];
    emit('pattern', { track: id });
    return p[i];
  }

  function setNotes(id, v, notes) {
    const t = track(id); if (!t || t.kind !== 'synth') return;
    const max = t.bars * STEPS_PER_BAR;
    t.patterns[v] = notes
      .filter(n => n && n.s >= 0 && n.s < max)
      .map(n => ({ s: n.s | 0, m: n.m | 0, l: Math.max(1, Math.min(max - n.s, n.l | 0 || 1)), sl: !!n.sl,
                   vel: n.vel == null ? undefined : clamp(n.vel, 0.05, 1), pan: n.pan ? clamp(n.pan, -1, 1) : undefined }));
    emit('pattern', { track: id });
  }

  function setPatternSteps(id, v, steps) {
    const t = track(id); if (!t || t.kind !== 'drum') return;
    const n = t.bars * STEPS_PER_BAR;
    const out = new Array(n).fill(false);
    // levels, rolls, and per-hit volume/pan survive
    const keep = (x) => (x && typeof x === 'object' ? (x.c > 0 ? x : false) : typeof x === 'number' ? (x > 0 ? x : false) : !!x);
    for (let i = 0; i < n; i++) out[i] = keep(steps[i % Math.max(1, steps.length)]);
    t.patterns[v] = out;
    emit('pattern', { track: id });
  }

  function clearPattern(id, v) {
    const t = track(id); if (!t || !t.patterns) return;
    t.patterns[v] = blankPattern(t.kind, t.bars);
    emit('pattern', { track: id });
  }

  function copyPattern(id, from, to) {
    const t = track(id); if (!t || !t.patterns || from === to) return;
    t.patterns[to] = clone(t.patterns[from]);
    emit('pattern', { track: id });
  }

  // ── live (pattern mode) and edit selection ─────────────────────────
  /**
   * In pattern mode this is "switch what this track plays" — queued to the
   * next bar while playing so it never lands mid-beat. It also sets which
   * pattern the editor shows, so what you hear is what you're editing.
   * In song mode the arrangement decides what plays; this only picks what to edit.
   */
  function setLive(id, v) {
    const t = track(id); if (!t) return;
    if (t.kind !== 'audio') t.edit = Math.max(0, v);
    if (state.mode === 'pattern') {
      const playing = typeof Transport !== 'undefined' && Transport.isPlaying;
      if (!playing || t.live === v) { t.live = v; t.pending = null; }
      else t.pending = v;
    }
    emit('live', { track: id });
  }

  function setEdit(id, v) {
    const t = track(id); if (!t || t.kind === 'audio') return;
    t.edit = v;
    emit('live', { track: id });
  }

  function setAllLive(v) {
    state.tracks.forEach(t => { if (t.kind !== 'audio') setLive(t.id, v); });
  }

  /** Called by the sequencer on each bar line. */
  function applyPending() {
    let changed = false;
    state.tracks.forEach(t => {
      if (t.pending != null) { t.live = t.pending; t.pending = null; changed = true; }
    });
    if (changed) emit('live');
  }

  // ── sections ───────────────────────────────────────────────────────
  function sections() { return state.sections; }
  function section(id) { return state.sections.find(s => s.id === id) || null; }

  /** The letter a track mostly plays in a section — what an unmuted bar goes back to. */
  function mainLetter(sec, trackId) {
    const cells = sec.cells[trackId] || [];
    const counts = [0, 0, 0, 0];
    cells.forEach(v => { if (v >= 0) counts[v]++; });
    let best = OFF, n = 0;
    counts.forEach((c, v) => { if (c > n) { n = c; best = v; } });
    if (best === OFF && sec.last && sec.last[trackId] != null) return sec.last[trackId];
    return best;
  }

  function makeSection(name, bars, from) {
    const s = { id: 's' + (state.nextId++), name, bars, solo: [], cells: {} };
    state.tracks.forEach(t => {
      const v = from ? mainLetter(from, t.id) : 0;
      s.cells[t.id] = new Array(bars).fill(v);
    });
    if (from) s.solo = from.solo.slice();
    return s;
  }

  function addSection(afterIndex, name, bars) {
    const i = afterIndex == null ? state.sections.length - 1 : afterIndex;
    const from = state.sections[i] || null;
    const s = makeSection(name || ('Section ' + (state.sections.length + 1)), bars || (from ? from.bars : 4), from);
    state.sections.splice(i + 1, 0, s);
    emit('sections');
    return s;
  }

  function duplicateSection(index) {
    const src = state.sections[index]; if (!src) return null;
    const s = clone(src);
    s.id = 's' + (state.nextId++);
    s.name = src.name + ' 2';
    state.sections.splice(index + 1, 0, s);
    emit('sections');
    return s;
  }

  function removeSection(index) {
    if (state.sections.length <= 1) return;
    state.sections.splice(index, 1);
    emit('sections');
  }

  function moveSection(index, dir) {
    const j = index + dir;
    if (j < 0 || j >= state.sections.length) return;
    const a = state.sections;
    [a[index], a[j]] = [a[j], a[index]];
    emit('sections');
  }

  function renameSection(id, name) {
    const s = section(id); if (!s) return;
    s.name = String(name || '').slice(0, 24) || s.name;
    emit('sections');
  }

  function setSectionBars(id, bars) {
    const s = section(id); if (!s) return;
    bars = Math.max(1, Math.min(64, bars | 0));
    if (bars === s.bars) return;
    Object.keys(s.cells).forEach(tid => {
      const c = s.cells[tid];
      const fill = mainLetter(s, tid);
      if (bars > c.length) while (c.length < bars) c.push(fill);
      else c.length = bars;
    });
    s.bars = bars;
    emit('sections');
  }

  function setCell(secId, trackId, bar, v) {
    const s = section(secId); if (!s || !s.cells[trackId]) return;
    if (bar < 0 || bar >= s.bars) return;
    remember(s, trackId);
    s.cells[trackId][bar] = v;
    emit('cells', { section: secId, track: trackId });
  }

  // Remember the last letter a track played in a section, so muting every bar
  // and unmuting one brings back the right pattern rather than A.
  function remember(s, trackId) {
    const m = mainLetter(s, trackId);
    if (m >= 0) { s.last = s.last || {}; s.last[trackId] = m; }
  }

  /** Set the letter a track plays for a whole section. Muted bars stay muted. */
  function setSectionTrack(secId, trackId, v) {
    const s = section(secId); if (!s || !s.cells[trackId]) return;
    remember(s, trackId);
    const c = s.cells[trackId];
    const anyOn = c.some(x => x >= 0);
    for (let i = 0; i < c.length; i++) {
      if (v === OFF) c[i] = OFF;
      else if (!anyOn || c[i] >= 0) c[i] = v;
    }
    emit('cells', { section: secId, track: trackId });
  }

  function toggleBarMute(secId, trackId, bar) {
    const s = section(secId); if (!s || !s.cells[trackId]) return;
    const c = s.cells[trackId];
    if (c[bar] >= 0) { remember(s, trackId); c[bar] = OFF; }
    else { const m = mainLetter(s, trackId); c[bar] = m >= 0 ? m : 0; }
    emit('cells', { section: secId, track: trackId });
  }

  function toggleSolo(secId, trackId) {
    const s = section(secId); if (!s) return;
    const i = s.solo.indexOf(trackId);
    if (i >= 0) s.solo.splice(i, 1); else s.solo.push(trackId);
    emit('cells', { section: secId, track: trackId });
  }

  /** Replace the whole structure at once. list: [{ name, bars, cells: {trackId: [v…]}, solo: [ids] }] */
  function replaceSections(list) {
    if (!list || !list.length) return;
    state.sections = list.map((x, i) => {
      const bars = Math.max(1, Math.min(64, x.bars | 0 || 4));
      const s = { id: 's' + (state.nextId++), name: String(x.name || ('Section ' + (i + 1))).slice(0, 24), bars, solo: (x.solo || []).filter(id => track(id)), cells: {} };
      state.tracks.forEach(t => {
        const src = (x.cells || {})[t.id];
        s.cells[t.id] = Array.from({ length: bars }, (_, b) => (src && src[b] != null ? src[b] : OFF));
      });
      return s;
    });
    emit('sections');
  }

  // ── timeline view: the song as one long row of bars per track ───────
  //
  // Sections still hold the data, but the timeline edits by absolute song bar
  // (0 = first bar of the song), like a video editor's time ruler.

  function cellAt(trackId, gbar) {
    let b = gbar;
    for (const s of state.sections) {
      if (b < s.bars) { const c = s.cells[trackId]; return c && c[b] != null ? c[b] : OFF; }
      b -= s.bars;
    }
    return OFF;
  }

  /** Make the song at least `total` bars long by stretching the last section. */
  function extendTo(total) {
    const have = songBars();
    if (total <= have || !state.sections.length) return;
    const last = state.sections[state.sections.length - 1];
    const add = total - have;
    Object.keys(last.cells).forEach(id => { for (let i = 0; i < add; i++) last.cells[id].push(OFF); });
    state.tracks.forEach(t => { if (!last.cells[t.id]) last.cells[t.id] = new Array(last.bars + add).fill(OFF); });
    last.bars += add;
  }

  /** Apply many cell edits at once: [{ track, bar (song bar), v }]. One undo step, one redraw. */
  function setCells(edits) {
    if (!edits || !edits.length) return;
    const maxBar = Math.max(...edits.map(e => e.bar));
    if (maxBar >= songBars()) extendTo(maxBar + 1);
    edits.forEach(({ track: id, bar, v }) => {
      if (bar < 0) return;
      let b = bar;
      for (const s of state.sections) {
        if (b < s.bars) { if (s.cells[id]) s.cells[id][b] = v; break; }
        b -= s.bars;
      }
    });
    emit('sections');
  }

  /** The clips on a track: runs of the same pattern across consecutive bars. */
  function runs(trackId) {
    const out = [];
    const total = songBars();
    let cur = null;
    for (let b = 0; b < total; b++) {
      const v = cellAt(trackId, b);
      if (cur && v === cur.v) { cur.len++; continue; }
      if (cur) out.push(cur);
      cur = v >= 0 ? { start: b, len: 1, v } : null;
    }
    if (cur) out.push(cur);
    return out;
  }

  function songBars() { return state.sections.reduce((n, s) => n + s.bars, 0); }

  function sectionStart(index) {
    let b = 0;
    for (let i = 0; i < index; i++) b += state.sections[i].bars;
    return b;
  }

  /** Which section an absolute song bar falls in. Wraps, since the song loops. */
  function locate(bar) {
    const total = songBars();
    if (!total) return null;
    let b = ((bar % total) + total) % total;
    for (let i = 0; i < state.sections.length; i++) {
      const s = state.sections[i];
      if (b < s.bars) return { index: i, section: s, barIn: b };
      b -= s.bars;
    }
    return null;
  }

  /**
   * What a track plays at a song bar: { v, phase } where v is the pattern
   * index or OFF, and phase is the bar within the section — patterns and
   * audio restart at each section, so a 2-bar riff lines up with its section.
   */
  function songStateAt(t, bar) {
    const loc = locate(bar);
    if (!loc) return { v: OFF, phase: 0 };
    const s = loc.section;
    const cells = s.cells[t.id];
    let v = cells ? cells[loc.barIn] : 0;
    if (v == null) v = 0;
    if (s.solo.length && !s.solo.includes(t.id)) v = OFF;
    return { v, phase: loc.barIn, section: s, sectionIndex: loc.index };
  }

  // ── drum steps: off, soft, normal, accent, and rolls ───────────────
  //
  // A drum step is false/0 (off), true (a normal hit — what every project
  // before accents stored), or a number: the ones digit is the level
  // (1 soft, 2 normal, 3 accent) and the tens digit is a roll (2, 3 or 4
  // hits squeezed into the sixteenth — the trap hi-hat roll). So 32 is a
  // normal-level triplet roll, 3 a plain accent.
  //
  // A hit whose volume or left/right has been set by hand is an object
  // { c: code, v: volume 0.05–1.3, p: pan −1…1 } — the code still carries
  // the roll, the v replaces the level's volume.
  const LEVEL_VEL = [0, 0.5, 1, 1.3];
  function stepInfo(v) {
    if (!v) return null;
    if (v === true) return { level: 2, vel: 1, roll: 1, pan: 0 };
    if (typeof v === 'object') {
      const base = stepInfo(v.c || 2);
      if (!base) return null;
      if (v.v != null) {
        base.vel = clamp(v.v, 0.05, 1.3);
        base.level = base.vel < 0.75 ? 1 : base.vel < 1.15 ? 2 : 3;
      }
      base.pan = v.p ? clamp(v.p, -1, 1) : 0;
      return base;
    }
    const level = Math.max(1, Math.min(3, v % 10 || 2));
    const roll = Math.max(1, Math.min(4, Math.floor(v / 10) || 1));
    return { level, vel: LEVEL_VEL[level], roll, pan: 0 };
  }
  function stepCode(level, roll) {
    return (roll > 1 ? roll * 10 : 0) + (level || 2);
  }
  /** The plain code of a step (what kind of hit), ignoring hand-set volume/pan. */
  function codeOf(v) {
    if (!v) return 0;
    if (v === true) return 2;
    return typeof v === 'object' ? (v.c || 2) : v;
  }
  /** Set one hit's volume and/or left-right. Steps that are off stay off. */
  function setStepMix(id, v, i, mix) {
    const t = track(id); if (!t || t.kind !== 'drum') return;
    const p = t.patterns[v];
    const cur = p && p[i];
    if (!cur) return;
    const o = typeof cur === 'object' ? Object.assign({}, cur) : { c: codeOf(cur) };
    if (mix.vel !== undefined) { if (mix.vel == null) delete o.v; else o.v = +clamp(mix.vel, 0.05, 1.3).toFixed(3); }
    if (mix.pan !== undefined) { if (!mix.pan) delete o.p; else o.p = +clamp(mix.pan, -1, 1).toFixed(3); }
    p[i] = (o.v == null && o.p == null) ? o.c : o;
    emit('pattern', { track: id, mixOnly: true });
  }
  /** Set a note's volume and/or left-right (notes are matched by start + pitch). */
  function setNoteMix(id, v, s, m, mix) {
    const t = track(id); if (!t || t.kind !== 'synth') return;
    const n = (t.patterns[v] || []).find(x => x.s === s && x.m === m);
    if (!n) return;
    if (mix.vel !== undefined) { if (mix.vel == null) delete n.vel; else n.vel = +clamp(mix.vel, 0.05, 1).toFixed(3); }
    if (mix.pan !== undefined) { if (!mix.pan) delete n.pan; else n.pan = +clamp(mix.pan, -1, 1).toFixed(3); }
    emit('pattern', { track: id, mixOnly: true });
  }

  // ── global ─────────────────────────────────────────────────────────
  function setMode(mode) {
    state.mode = mode === 'song' ? 'song' : 'pattern';
    emit('mode');
  }
  function mode() { return state.mode; }

  /** Swing: how far every second sixteenth is pushed late (0 straight – 0.6 heavy shuffle). */
  function setSwing(v) {
    state.swing = Math.max(0, Math.min(0.6, Number(v) || 0));
    emit('swing');
  }
  function swing() { return state.swing || 0; }

  /** The song's key, for the piano roll's highlighting and chord helper. null = off. */
  function setKey(k) {
    state.key = k && k.scale ? { root: ((k.root | 0) % 12 + 12) % 12, scale: k.scale === 'major' ? 'major' : 'minor' } : null;
    emit('key');
  }
  function key() { return state.key || null; }

  /** Character: a one-knob tone flavour for the track (character.js). */
  function setCharacter(id, preset, amount) {
    const t = track(id); if (!t) return;
    if (!preset || preset === 'none') delete t.character;
    else t.character = { id: preset, amount: clamp(amount == null ? 0.6 : amount, 0, 1) };
    emit('character', { track: id });
  }

  /** Pump: how much this track ducks every time a kick plays (sidechain). */
  function setPump(id, amount) {
    const t = track(id); if (!t) return;
    t.pump = Math.max(0, Math.min(0.9, Number(amount) || 0));
    emit('pump', { track: id });
  }

  function setBpm(bpm) {
    state.bpm = Math.max(40, Math.min(220, Math.round(bpm)));
    if (typeof Transport !== 'undefined') Transport.setBpm(state.bpm);
    emit('bpm');
  }
  function bpm() { return state.bpm; }

  function setAudio(id, buffer) { audio.set(id, buffer); emit('audio', { id }); }
  /** Pitch correction for an audio track: 'natural', 'hard', or off. */
  function setTune(id, mode) {
    const t = track(id); if (!t || t.kind !== 'audio') return;
    if (mode === 'natural' || mode === 'hard') t.tune = mode; else delete t.tune;
    processed.delete(id);
    emit('tune', { track: id });
  }
  function setProcessed(trackId, buffer) { processed.set(trackId, buffer); emit('audio', { track: trackId, processed: true }); }
  function hasProcessed(trackId) { return processed.has(trackId); }
  /** What an audio track actually plays: its tuned copy when Tune is on and ready. */
  function playbackAudio(t) { return (t.tune && processed.get(t.id)) || audio.get(t.audioId) || null; }
  function getAudio(id) { return audio.get(id) || null; }
  function newAudioId() { return state.nextAudioId++; }

  function serialize() {
    const s = clone(state);
    s.tracks.forEach(t => { t.pending = null; });
    return s;
  }

  // ── starting point ─────────────────────────────────────────────────
  function demo() {
    state = { version: 3, bpm: 90, mode: 'pattern', kit: 'trap', tracks: [], sections: [], nextId: 1, nextAudioId: 1 };
    const steps = (arr, n = 16) => { const p = new Array(n).fill(false); arr.forEach(i => p[i] = true); return p; };
    const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
    const all16 = Array.from({ length: 16 }, (_, i) => i);

    const lane = (name, role, a, b) => {
      const t = makeTrack({ kind: 'drum', name, sound: { kit: 'trap', role } });
      t.patterns[0] = steps(a); t.patterns[1] = steps(b);
      state.tracks.push(t);
      return t;
    };
    const kick = lane('Kick', 'kick', [0, 6, 10], [0, 6, 10, 14]);
    const snare = lane('Snare', 'snare', [4, 12], [4, 12, 15]);
    const clap = lane('Clap', 'clap', [], [4, 12]);
    const hat = lane('Hi-hat', 'hat', eighths, all16);
    const ohat = lane('Open hat', 'openhat', [14], [6, 14]);
    const perc = lane('Perc', 'perc', [2, 6, 10, 14], [2, 6, 10, 13, 14]);

    const bass = makeTrack({ kind: 'synth', name: '808', instrument: '808' });
    // A slide only works from a note still sounding, so each slide sits on
    // the step right after one — otherwise it just retriggers.
    bass.patterns[0] = [[0, 36], [3, 36], [4, 43, 1], [7, 41], [10, 39], [12, 36], [13, 31, 1]]
      .map(([s, m, sl]) => ({ s, m, l: 1, sl: !!sl }));
    bass.patterns[1] = [[0, 36], [2, 36], [4, 36], [6, 43, 1], [8, 41], [10, 41], [12, 39], [14, 34, 1]]
      .map(([s, m, sl]) => ({ s, m, l: 1, sl: !!sl }));
    state.tracks.push(bass);

    const keys = makeTrack({ kind: 'synth', name: 'Keys', instrument: 'epiano', bars: 2 });
    const chord = (s, l, ms) => ms.map(m => ({ s, m, l }));
    const cm = [60, 63, 67], ab = [56, 60, 63];
    keys.patterns[0] = [...chord(0, 14, cm), ...chord(16, 14, ab)];
    keys.patterns[1] = [0, 3, 6, 10].flatMap(s => [...chord(s, 2, cm), ...chord(s + 16, 2, ab)]);
    state.tracks.push(keys);

    const sec = (name, bars, map) => {
      const s = { id: 's' + (state.nextId++), name, bars, solo: [], cells: {} };
      state.tracks.forEach(t => {
        const spec = map[t.id];
        s.cells[t.id] = Array.isArray(spec) ? spec.slice() : new Array(bars).fill(spec == null ? OFF : spec);
      });
      state.sections.push(s);
    };
    sec('Intro', 4, { [hat.id]: [OFF, OFF, 0, 0], [keys.id]: 0 });
    sec('Verse', 8, { [kick.id]: 0, [snare.id]: 0, [hat.id]: 0, [ohat.id]: 0, [bass.id]: 0, [keys.id]: 0 });
    sec('Hook', 8, { [kick.id]: 1, [snare.id]: 1, [clap.id]: 1, [hat.id]: 1, [ohat.id]: 1, [perc.id]: 0,
                     [bass.id]: [1, 1, 1, 1, 1, 1, 1, OFF], [keys.id]: 1 });
    sec('Outro', 4, { [kick.id]: [0, 0, OFF, OFF], [hat.id]: 0, [keys.id]: 0 });
  }

  // ── loading, including projects saved by the old studio ────────────
  function migrateV2(d) {
    state = { version: 3, bpm: d.bpm || 90, mode: 'pattern', kit: 'classic', tracks: [], sections: [], nextId: 1, nextAudioId: 10 };
    const ROLES = [['Kick', 'kick'], ['Snare', 'snare'], ['Hi-hat', 'hat'], ['Open hat', 'openhat'], ['Clap', 'clap'], ['Shaker', 'perc']];
    const parts = Array.isArray(d.drumParts) && d.drumParts.length ? d.drumParts
      : (Array.isArray(d.drums) ? d.drums.map(l => ({ current: 0, banks: [l] })) : []);
    ROLES.forEach(([name, role], li) => {
      // Old mixer strips were keyed 'drum:N' — keeping that id means the
      // saved faders still land on the right lane.
      const t = makeTrack({ id: 'drum:' + li, kind: 'drum', name, sound: { kit: 'classic', role } });
      const p = parts[li];
      if (p && Array.isArray(p.banks)) {
        p.banks.forEach((b, v) => { if (Array.isArray(b) && v < COUNT) t.patterns[v] = new Array(16).fill(false).map((_, i) => !!b[i]); });
        t.live = t.edit = Math.max(0, Math.min(3, p.current | 0));
      }
      state.tracks.push(t);
    });
    const bass = makeTrack({ id: 'bass', kind: 'synth', name: '808', instrument: '808', params: d.voice || {} });
    const bp = d.bass || (Array.isArray(d.pattern) ? { current: 0, banks: [d.pattern] } : null);
    if (bp && Array.isArray(bp.banks)) {
      bp.banks.forEach((b, v) => {
        if (!Array.isArray(b) || v >= COUNT) return;
        bass.patterns[v] = b.map((n, i) => (n && typeof n.midi === 'number') ? { s: i, m: n.midi, l: 1, sl: !!n.slide } : null).filter(Boolean);
      });
      bass.live = bass.edit = Math.max(0, Math.min(3, bp.current | 0));
    }
    state.tracks.push(bass);
    (d.loops || []).forEach(l => {
      state.tracks.push(makeTrack({ id: 'loop:' + l.index, kind: 'audio', name: 'Loop ' + (l.index + 1),
        audioId: l.index, bars: l.bars || 1, gain: typeof l.volume === 'number' ? l.volume / 0.9 : 1 }));
    });
    const blocks = d.song && Array.isArray(d.song.blocks) && d.song.blocks.length ? d.song.blocks : [{ v: 0, bars: 4 }];
    blocks.forEach((b, i) => {
      const s = { id: 's' + (state.nextId++), name: 'Section ' + (i + 1), bars: Math.max(1, b.bars | 0), solo: [], cells: {} };
      state.tracks.forEach(t => { s.cells[t.id] = new Array(s.bars).fill(t.kind === 'audio' ? 0 : (b.v | 0)); });
      state.sections.push(s);
    });
    if (d.song && d.song.enabled) state.mode = 'song';
  }

  /**
   * Load a project. opts.keep (undo, autosave) keeps the audio clips and
   * announces the change as ordinary edits rather than a new song, so the
   * mixer strips and their faders stay put.
   */
  function restore(d, opts) {
    const keep = opts && opts.keep;
    if (!keep) { audio.clear(); processed.clear(); }
    if (!d || !d.version || d.version < 3) migrateV2(d || {});
    else {
      state = clone(d);
      state.mode = state.mode === 'song' ? 'song' : 'pattern';
      state.tracks.forEach(t => {
        t.pending = null;
        if (t.edit == null) t.edit = 0;
        if (t.kind === 'synth') t.params = Object.assign(Instruments.defaults(t.instrument), t.params || {});
      });
      state.sections.forEach(s => {
        s.solo = s.solo || [];
        state.tracks.forEach(t => { if (!s.cells[t.id]) s.cells[t.id] = new Array(s.bars).fill(0); });
      });
      if (!state.sections.length) state.sections.push(makeSection('Section 1', 4, null));
    }
    if (typeof Transport !== 'undefined') Transport.setBpm(state.bpm);
    if (keep) ['tracks', 'sections', 'mode', 'bpm', 'swing', 'key', 'pattern'].forEach(r => emit(r));
    else emit('load');
  }

  function reset() {
    audio.clear();
    processed.clear();
    demo();
    if (typeof Transport !== 'undefined') Transport.setBpm(state.bpm);
    emit('load');
  }

  demo();

  return {
    STEPS_PER_BAR, NAMES, COUNT, OFF, on,
    tracks, track, addTrack, removeTrack, renameTrack, moveTrack, setTrackBars,
    setSound, setInstrument, setParam, setKit, kit: () => state.kit,
    pattern, toggleStep, setNotes, setPatternSteps, clearPattern, copyPattern,
    setLive, setEdit, setAllLive, applyPending,
    sections, section, addSection, duplicateSection, removeSection, moveSection, renameSection,
    setSectionBars, setCell, setSectionTrack, replaceSections, toggleBarMute, toggleSolo, mainLetter,
    songBars, sectionStart, locate, songStateAt, cellAt, setCells, runs, extendTo,
    setMode, mode, setBpm, bpm, setSwing, swing, setKey, key, setPump, setCharacter,
    stepInfo, stepCode, codeOf, setStepMix, setNoteMix,
    setAudio, getAudio, newAudioId, setTune, setProcessed, hasProcessed, playbackAudio,
    serialize, restore, reset
  };
})();
