// variations.js — the pattern bank behind A/B/C/D switching.
//
// Round Robin had one A/B pair and flipped EVERY instrument at once. That
// makes two whole beats, not a song. A song is built from parts that change
// at different moments: the hats go busy a bar before the bass drops, the
// snare pattern changes but the kick holds. So every part owns its own set of
// four variations and its own current selection.
//
// Switches are queued and applied on the next bar line rather than instantly.
// Flipping a pattern mid-bar lands the change on an off-beat and sounds like a
// mistake, which is exactly what the transport's bar clock is there to avoid.

const Variations = (() => {
  const COUNT = 4;
  const NAMES = ['A', 'B', 'C', 'D'];

  // partId -> { current, pending, banks: [v0, v1, v2, v3] }
  const parts = new Map();
  const listeners = new Set();

  function emit() {
    const snap = {};
    parts.forEach((p, id) => { snap[id] = { current: p.current, pending: p.pending }; });
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** @param makeEmpty a factory for one blank variation of this part */
  function register(id, makeEmpty) {
    if (parts.has(id)) return parts.get(id);
    const p = {
      current: 0,
      pending: null,
      banks: Array.from({ length: COUNT }, () => makeEmpty())
    };
    parts.set(id, p);
    return p;
  }

  function active(id) {
    const p = parts.get(id);
    return p ? p.banks[p.current] : null;
  }

  function bank(id, v) {
    const p = parts.get(id);
    return p ? p.banks[v] : null;
  }

  function setBank(id, v, value) {
    const p = parts.get(id);
    if (p) p.banks[v] = value;
  }

  function currentIndex(id) {
    const p = parts.get(id);
    return p ? p.current : 0;
  }

  /**
   * Queue a switch. Takes effect on the next bar while playing; immediately
   * when stopped, since there is no downbeat to wait for.
   */
  function select(id, v, immediate) {
    const p = parts.get(id);
    if (!p || v < 0 || v >= COUNT) return;
    if (immediate || !Transport.isPlaying) {
      p.current = v;
      p.pending = null;
    } else if (p.current === v) {
      p.pending = null;               // cancel a queued change
    } else {
      p.pending = v;
    }
    emit();
  }

  function selectAll(v, immediate) {
    parts.forEach((_, id) => select(id, v, immediate));
  }

  /** Duplicate the live variation into another slot — "make B from A". */
  function copyTo(id, target, cloneFn) {
    const p = parts.get(id);
    if (!p || target < 0 || target >= COUNT || target === p.current) return false;
    p.banks[target] = cloneFn(p.banks[p.current]);
    return true;
  }

  function copyAllTo(target, cloners) {
    let n = 0;
    parts.forEach((p, id) => {
      const fn = cloners[id] || cloners.default;
      if (fn && copyTo(id, target, fn)) n++;
    });
    emit();
    return n;
  }

  /** Called by the transport on every step; applies queued switches on bar 1. */
  function tick(ev) {
    if (ev.stepInBar !== 0) return;
    let changed = false;
    parts.forEach(p => {
      if (p.pending != null) { p.current = p.pending; p.pending = null; changed = true; }
    });
    if (changed) emit();
  }

  function serialize(id) {
    const p = parts.get(id);
    return p ? { current: p.current, pending: p.pending, banks: p.banks } : null;
  }

  /**
   * The A/B/C/D row shown beside a part. Lives here rather than in one of the
   * part modules because every part needs it and they load in different
   * orders — a helper defined in a later file isn't there when an earlier one
   * initialises.
   */
  function buildPicker(id) {
    const wrap = document.createElement('div');
    wrap.className = 'vpick';
    wrap.dataset.part = id;
    NAMES.forEach((label, v) => {
      const b = document.createElement('button');
      b.className = 'vbtn';
      b.textContent = label;
      b.dataset.v = String(v);
      b.title = `Switch this part to ${label} on the next bar`;
      b.addEventListener('click', () => select(id, v));
      wrap.appendChild(b);
    });
    paint(wrap, currentIndex(id), null);
    return wrap;
  }

  function paint(wrap, cur, pending) {
    wrap.querySelectorAll('.vbtn').forEach(b => {
      const v = parseInt(b.dataset.v, 10);
      b.classList.toggle('on', v === cur);
      b.classList.toggle('queued', pending === v);
    });
  }

  // Every picker on the page repaints itself whenever the bank changes.
  onChange((snap) => {
    document.querySelectorAll('.vpick').forEach(w => {
      const st = snap[w.dataset.part];
      if (st) paint(w, st.current, st.pending);
    });
  });

  function restore(id, data, coerce) {
    const p = parts.get(id);
    if (!p || !data) return;
    if (Array.isArray(data.banks)) {
      for (let v = 0; v < COUNT; v++) {
        if (data.banks[v] != null) p.banks[v] = coerce ? coerce(data.banks[v]) : data.banks[v];
      }
    }
    if (typeof data.current === 'number') p.current = Math.max(0, Math.min(COUNT - 1, data.current));
    p.pending = null;
    emit();
  }

  return {
    COUNT, NAMES, register, active, bank, setBank, currentIndex,
    select, selectAll, copyTo, copyAllTo, tick, onChange, serialize, restore, buildPicker,
    ids: () => Array.from(parts.keys())
  };
})();
