// studio-project.js — save, open and start over.
//
// A project is JSON plus sidecar WAVs: recorded takes and uploaded files are
// megabytes of audio, and base64 inside JSON would inflate them and rewrite
// the whole file on every save. The JSON names each clip by its audio id; the
// audio goes up and comes back separately. (Uploads are now saved too — the
// old sample timeline forgot them on reload.)
//
// Projects saved by the old studio still open: Project.restore() converts
// them, and their mixer strips keep their old ids so the faders land right.

(function () {
  const $ = (id) => document.getElementById(id);
  const listEl = $('projList');
  const nameIn = $('projName');
  const saveBtn = $('saveBtn');
  if (!saveBtn) return;

  function collect() {
    return Object.assign(Project.serialize(), {
      savedAt: new Date().toISOString(),
      mixer: Mixer.serialize(),
      fx: Effects.serialize()
    });
  }

  async function save() {
    let name = (nameIn.value || '').trim();
    if (!name) {
      name = (prompt('Name this track') || '').trim();
      if (!name) return;
      nameIn.value = name;
    }
    saveBtn.disabled = true;
    App.msg('Saving…');
    try {
      const data = collect();
      const res = await fetch('/api/projects/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      if (!res.ok) throw new Error('the server refused it (' + res.status + ')');

      const ids = new Set(Project.tracks().filter(t => t.kind === 'audio').map(t => t.audioId));
      let uploaded = 0;
      for (const id of ids) {
        const buf = Project.getAudio(id);
        if (!buf) continue;
        const up = await fetch(`/api/projects/${encodeURIComponent(name)}/audio/${id}`, {
          method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: WavCodec.toBlob(buf)
        });
        if (up.ok) uploaded++;
      }
      App.msg(`Saved "${name}"` + (uploaded ? ` with ${uploaded} audio clip${uploaded === 1 ? '' : 's'}.` : '.'));
    } catch (e) {
      App.msg('Could not save: ' + e.message, true);
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function load(name) {
    App.msg('Opening…');
    try {
      const res = await fetch('/api/projects/' + encodeURIComponent(name));
      if (!res.ok) throw new Error('not found');
      const { data } = await res.json();
      if (Transport.isPlaying) Transport.stop();
      const ctx = App.ensureAudio();
      Project.restore(data);
      window.dispatchEvent(new CustomEvent('bhs:apply-fx', { detail: { fx: data.fx || Effects.serialize() } }));
      if (data.mixer) { Mixer.restore(data.mixer); window.dispatchEvent(new CustomEvent('bhs:mixer-restored')); }

      let restored = 0;
      for (const t of Project.tracks().filter(x => x.kind === 'audio')) {
        if (Project.getAudio(t.audioId)) continue;
        try {
          const a = await fetch(`/api/projects/${encodeURIComponent(name)}/audio/${t.audioId}`);
          if (!a.ok) continue;
          Project.setAudio(t.audioId, await WavCodec.decode(ctx, await a.arrayBuffer()));
          restored++;
        } catch (_) { /* one missing clip shouldn't fail the whole load */ }
      }
      nameIn.value = name;
      App.select(Project.tracks()[0] && Project.tracks()[0].id);
      App.msg(`Opened "${name}"` + (restored ? ` with ${restored} audio clip${restored === 1 ? '' : 's'}.` : '.'));
    } catch (e) {
      App.msg('Could not open: ' + e.message, true);
    }
  }

  async function remove(name) {
    if (!confirm(`Delete "${name}" from the server? This can't be undone.`)) return;
    await fetch('/api/projects/' + encodeURIComponent(name), { method: 'DELETE' });
    App.msg(`Deleted "${name}".`);
    refresh();
  }

  async function refresh() {
    listEl.innerHTML = '';
    try {
      const res = await fetch('/api/projects');
      const { names } = await res.json();
      if (!names || !names.length) { listEl.textContent = 'Nothing saved yet.'; return; }
      names.sort((a, b) => a.localeCompare(b)).forEach(n => {
        const row = document.createElement('div');
        row.className = 'projrow';
        const b = document.createElement('button');
        b.className = 'menuitem';
        b.textContent = n;
        b.addEventListener('click', () => { $('openMenu').hidden = true; load(n); });
        const x = document.createElement('button');
        x.className = 'mini danger';
        x.textContent = '×';
        x.title = 'Delete';
        x.addEventListener('click', () => remove(n));
        row.appendChild(b); row.appendChild(x);
        listEl.appendChild(row);
      });
    } catch (e) {
      listEl.textContent = 'Could not reach the server.';
    }
  }

  saveBtn.addEventListener('click', save);
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  $('openBtn').addEventListener('click', (e) => { refresh(); App.togglePop($('openMenu'), e.currentTarget); });
  $('newProjBtn').addEventListener('click', () => {
    if (!confirm('Start a new track? Anything unsaved here is lost.')) return;
    $('openMenu').hidden = true;
    if (Transport.isPlaying) Transport.stop();
    Project.reset();
    nameIn.value = '';
    App.select(Project.tracks()[0] && Project.tracks()[0].id);
    App.msg('New track — the demo beat is loaded so there is something to start from.');
  });

  // Ctrl/Cmd+S saves.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });

  window.__bhsCollect = collect;
  window.__bhsLoad = load;
})();
