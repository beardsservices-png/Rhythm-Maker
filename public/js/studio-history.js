// studio-history.js — undo/redo, and autosave so a closed tab loses nothing.
//
// UNDO works on whole-song snapshots. After any edit settles (a quarter of a
// second, so a knob drag is one step, not fifty) the song is serialised and
// compared with the last snapshot; if it changed, the old one goes on the undo
// stack. Which pattern is playing live and loop-vs-song mode are NOT part of a
// snapshot — undo takes back edits, not what you were performing.
//
// AUTOSAVE keeps the latest song in this browser: the song itself, mixer and
// effects in localStorage, recorded/uploaded audio in IndexedDB (far too big
// for localStorage). The start screen offers "Continue where you left off".
// This is a safety net on one device — Save still puts it on the server.

const History = (() => {
  const $ = (id) => document.getElementById(id);
  const MUTATING = new Set(['tracks', 'pattern', 'sections', 'cells', 'sound', 'param', 'bpm', 'swing', 'key', 'pump', 'character', 'tune']);
  const LIMIT = 100;
  const KEY = 'bhs.studio.autosave';

  let undoStack = [], redoStack = [];
  let current = snap();
  let timer = null;
  let restoring = false;

  function snap() {
    const d = Project.serialize();
    delete d.mode;
    d.tracks.forEach(t => { delete t.live; delete t.edit; delete t.pending; });
    return JSON.stringify(d);
  }

  function paint() {
    $('undoBtn').disabled = !undoStack.length;
    $('redoBtn').disabled = !redoStack.length;
  }

  function commit() {
    clearTimeout(timer); timer = null;
    const now = snap();
    if (now === current) return;
    undoStack.push(current);
    if (undoStack.length > LIMIT) undoStack.shift();
    current = now;
    redoStack = [];
    paint();
  }

  function apply(json) {
    const d = JSON.parse(json);
    // Keep what's playing live and the play mode exactly as they are now.
    d.mode = Project.mode();
    d.tracks.forEach(t => {
      const cur = Project.track(t.id);
      t.live = cur ? cur.live : 0;
      t.edit = cur ? cur.edit : 0;
    });
    restoring = true;
    try { Project.restore(d, { keep: true }); } finally { restoring = false; }
    paint();
    scheduleSave();
  }

  function undo() {
    if (timer) commit();
    if (!undoStack.length) { App.msg('Nothing to undo.'); return; }
    redoStack.push(current);
    current = undoStack.pop();
    apply(current);
    App.msg('Undone.');
  }

  function redo() {
    if (timer) commit();
    if (!redoStack.length) { App.msg('Nothing to redo.'); return; }
    undoStack.push(current);
    current = redoStack.pop();
    apply(current);
    App.msg('Redone.');
  }

  Project.on((reason) => {
    if (reason === 'load') {
      undoStack = []; redoStack = []; current = snap(); paint();
      scheduleSave(true);
      return;
    }
    if (reason === 'audio') { scheduleSave(); return; }
    if (restoring || !MUTATING.has(reason)) return;
    clearTimeout(timer);
    timer = setTimeout(commit, 250);
    scheduleSave();
  });

  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
  });

  // ── autosave ───────────────────────────────────────────────────────
  let saveTimer = null;
  let suspended = true;        // until the start screen has decided what's loaded
  let wipeAudio = false;

  function scheduleSave(newSong) {
    if (newSong) wipeAudio = true;
    if (suspended) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1200);
  }

  function idb() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('bhs-studio', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('audio');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  }
  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction('audio', mode);
      const store = t.objectStore('audio');
      const out = fn(store);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  async function saveNow() {
    try {
      const data = {
        savedAt: Date.now(),
        name: $('projName').value || '',
        project: Project.serialize(),
        mixer: Mixer.serialize(),
        fx: Effects.serialize()
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (_) { /* private mode / full storage — the safety net just isn't there */ }
    try {
      const db = await idb();
      const wanted = new Map();
      Project.tracks().forEach(t => { if (t.kind === 'audio' && Project.getAudio(t.audioId)) wanted.set(String(t.audioId), Project.getAudio(t.audioId)); });
      const have = await tx(db, 'readonly', s => s.getAllKeys());
      const haveSet = new Set((have || []).map(String));
      await tx(db, 'readwrite', s => {
        if (wipeAudio) haveSet.forEach(k => { if (!wanted.has(k)) s.delete(k); });
        haveSet.forEach(k => { if (!wanted.has(k)) s.delete(k); });
        wanted.forEach((buf, k) => {
          if (haveSet.has(k) && !wipeAudio) return;
          const chans = [];
          for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).slice());
          s.put({ rate: buf.sampleRate, chans }, k);
        });
      });
      wipeAudio = false;
      db.close();
    } catch (_) { /* no IndexedDB — the song still autosaves, just not its audio */ }
  }

  function saved() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  }

  /** Put the autosaved song back, audio included. */
  async function restoreAutosave() {
    const d = saved();
    if (!d || !d.project) return false;
    const buffers = new Map();
    try {
      const ac = App.ensureAudio();
      const db = await idb();
      const ids = d.project.tracks.filter(t => t.kind === 'audio').map(t => String(t.audioId));
      for (const k of ids) {
        const rec = await tx(db, 'readonly', s => s.get(k));
        if (rec && rec.chans && rec.chans.length) {
          const b = ac.createBuffer(rec.chans.length, rec.chans[0].length, rec.rate);
          rec.chans.forEach((ch, c) => b.copyToChannel(ch, c));
          buffers.set(k, b);
        }
      }
      db.close();
    } catch (_) { /* audio unavailable — the song still comes back */ }
    Project.restore(d.project);
    buffers.forEach((b, k) => Project.setAudio(+k, b));
    if (d.fx) window.dispatchEvent(new CustomEvent('bhs:apply-fx', { detail: { fx: d.fx } }));
    if (d.mixer) { Mixer.restore(d.mixer); window.dispatchEvent(new CustomEvent('bhs:mixer-restored')); }
    $('projName').value = d.name || '';
    wipeAudio = false;
    return true;
  }

  /** Called once the start screen has loaded something; from then on, keep saving. */
  function resume() { suspended = false; scheduleSave(); }

  if (typeof Mixer !== 'undefined') Mixer.onChange(() => scheduleSave());
  window.addEventListener('beforeunload', () => { if (!suspended) { clearTimeout(saveTimer); try { saveNow(); } catch (_) {} } });

  paint();
  return { undo, redo, saved, restoreAutosave, resume, commit, saveNow };
})();
