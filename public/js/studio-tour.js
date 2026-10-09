// studio-tour.js — "make your first song", a walkthrough that points at the
// real buttons while you use them.
//
// Each step dims the page except one thing, says in a sentence or two what it
// is and what to do, and moves on by itself when you've done it (pressed Play,
// clicked a block, added a note …) — or when you press Next. You're always
// using the actual app, not a slideshow, so whatever you make on the tour is a
// real song you can keep.

const Tour = (() => {
  const $ = (id) => document.getElementById(id);
  let i = -1;
  let shade = null, ring = null, card = null, raf = 0, waitOff = [];
  const KEY = 'bhs.tour.done';

  const kickId = () => { const t = Project.tracks().find(x => x.kind === 'drum' && x.sound.role === 'kick') || Project.tracks().find(x => x.kind === 'drum'); return t && t.id; };
  const newestSynth = () => { const s = Project.tracks().filter(t => t.kind === 'synth'); return s[s.length - 1]; };
  let synthCount = 0;

  // target: () => Element | null. done: (kind, detail) => bool — advance when true.
  const STEPS = [
    { title: 'Your first song, step by step',
      text: 'This takes about five minutes. Each step points at the real button and tells you what to do — you do it, and the tour moves on. Everything you make is a real song you can keep. <b>Skip</b> any time.' },
    { title: 'Press Play',
      text: 'Press <b>▶ Play</b> (or the <b>Space</b> bar) and listen. This is a template — a finished starting point you can change however you like.',
      target: () => $('playBtn'), done: (k) => k === 'playing' },
    { title: 'The song, left to right',
      text: 'This is the <b>timeline</b>: the whole song from left to right. Each <b>row is one instrument</b> and each <b>block is when it plays</b>. The <b>light at the start of a row blinks when that instrument makes sound</b> — watch the Kick row.',
      target: () => $('arrangePanel') },
    { title: 'Open what a block plays',
      text: 'Click one of the <b>Kick</b> row\'s blocks. The bottom half of the screen jumps to exactly what that block plays.',
      target: () => { const id = kickId(); return id && document.querySelector(`.tl-row.track[data-id="${CSS.escape(id)}"] .clip`); },
      done: (k) => k === 'select' && App.selected() === kickId() },
    { title: 'The drum machine',
      text: 'Every drum is a row; <b>lit squares are hits</b>. Click an empty square to add a kick there, click a lit one to take it away. You\'ll hear it next time round.',
      target: () => document.querySelector('#editor .drumgrid'),
      before: () => { const id = kickId(); if (id && App.selected() !== id) App.select(id); },
      done: (k, d) => k === 'pattern' && d && !d.mixOnly },
    { title: 'Each hit\'s volume',
      text: 'Under the drums: <b>one bar per hit</b> of the selected row. <b>Drag a bar down</b> for a softer hit (a ghost note), up for a harder one. <b>Left / right</b> switches the bars to where each hit sits in the speakers.',
      target: () => document.querySelector('#editor .vrow'),
      done: (k, d) => k === 'pattern' && d && d.mixOnly },
    { title: 'Character — one knob for tone',
      text: 'Pick a flavour here — try <b>Punchy</b> on the kick — then slide <b>Amount</b> up until it sounds right. Warm, Bright, Big & heavy, Lo-fi … each one is a whole engineer\'s chain behind one knob.',
      target: () => document.querySelector('#editor .charfield'),
      done: (k) => k === 'character' },
    { title: 'Add a real instrument',
      text: 'Click <b>+ Add instrument</b> and pick one marked <b>(recorded)</b> — Grand Piano, Electric Piano (Rhodes), Strings, Guitar … They\'re real recordings.',
      target: () => $('addTrackBtn'),
      before: () => { synthCount = Project.tracks().filter(t => t.kind === 'synth').length; },
      done: (k) => k === 'tracks' && Project.tracks().filter(t => t.kind === 'synth').length > synthCount },
    { title: 'Write notes in the piano roll',
      text: '<b>Click in the grid</b> to add a note: up/down is the note, left to right is time. Drag right while adding to hold it longer. Turn on <b>Chords</b> to drop a whole chord that fits the song\'s key.',
      target: () => document.querySelector('#editor .roll'),
      before: () => { const t = newestSynth(); if (t && App.selected() !== t.id) App.select(t.id); },
      done: (k, d) => k === 'pattern' && d && !d.mixOnly },
    { title: 'Put it in the song',
      text: 'Your new instrument has a row on the timeline. <b>Drag along its row</b> to draw where it plays. Click a block, then <b>Ctrl+C</b> / <b>Ctrl+V</b> to copy it, or <b>Ctrl+D</b> to repeat it right after itself.',
      target: () => { const t = newestSynth(); return t && document.querySelector(`.tl-row.track[data-id="${CSS.escape(t.id)}"]`); } },
    { title: 'Play it yourself',
      text: 'The keyboard down here plays the instrument picked in <b>Play</b>. Your computer keys work too (<b>Z S X D C</b> …). Turn on <b>Write notes</b> while the song plays and what you play is written into the pattern.',
      target: () => $('dock') },
    { title: 'Vocals',
      text: 'Set the box next to <b>● Rec</b> to <b>microphone</b>, put headphones on, press <b>● Rec</b>. Your take gets <b>vocal polish</b> straight away, and <b>Tune</b> (pitch correction) is one click in its editor.',
      target: () => $('recSource') || $('recBtn') },
    { title: 'Balance it',
      text: 'The <b>Mixer</b> tab: a fader per instrument for volume, the small slider for left/right, <b>rev</b> and <b>dly</b> for space. If something is too loud, turn it down here.',
      target: () => document.querySelector('.tabs [data-tab="mix"]') },
    { title: 'Finish it',
      text: '<b>Export</b> → leave mastering on <b>Deep &amp; warm</b> → <b>Hear it mastered</b> → <b>Download .wav</b>. That\'s a finished song file you can send anywhere.',
      target: () => $('exportBtn') },
    { title: 'That\'s the whole loop',
      text: 'Make the beat, put it in the song, add instruments, record, balance, export. <b>Save</b> (Ctrl+S) keeps it on the server. The <b>? Manual</b> has a picture of every button, and <b>Tour</b> runs this again.' }
  ];

  function build() {
    shade = document.createElement('div'); shade.className = 'tour-shade';
    ring = document.createElement('div'); ring.className = 'tour-ring';
    card = document.createElement('div'); card.className = 'tour-card'; card.setAttribute('role', 'dialog');
    document.body.append(shade, ring, card);
  }

  function place() {
    if (i < 0) return;
    const st = STEPS[i];
    const t = st.target && st.target();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (t && t.getClientRects().length) {
      const r = t.getBoundingClientRect();
      const pad = 6;
      const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
      const h = Math.min(vh - top - 4, r.height + pad * 2), w = Math.min(vw - left - 4, r.width + pad * 2);
      Object.assign(ring.style, { display: 'block', top: top + 'px', left: left + 'px', width: w + 'px', height: h + 'px' });
      shade.style.display = 'none';
      const cw = Math.min(380, vw - 24), ch = card.offsetHeight || 180;
      let cy = top + h + 12;
      if (cy + ch > vh - 8) cy = top - ch - 12;
      if (cy < 8) cy = Math.min(vh - ch - 8, Math.max(8, top + 12));        // big target: sit inside it
      let cx = Math.max(12, Math.min(vw - cw - 12, left));
      Object.assign(card.style, { top: cy + 'px', left: cx + 'px', width: cw + 'px', transform: '' });
    } else {
      ring.style.display = 'none';
      shade.style.display = 'block';
      Object.assign(card.style, { top: '50%', left: '50%', width: Math.min(420, vw - 24) + 'px', transform: 'translate(-50%,-50%)' });
    }
    raf = requestAnimationFrame(place);
  }

  function show(n) {
    i = n;
    waitOff.forEach(f => f()); waitOff = [];
    const st = STEPS[i];
    if (st.before) st.before();
    const last = i === STEPS.length - 1;
    card.innerHTML = `<div class="tour-step">Step ${i + 1} of ${STEPS.length}</div><h3>${st.title}</h3><p>${st.text}</p>` +
      `<div class="tour-btns"><button class="tour-skip">${last ? 'Close' : 'Skip tour'}</button>` +
      (i > 0 ? '<button class="tour-back">Back</button>' : '') +
      `<button class="primary tour-next">${last ? 'Done' : st.done ? 'Next (or just do it)' : 'Next'}</button></div>`;
    card.querySelector('.tour-skip').onclick = stop;
    card.querySelector('.tour-next').onclick = () => (last ? stop(true) : show(i + 1));
    const back = card.querySelector('.tour-back');
    if (back) back.onclick = () => show(i - 1);
    // Bring the target into view (the page scrolls; the dock is always there).
    const t = st.target && st.target();
    if (t && t.scrollIntoView && t.id !== 'dock' && !t.closest('.topbar')) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (st.done) {
      const go = (k, d) => { if (i === n && st.done(k, d)) setTimeout(() => { if (i === n) show(n + 1); }, 700); };
      waitOff.push(Project.on((r, d) => go(r, d)));
      waitOff.push(App.on((k) => go(k)));
      waitOff.push(Transport.onStateChange((s) => { if (s.playing) go('playing'); }));
    }
  }

  function start() {
    if (!card) build();
    if (typeof StartScreen !== 'undefined' && StartScreen.isOpen()) StartScreen.hide();
    document.body.classList.add('touring');
    cancelAnimationFrame(raf);
    show(0);
    place();
  }

  function stop(finished) {
    cancelAnimationFrame(raf);
    waitOff.forEach(f => f()); waitOff = [];
    i = -1;
    [shade, ring, card].forEach(e => { if (e) e.remove(); });
    shade = ring = card = null;
    document.body.classList.remove('touring');
    try { localStorage.setItem(KEY, '1'); } catch (_) {}
    if (finished === true) App.msg('Tour done. Your song is still here — keep going, or press Save.');
  }

  const btn = $('tourBtn');
  if (btn) btn.addEventListener('click', start);
  const ss = $('ssTour');
  if (ss) ss.addEventListener('click', () => StartScreen.choose('trap').then(start));

  return {
    start, stop, next: () => { if (i >= 0 && i < STEPS.length - 1) show(i + 1); },
    step: () => i, count: STEPS.length,
    seen: () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } }
  };
})();
