// studio-project.js — save and load a whole session.
//
// A project is JSON plus sidecar WAVs, not one document: recorded loops are
// megabytes of PCM, and base64 in JSON inflates them ~33% while forcing a
// rewrite of the whole file on every save. The JSON references each loop by
// slot; the audio is uploaded and fetched separately.
//
// Everything lands on the Railway volume at DATA_DIR, so it survives redeploys.

(function () {
  const listEl = document.getElementById('projList');
  const saveBtn = document.getElementById('projSave');
  const nameIn = document.getElementById('projName');
  const msgEl = document.getElementById('projMsg');
  if (!saveBtn) return;

  function msg(t, bad) {
    msgEl.textContent = t || '';
    msgEl.classList.toggle('bad', !!bad);
  }

  // Other modules own their own state, so they publish a snapshot on request
  // rather than this file reaching into them.
  function collect() {
    const req = (type) => {
      const ev = new CustomEvent(type, { detail: {} });
      window.dispatchEvent(ev);
      return ev.detail;
    };
    const seq = req('bhs:collect-sequencer');
    const voice = req('bhs:collect-voice');
    const st = Transport.getState();
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      bpm: st.bpm,
      pattern: seq.pattern || [],
      voice: voice.params || {},
      loops: Looper.getSlots()
        .filter(s => !!s.buffer)
        .map(s => ({ index: s.index, bars: s.bars, volume: s.volume }))
    };
  }

  async function save() {
    const name = (nameIn.value || '').trim();
    if (!name) { msg('Give it a name first.', true); nameIn.focus(); return; }

    saveBtn.disabled = true;
    msg('Saving…');
    try {
      const data = collect();
      const res = await fetch('/api/projects/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      if (!res.ok) throw new Error('Server refused the project (' + res.status + ')');

      // Upload each recorded loop as a real WAV alongside it.
      let uploaded = 0;
      for (const s of Looper.getSlots()) {
        if (!s.buffer) continue;
        const blob = WavCodec.toBlob(s.buffer);
        const up = await fetch(`/api/projects/${encodeURIComponent(name)}/audio/${s.index}`, {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: blob
        });
        if (up.ok) uploaded++;
      }

      msg(`Saved "${name}"` + (uploaded ? ` with ${uploaded} loop${uploaded === 1 ? '' : 's'}.` : '.'));
      refresh();
    } catch (e) {
      msg('Could not save: ' + e.message, true);
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function load(name) {
    msg('Loading…');
    try {
      const res = await fetch('/api/projects/' + encodeURIComponent(name));
      if (!res.ok) throw new Error('Not found');
      const { data } = await res.json();

      if (data.bpm) Transport.setBpm(data.bpm);
      window.dispatchEvent(new CustomEvent('bhs:apply-sequencer', {
        detail: { pattern: data.pattern || [], bpm: data.bpm }
      }));
      if (data.voice) {
        window.dispatchEvent(new CustomEvent('bhs:apply-voice', { detail: { params: data.voice } }));
      }

      // Pull each loop's audio back and hand it to the looper.
      const ctx = Synth808.ensureContext();
      let restored = 0;
      for (const l of (data.loops || [])) {
        try {
          const a = await fetch(`/api/projects/${encodeURIComponent(name)}/audio/${l.index}`);
          if (!a.ok) continue;
          const buf = await WavCodec.decode(ctx, await a.arrayBuffer());
          Looper.restoreSlot(l.index, buf, l.bars, l.volume);
          restored++;
        } catch (_) { /* a missing loop shouldn't fail the whole load */ }
      }

      msg(`Loaded "${name}"` + (restored ? ` with ${restored} loop${restored === 1 ? '' : 's'}.` : '.'));
      nameIn.value = name;
    } catch (e) {
      msg('Could not load: ' + e.message, true);
    }
  }

  async function remove(name) {
    await fetch('/api/projects/' + encodeURIComponent(name), { method: 'DELETE' });
    msg(`Deleted "${name}".`);
    refresh();
  }

  async function refresh() {
    try {
      const res = await fetch('/api/projects');
      const { names } = await res.json();
      listEl.innerHTML = '';
      if (!names || !names.length) { listEl.textContent = 'Nothing saved yet.'; return; }
      names.forEach(n => {
        const b = document.createElement('button');
        b.textContent = n;
        b.title = 'Click to load, shift-click to delete';
        b.addEventListener('click', (e) => e.shiftKey ? remove(n) : load(n));
        listEl.appendChild(b);
      });
    } catch (e) {
      listEl.textContent = 'Could not reach the server.';
    }
  }

  saveBtn.addEventListener('click', save);
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  refresh();
})();
