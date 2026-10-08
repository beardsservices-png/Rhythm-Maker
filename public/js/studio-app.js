// studio-app.js — the frame around everything: top bar, play/stop, tempo,
// loop-vs-song mode, tabs, popovers, and which track is selected.
//
// Other modules talk to each other through Project (the song) and through the
// small App object here (selection, status line, popovers) rather than
// reaching into each other's DOM.

const App = (() => {
  const $ = (id) => document.getElementById(id);
  const listeners = new Set();
  let selected = null;
  let brush = 'mute';
  let msgTimer = null;

  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(kind) { listeners.forEach(fn => { try { fn(kind); } catch (e) { console.error(e); } }); }

  function msg(text, bad) {
    const el = $('status');
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
    el.classList.toggle('show', !!text);
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(() => el.classList.remove('show'), bad ? 9000 : 5000);
  }

  function select(id) {
    if (!Project.track(id)) id = Project.tracks()[0] ? Project.tracks()[0].id : null;
    selected = id;
    emit('select');
  }

  // ── audio start-up. Browsers only allow sound after a click/keypress. ──
  let audioReady = false;
  function ensureAudio() {
    const ac = Sequencer.init();
    if (!ac) {
      const n = $('notice');
      n.textContent = 'This browser has no Web Audio — try Chrome, Edge, Safari or Firefox.';
      n.classList.add('show');
      return null;
    }
    if (ac.state === 'suspended') ac.resume();
    if (!audioReady) { audioReady = true; Recorder.prime(); }
    return ac;
  }

  function togglePlay() {
    if (!ensureAudio()) return;
    if (Transport.isPlaying) Transport.stop(); else Transport.play();
  }

  // ── popovers ──
  function closePops(except) {
    document.querySelectorAll('.pop').forEach(p => { if (p !== except) p.hidden = true; });
  }
  function openPop(pop, anchor) {
    closePops(pop);
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    pop.style.left = left + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    const h = pop.offsetHeight;
    if (r.bottom + 6 + h > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - h - 6) + 'px';
  }
  function togglePop(pop, anchor) { if (pop.hidden) openPop(pop, anchor); else pop.hidden = true; }
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pop') || e.target.closest('[data-pop-anchor]')) return;
    closePops();
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops(); });

  /** A quick menu of choices under a button. items: [{label, act, cls, heading}] */
  function menu(anchor, items, popId) {
    const pop = $(popId || 'trackMenu');
    pop.innerHTML = '';
    items.forEach(it => {
      if (it.heading) {
        const h = document.createElement('div');
        h.className = 'pop-title';
        h.textContent = it.heading;
        pop.appendChild(h);
        return;
      }
      const b = document.createElement('button');
      b.className = 'menuitem' + (it.cls ? ' ' + it.cls : '');
      b.textContent = it.label;
      if (it.title) b.title = it.title;
      b.addEventListener('click', () => { pop.hidden = true; it.act(); });
      pop.appendChild(b);
    });
    openPop(pop, anchor);
  }

  // ── top bar ──
  const playBtn = $('playBtn');
  playBtn.addEventListener('click', togglePlay);
  Transport.onStateChange(s => {
    playBtn.innerHTML = s.playing ? '&#9632; Stop' : '&#9654; Play';
    playBtn.classList.toggle('on', s.playing);
    if (!s.playing) $('pos').textContent = '1.1';
  });

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
    // Space is play/stop everywhere — including when a button still has focus
    // from the last click, which would otherwise press that button again.
    e.preventDefault();
    togglePlay();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && (e.target.tagName || '').toLowerCase() === 'button') e.preventDefault();
  });

  const clickBtn = $('clickBtn');
  clickBtn.addEventListener('click', () => {
    const on = !Sequencer.metronome();
    Sequencer.setMetronome(on);
    clickBtn.classList.toggle('on', on);
    clickBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  const bpmIn = $('bpm');
  bpmIn.addEventListener('change', () => {
    const v = parseInt(bpmIn.value, 10);
    if (v) Project.setBpm(v);
    bpmIn.value = String(Project.bpm());
  });

  function paintMode() {
    const song = Project.mode() === 'song';
    $('modeSong').classList.toggle('on', song);
    $('modePattern').classList.toggle('on', !song);
    document.body.classList.toggle('songmode', song);
  }
  $('modePattern').addEventListener('click', () => Project.setMode('pattern'));
  $('modeSong').addEventListener('click', () => Project.setMode('song'));

  Transport.onVisualStep((ev) => {
    const beat = ev.beat + 1;
    if (Project.mode() === 'song') {
      const loc = Project.locate(ev.bar);
      $('pos').textContent = loc ? `${loc.section.name} ${loc.barIn + 1}.${beat}` : `${ev.bar + 1}.${beat}`;
    } else {
      $('pos').textContent = `${ev.bar + 1}.${beat}`;
    }
  });

  // ── tabs ──
  document.querySelectorAll('.tabs [data-tab]').forEach(b => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });
  function showTab(name) {
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
  }

  // ── brushes ──
  document.querySelectorAll('[data-brush]').forEach(b => {
    b.addEventListener('click', () => {
      brush = b.dataset.brush;
      document.querySelectorAll('[data-brush]').forEach(x => x.classList.toggle('on', x === b));
    });
  });

  // ── Claude drawer ──
  $('claudeBtn').addEventListener('click', () => {
    const d = $('claudeDrawer');
    d.hidden = !d.hidden;
    if (!d.hidden) $('claudeInput').focus();
  });
  $('claudeClose').addEventListener('click', () => { $('claudeDrawer').hidden = true; });

  // Mark the buttons that open popovers so a click on them doesn't count as
  // "clicked outside" and close what it just opened.
  ['openBtn', 'exportBtn', 'midiBtn', 'addTrackBtn'].forEach(id => $(id).setAttribute('data-pop-anchor', ''));

  Project.on((reason) => {
    if (reason === 'bpm' || reason === 'load') bpmIn.value = String(Project.bpm());
    if (reason === 'mode' || reason === 'load') paintMode();
    if (reason === 'tracks' || reason === 'load') {
      if (!Project.track(selected)) select(null);
    }
  });

  // Build the audio graph now (it starts suspended until the first click) so
  // the mixer has its strips before anything is played.
  Sequencer.init();

  paintMode();
  // Start on the drum machine: it's the part people reach for first, and the
  // dock underneath already plays the 808.
  // After every script has run — a timer can fire between two <script> tags,
  // before the editor is listening.
  document.addEventListener('DOMContentLoaded', () => select(Project.tracks()[0] && Project.tracks()[0].id));

  return {
    on, msg, select, menu, openPop, closePops, togglePop, showTab, ensureAudio, togglePlay,
    selected: () => selected,
    brush: () => brush
  };
})();
