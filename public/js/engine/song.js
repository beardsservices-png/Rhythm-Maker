// song.js — the arrangement: which variation plays over which bars.
//
// Switching sections by hand is how you PERFORM a song. Writing them down is
// how you FINISH one — the track plays start to end without you, and exports
// as a single file rather than whatever happened to be selected.
//
// An arrangement is a list of blocks: "A for 8 bars, then B for 8". Sections
// drive every part together, because that is what a section is. Per-instrument
// independence stays available for live playing, where it belongs.
//
// One thing this has to do to the transport: the loop normally spans a single
// bar, which means the transport's bar counter never leaves 0. A song needs a
// real position, so enabling song mode widens the loop to the whole
// arrangement. Each part still takes its step index modulo its own 16, so
// patterns keep repeating inside every bar.

const Song = (() => {
  let blocks = [
    { v: 0, bars: 4 },
    { v: 1, bars: 4 },
    { v: 0, bars: 4 },
    { v: 2, bars: 4 }
  ];
  let enabled = false;
  let lastAppliedBar = -1;

  const listeners = new Set();
  function emit() {
    const snap = { blocks: blocks.map(b => ({ ...b })), enabled, totalBars: totalBars() };
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function totalBars() {
    return blocks.reduce((n, b) => n + Math.max(1, b.bars), 0);
  }

  /** Which variation is playing at an absolute bar number. */
  function variationAt(bar) {
    const total = totalBars();
    if (!total) return 0;
    let b = ((bar % total) + total) % total;
    for (const blk of blocks) {
      const len = Math.max(1, blk.bars);
      if (b < len) return blk.v;
      b -= len;
    }
    return blocks.length ? blocks[blocks.length - 1].v : 0;
  }

  /** Index of the block containing an absolute bar — for highlighting. */
  function blockAt(bar) {
    const total = totalBars();
    if (!total) return -1;
    let b = ((bar % total) + total) % total;
    for (let i = 0; i < blocks.length; i++) {
      const len = Math.max(1, blocks[i].bars);
      if (b < len) return i;
      b -= len;
    }
    return blocks.length - 1;
  }

  function applyLoop() {
    const st = Transport.getState();
    if (enabled) {
      Transport.setLoop(0, totalBars() * st.stepsPerBar, true);
    } else {
      Transport.setLoop(0, st.stepsPerBar, true);   // back to a one-bar loop
    }
  }

  function setEnabled(on) {
    enabled = !!on;
    lastAppliedBar = -1;
    applyLoop();
    if (enabled) Variations.selectAll(variationAt(0), true);
    emit();
  }

  function setBlocks(next) {
    blocks = (next || []).map(b => ({
      v: Math.max(0, Math.min(Variations.COUNT - 1, b.v | 0)),
      bars: Math.max(1, Math.min(64, b.bars | 0))
    }));
    if (!blocks.length) blocks = [{ v: 0, bars: 4 }];
    if (enabled) applyLoop();
    emit();
  }

  function addBlock(v, bars) {
    blocks.push({ v: v | 0, bars: Math.max(1, bars | 0 || 4) });
    if (enabled) applyLoop();
    emit();
  }

  function removeBlock(i) {
    if (blocks.length <= 1) return;
    blocks.splice(i, 1);
    if (enabled) applyLoop();
    emit();
  }

  function cycleVariation(i) {
    if (!blocks[i]) return;
    blocks[i].v = (blocks[i].v + 1) % Variations.COUNT;
    emit();
  }

  function setBars(i, bars) {
    if (!blocks[i]) return;
    blocks[i].bars = Math.max(1, Math.min(64, bars | 0));
    if (enabled) applyLoop();
    emit();
  }

  /**
   * Called on every scheduled step. Sets the section's variation exactly on
   * the bar line — immediately rather than queued, because we are already at
   * the boundary a queued switch would have waited for.
   */
  function tick(ev) {
    if (!enabled || ev.stepInBar !== 0) return;
    if (ev.bar === lastAppliedBar) return;
    lastAppliedBar = ev.bar;
    Variations.selectAll(variationAt(ev.bar), true);
    emit();
  }

  function serialize() { return { blocks: blocks.map(b => ({ ...b })), enabled }; }
  function restore(data) {
    if (!data) return;
    if (Array.isArray(data.blocks) && data.blocks.length) setBlocks(data.blocks);
    setEnabled(!!data.enabled);
  }

  return {
    onChange, totalBars, variationAt, blockAt,
    setEnabled, isEnabled: () => enabled,
    getBlocks: () => blocks.map(b => ({ ...b })),
    setBlocks, addBlock, removeBlock, cycleVariation, setBars,
    tick, serialize, restore
  };
})();
