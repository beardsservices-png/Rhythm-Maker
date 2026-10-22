// studio-windows.js — the Studio as a desktop of windows you arrange yourself.
//
// Every part of the Studio (timeline, pads, editor, mixer, reverb & delay,
// keyboard, Ask Claude) is a window. Tick it on or off in the Windows menu, drag it by its
// title bar, drop it beside another to sit side by side, drag the corner to make
// it wider or taller, fold it up with −, close it with ×. The layout is kept in
// this browser and comes back next time; named layouts can be saved.
//
// Windows sit on a 12-column grid and never overlap: each one falls upward until
// it meets the window above it, like a dashboard. A window is as tall as what is
// inside it unless you drag it to a height (double-click the corner to undo that)
// — so by default nothing scrolls inside a box; the page scrolls instead.
// On a phone every window is full width and they stack; dragging still reorders.
//
// The keyboard window starts pinned along the bottom of the screen (always in
// reach). Its pin button lets it go into the grid like any other window.

const Windows = (() => {
  const $ = (id) => document.getElementById(id);
  const COLS = 12, GAP = 12, NARROW = 900, MIN_H = 90, KEY = 'bhs.studio.layout', SAVED = 'bhs.studio.layouts';

  const WINS = [
    { id: 'timeline', title: 'Song timeline', el: 'arrangePanel' },
    { id: 'pads',     title: 'Pads', el: 'padsPanel' },
    { id: 'editor',   title: 'Editor (drums / notes / clip)', el: 'editorPanel' },
    { id: 'mixer',    title: 'Mixer', el: 'mixerPanel' },
    { id: 'fx',       title: 'Reverb & delay', el: 'fxWin' },
    { id: 'keys',     title: 'Keyboard & knobs', el: 'dock' },
    { id: 'claude',   title: 'Ask Claude', el: 'claudeDrawer' }
  ];
  const W = (id) => WINS.find(w => w.id === id);

  // y is only an order (top-to-bottom); the real top is worked out by layout().
  const PRESETS = {
    'Standard': {
      timeline: { open: true, x: 0, w: 12, y: 0 },
      pads:     { open: true, x: 0, w: 12, y: 0.5 },
      editor:   { open: true, x: 0, w: 12, y: 1 },
      mixer:    { open: false, x: 0, w: 8, y: 2 },
      fx:       { open: false, x: 8, w: 4, y: 2 },
      claude:   { open: false, x: 8, w: 4, y: 3 },
      keys:     { open: true, pinned: true, x: 0, w: 12, y: 9 }
    },
    'Make a beat': {
      timeline: { open: false, x: 0, w: 12, y: 2 },
      pads:     { open: true, x: 0, w: 12, y: 0 },
      editor:   { open: true, x: 0, w: 12, y: 1 },
      mixer:    { open: false, x: 0, w: 12, y: 3 },
      fx:       { open: false, x: 8, w: 4, y: 4 },
      claude:   { open: false, x: 8, w: 4, y: 5 },
      keys:     { open: true, pinned: true, x: 0, w: 12, y: 9 }
    },
    'Lay out the song': {
      timeline: { open: true, x: 0, w: 12, y: 0 },
      pads:     { open: false, x: 0, w: 12, y: 5 },
      editor:   { open: false, x: 0, w: 12, y: 2 },
      mixer:    { open: true, x: 0, w: 12, y: 1 },
      fx:       { open: false, x: 8, w: 4, y: 3 },
      claude:   { open: false, x: 8, w: 4, y: 4 },
      keys:     { open: false, pinned: true, x: 0, w: 12, y: 9 }
    },
    'Mix it': {
      timeline: { open: true, x: 0, w: 12, y: 0 },
      pads:     { open: false, x: 0, w: 12, y: 5 },
      editor:   { open: false, x: 0, w: 12, y: 3 },
      mixer:    { open: true, x: 0, w: 8, y: 1 },
      fx:       { open: true, x: 8, w: 4, y: 1 },
      claude:   { open: false, x: 8, w: 4, y: 4 },
      keys:     { open: false, pinned: true, x: 0, w: 12, y: 9 }
    },
    'Everything': {
      timeline: { open: true, x: 0, w: 12, y: 0 },
      pads:     { open: true, x: 0, w: 12, y: 0.5 },
      editor:   { open: true, x: 0, w: 8, y: 1 },
      claude:   { open: true, x: 8, w: 4, y: 1 },
      mixer:    { open: true, x: 0, w: 8, y: 2 },
      fx:       { open: true, x: 8, w: 4, y: 2 },
      keys:     { open: true, pinned: true, x: 0, w: 12, y: 9 }
    }
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  let state = load();
  let ws = null;                 // the workspace element
  let drag = null;               // {id, ...} while a window is being moved / resized
  let ghost = null;              // where the dragged window will land
  let queued = 0;
  const listeners = new Set();

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    return normalise(s);
  }
  function normalise(s) {
    const base = clone(PRESETS.Standard);
    const out = {};
    WINS.forEach(w => {
      const v = Object.assign({}, base[w.id], (s && s[w.id]) || {});
      v.w = Math.max(2, Math.min(COLS, v.w | 0 || COLS));
      v.x = Math.max(0, Math.min(COLS - v.w, v.x | 0));
      v.y = Number.isFinite(v.y) ? v.y : 99;
      v.h = v.h > 0 ? Math.max(MIN_H, v.h) : null;
      v.open = !!v.open; v.min = !!v.min;
      if (w.id === 'keys') v.pinned = v.pinned !== false;
      out[w.id] = v;
    });
    return out;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: layout just isn't kept */ }
    listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }
  function savedLayouts() {
    try { return JSON.parse(localStorage.getItem(SAVED) || '{}') || {}; } catch (e) { return {}; }
  }
  function setSavedLayouts(o) { try { localStorage.setItem(SAVED, JSON.stringify(o)); } catch (e) { App.msg('This browser won\'t keep saved layouts (private window?).', true); } }

  const narrow = () => window.innerWidth < NARROW;
  const isPinned = (id) => id === 'keys' && state.keys.pinned;
  const inGrid = (id) => state[id].open && !isPinned(id);

  function geometry() {
    const width = ws.clientWidth - 2 * pad();
    const col = (width - GAP * (COLS - 1)) / COLS;
    return { col, step: col + GAP, width };
  }
  function pad() { return parseFloat(getComputedStyle(ws).paddingLeft) || 0; }
  function cols(id) { return narrow() ? { x: 0, w: COLS } : { x: state[id].x, w: state[id].w }; }

  // ── chrome: title-bar buttons and the resize corner on every window ──
  function decorate() {
    WINS.forEach(w => {
      const el = $(w.el);
      if (!el || el.dataset.decorated) return;
      el.dataset.decorated = '1';
      el.classList.add('win');
      const head = el.querySelector('.panel-head, .dock-head');
      head.classList.add('win-head');
      head.title = head.title || 'Drag here to move this window';
      const grip = document.createElement('span');
      grip.className = 'win-grip'; grip.textContent = '⠿'; grip.setAttribute('aria-hidden', 'true');
      head.insertBefore(grip, head.firstChild);
      const ctl = document.createElement('div');
      ctl.className = 'win-ctl';
      if (w.id === 'keys') ctl.appendChild(button('win-pin', '📌', 'Pin to the bottom of the screen / let it go into the layout', () => setPinned(!state.keys.pinned)));
      ctl.appendChild(button('win-fit', '↕', 'Fit the height to what\'s inside', () => { state[w.id].h = null; apply(); save(); }));
      ctl.appendChild(button('win-min', '−', 'Fold up / unfold', () => { state[w.id].min = !state[w.id].min; apply(); save(); }));
      ctl.appendChild(button('win-x', '×', 'Close (bring it back from the Windows menu)', () => hide(w.id)));
      head.appendChild(ctl);
      const rz = document.createElement('div');
      rz.className = 'win-rz'; rz.title = 'Drag to resize · double-click to fit';
      el.appendChild(rz);
      // The whole right edge too: on a tall window the corner can be off screen.
      const rr = document.createElement('div');
      rr.className = 'win-rz win-rzr'; rr.title = 'Drag to make it wider or narrower';
      el.appendChild(rr);
      rr.addEventListener('pointerdown', (e) => startResize(e, w.id, true));

      head.addEventListener('pointerdown', (e) => startMove(e, w.id));
      head.addEventListener('dblclick', (e) => { if (!interactive(e.target)) { state[w.id].min = !state[w.id].min; apply(); save(); } });
      rz.addEventListener('pointerdown', (e) => startResize(e, w.id));
      rz.addEventListener('dblclick', () => { state[w.id].h = null; apply(); save(); });
      if (window.ResizeObserver) new ResizeObserver(() => schedule()).observe(el);
    });
  }
  function button(cls, text, title, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'win-btn ' + cls; b.textContent = text; b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }
  const interactive = (t) => !!t.closest('button, a, input, select, textarea, label, .win-ctl');

  // ── layout ──
  function schedule() {
    if (queued || drag) return;
    queued = requestAnimationFrame(() => { queued = 0; layout(); });
  }

  function apply() {
    WINS.forEach(w => {
      const el = $(w.el); const s = state[w.id];
      el.hidden = !s.open;
      el.classList.toggle('min', s.min);
      el.classList.toggle('fixedh', !!s.h && !s.min);
      el.classList.toggle('pinned', isPinned(w.id));
      el.classList.toggle('ingrid', inGrid(w.id));
      if (!inGrid(w.id)) { el.style.left = el.style.top = el.style.width = el.style.height = ''; }
    });
    const pin = document.querySelector('.win-pin');
    if (pin) pin.classList.toggle('on', state.keys.pinned);
    layout();
    paintMenu();
  }

  /** Place every window: columns from its x/w, then each falls upward until it
   *  meets a window above it in an overlapping column. */
  function layout(dragged) {
    if (!ws) return;
    const g = geometry();
    const p = pad();
    const ids = WINS.map(w => w.id).filter(inGrid);
    ids.forEach(id => {
      const el = $(W(id).el); const c = cols(id); const s = state[id];
      if (drag && drag.id === id && drag.kind === 'move') return;     // follows the pointer
      if (!(drag && drag.id === id && drag.kind === 'resize')) {
        el.style.width = (c.w * g.col + (c.w - 1) * GAP) + 'px';
        el.style.height = s.h && !s.min ? s.h + 'px' : '';
      }
      el.style.left = (p + c.x * g.step) + 'px';
    });
    const order = ids.slice().sort((a, b) => (state[a].y - state[b].y) || (cols(a).x - cols(b).x));
    const placed = [];
    let bottom = 0;
    order.forEach(id => {
      const c = cols(id);
      const el = $(W(id).el);
      const h = dragged && dragged.id === id ? dragged.h : el.offsetHeight;
      let top = 0;
      placed.forEach(q => { if (c.x < q.x + q.w && q.x < c.x + c.w) top = Math.max(top, q.top + q.h + GAP); });
      placed.push({ id, x: c.x, w: c.w, top, h });
      bottom = Math.max(bottom, top + h);
      if (dragged && dragged.id === id) {
        if (ghost) {
          ghost.style.left = (p + c.x * g.step) + 'px'; ghost.style.top = (p + top) + 'px';
          ghost.style.width = (c.w * g.col + (c.w - 1) * GAP) + 'px'; ghost.style.height = h + 'px';
        }
        dragged.slot = top;
      } else {
        el.style.top = (p + top) + 'px';
      }
    });
    // Remember the settled order as real tops, so later drags compare like with like.
    if (!dragged) placed.forEach(q => { state[q.id].y = q.top; });
    ws.style.height = (bottom + 2 * p) + 'px';
    const dock = $('dock');
    const tb = document.querySelector('.topbar');
    if (tb) document.body.style.setProperty('--topH', tb.offsetHeight + 'px');
    document.body.style.setProperty('--dockH', (state.keys.open && state.keys.pinned ? dock.offsetHeight : 0) + 'px');
    document.body.classList.toggle('nodock', !(state.keys.open && state.keys.pinned));
  }

  // ── moving ──
  function startMove(e, id) {
    if (e.button !== 0 || interactive(e.target) || !inGrid(id)) return;
    const el = $(W(id).el);
    const r = el.getBoundingClientRect(), wr = ws.getBoundingClientRect();
    e.preventDefault();
    drag = { id, kind: 'move', dx: e.clientX - r.left, dy: e.clientY - r.top, h: r.height, x0: e.clientX, y0: e.clientY, moved: false, w0: state[id].w };
    el.style.left = (r.left - wr.left) + 'px'; el.style.top = (r.top - wr.top) + 'px';
    let last = null, timer = 0;
    // Hold the window near the top or bottom of the screen and the page keeps
    // scrolling, so a window can be carried anywhere in a long layout.
    const edge = () => {
      if (!last || !drag) return 0;
      const dockH = parseFloat(getComputedStyle(document.body).getPropertyValue('--dockH')) || 0;
      if (last.clientY < 70) return -1;
      if (last.clientY > window.innerHeight - dockH - 40) return 1;
      return 0;
    };
    const tick = () => {
      const d = edge();
      if (!d) { timer = 0; return; }
      const y0 = window.scrollY;
      window.scrollBy(0, d * 16);
      if (window.scrollY !== y0) place(last);
      timer = requestAnimationFrame(tick);
    };
    const move = (ev) => {
      last = { clientX: ev.clientX, clientY: ev.clientY };
      if (!drag.moved && Math.abs(ev.clientX - drag.x0) + Math.abs(ev.clientY - drag.y0) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        el.classList.add('dragging');
        ghost = document.createElement('div'); ghost.className = 'win-ghost';
        ws.appendChild(ghost);
      }
      place(ev);
      if (edge() && !timer) timer = requestAnimationFrame(tick);
    };
    const place = (ev) => {
      if (!drag || !drag.moved) return;
      const wr2 = ws.getBoundingClientRect(), g = geometry();
      const left = ev.clientX - wr2.left - drag.dx, top = Math.max(0, ev.clientY - wr2.top - drag.dy);
      el.style.left = left + 'px'; el.style.top = top + 'px';
      const s = state[id];
      s.y = top - pad() - 1;                      // just ahead of a window it's level with
      s.w = drag.w0;
      s.x = Math.max(0, Math.min(COLS - s.w, Math.round((left - pad()) / g.step)));
      if (!narrow()) besideRow(s, Math.floor((ev.clientX - wr2.left - pad()) / g.step), top - pad());
      el.style.width = (s.w * g.col + (s.w - 1) * GAP) + 'px';
      layout({ id, h: drag.h });
    };
    // Dropped level with other windows: fit into the free columns beside them
    // (narrowing if it has to), and line its top up with theirs.
    const besideRow = (s, pc, top) => {
      const row = WINS.map(w => w.id).filter(q => q !== id && inGrid(q) && Math.abs(state[q].y - top) < 70);
      if (!row.length) return;
      const used = new Array(COLS).fill(false);
      row.forEach(q => { const c = cols(q); for (let k = c.x; k < c.x + c.w; k++) used[k] = true; });
      pc = Math.max(0, Math.min(COLS - 1, pc));
      if (used[pc]) return;                       // over another window: goes above/below it
      let a = pc, b = pc + 1;
      while (a > 0 && !used[a - 1]) a--;
      while (b < COLS && !used[b]) b++;
      if (b - a < 2) return;
      s.w = Math.min(drag.w0, b - a);
      s.x = Math.max(a, Math.min(b - s.w, pc - Math.floor(s.w / 2)));
      s.y = Math.min(...row.map(q => state[q].y)) - 1;
    };
    const up = () => {
      if (timer) cancelAnimationFrame(timer);
      timer = 0;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const moved = drag.moved;
      el.classList.remove('dragging');
      if (ghost) { ghost.remove(); ghost = null; }
      drag = null;
      layout();
      if (moved) save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ── resizing ──
  function startResize(e, id, widthOnly) {
    if (e.button !== 0 || !inGrid(id)) return;
    e.preventDefault(); e.stopPropagation();
    const el = $(W(id).el);
    const r = el.getBoundingClientRect();
    const s = state[id];
    drag = { id, kind: 'resize' };
    el.classList.add('resizing');
    const x0 = e.clientX, y0 = e.clientY, w0 = r.width, h0 = r.height;
    const move = (ev) => {
      const g = geometry();
      const wpx = Math.max(g.col * 2, w0 + ev.clientX - x0);
      const hpx = Math.max(MIN_H, h0 + ev.clientY - y0);
      if (!narrow()) {
        el.style.width = Math.min(wpx, g.width - s.x * g.step) + 'px';
        s.w = Math.max(2, Math.min(COLS - s.x, Math.round((wpx + GAP) / g.step)));
      }
      if (!widthOnly && Math.abs(ev.clientY - y0) > 3) { s.h = Math.round(hpx); s.min = false; el.style.height = s.h + 'px'; el.classList.add('fixedh'); }
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.classList.remove('resizing');
      drag = null;
      apply(); save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ── show / hide ──
  function show(id, opts) {
    const s = state[id];
    if (!s) return;
    const was = s.open;
    s.open = true; s.min = false;
    if (!was && inGrid(id)) s.y = 1e6;           // a window you open goes at the bottom
    apply(); save();
    if (!(opts && opts.noScroll)) reveal(id);
  }
  function hide(id) {
    if (!state[id]) return;
    state[id].open = false;
    apply(); save();
  }
  function toggle(id) { if (state[id].open && !state[id].min) hide(id); else show(id); }
  function isOpen(id) { return !!(state[id] && state[id].open); }
  function visible(id) { return isOpen(id) && !state[id].min; }
  function reveal(id) {
    const el = $(W(id).el);
    if (!el || isPinned(id)) return;
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const dockH = parseFloat(getComputedStyle(document.body).getPropertyValue('--dockH')) || 0;
      if (r.top < 60 || r.top > window.innerHeight - dockH - 120) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function setPinned(on) {
    const s = state.keys;
    s.pinned = !!on;
    if (!on) { s.y = 1e6; s.h = null; }
    apply(); save();
    App.msg(on ? 'Keyboard pinned to the bottom of the screen.' : 'Keyboard is now a window like the others — drag it where you want it. 📌 pins it back.');
  }

  function useLayout(l) {
    App.closePops();
    state = normalise(clone(l));
    apply(); save();
    window.scrollTo(0, 0);
  }

  // ── the Windows menu ──
  function paintMenu() {
    const list = $('winList'), lay = $('layoutList');
    if (!list) return;
    list.innerHTML = '';
    WINS.forEach(w => {
      const row = document.createElement('label');
      row.className = 'chk winchk';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = state[w.id].open; cb.dataset.win = w.id;
      cb.addEventListener('change', () => { if (cb.checked) show(w.id); else hide(w.id); });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(' ' + w.title));
      list.appendChild(row);
    });
    lay.innerHTML = '';
    Object.keys(PRESETS).forEach(name => {
      const b = document.createElement('button');
      b.className = 'menuitem'; b.textContent = name; b.dataset.layout = name;
      b.title = 'Switch to the "' + name + '" layout';
      b.addEventListener('click', () => useLayout(PRESETS[name]));
      lay.appendChild(b);
    });
    const mine = savedLayouts();
    Object.keys(mine).forEach(name => {
      const row = document.createElement('div');
      row.className = 'projrow';
      const b = document.createElement('button');
      b.className = 'menuitem'; b.textContent = '★ ' + name; b.dataset.layout = name;
      b.addEventListener('click', () => useLayout(mine[name]));
      const x = document.createElement('button');
      x.className = 'mini danger'; x.textContent = '×'; x.title = 'Delete this saved layout';
      x.addEventListener('click', (e) => { e.stopPropagation(); const m = savedLayouts(); delete m[name]; setSavedLayouts(m); paintMenu(); });
      row.append(b, x);
      lay.appendChild(row);
    });
  }

  function init() {
    ws = document.querySelector('.workspace');
    decorate();
    $('winBtn').setAttribute('data-pop-anchor', '');
    $('winBtn').addEventListener('click', () => { paintMenu(); App.togglePop($('winMenu'), $('winBtn')); });
    $('layoutReset').addEventListener('click', () => useLayout(PRESETS.Standard));
    $('layoutSave').addEventListener('click', () => {
      const name = (prompt('Name this layout (e.g. "Drums + mixer")') || '').trim();
      if (!name) return;
      const m = savedLayouts(); m[name] = clone(state); setSavedLayouts(m); paintMenu();
      App.msg('Saved the layout "' + name + '" — it\'s in the Windows menu.');
    });
    window.addEventListener('resize', schedule);
    apply();
    requestAnimationFrame(() => document.body.classList.add('wins-ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return {
    show, hide, toggle, isOpen, visible, setPinned, useLayout, layout: () => layout(),
    state: () => clone(state), presets: () => Object.keys(PRESETS),
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();
