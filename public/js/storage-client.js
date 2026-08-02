// storage-client.js — save/load patterns via the server's /api/patterns
// endpoints, which persist to a Railway volume (DATA_DIR). Falls back to
// localStorage if the server call fails (e.g. offline), so it never breaks.

const RhythmStorage = (() => {
  const LOCAL_PREFIX = 'rhythmshop:';

  function localListKey(mode) { return `${LOCAL_PREFIX}${mode}:index`; }
  function localPatternKey(mode, name) { return `${LOCAL_PREFIX}${mode}:pattern:${name}`; }

  function localList(mode) {
    try {
      const raw = localStorage.getItem(localListKey(mode));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function localSave(mode, name, data) {
    try {
      const names = localList(mode);
      if (!names.includes(name)) names.push(name);
      localStorage.setItem(localListKey(mode), JSON.stringify(names));
      localStorage.setItem(localPatternKey(mode, name), JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }
  function localLoad(mode, name) {
    try {
      const raw = localStorage.getItem(localPatternKey(mode, name));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function localRemove(mode, name) {
    try {
      const names = localList(mode).filter(n => n !== name);
      localStorage.setItem(localListKey(mode), JSON.stringify(names));
      localStorage.removeItem(localPatternKey(mode, name));
    } catch (e) { /* ignore */ }
  }

  async function list(mode) {
    try {
      const res = await fetch(`/api/patterns/${mode}`);
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      return data.names || [];
    } catch (e) {
      return localList(mode);
    }
  }

  async function save(mode, name, data) {
    localSave(mode, name, data); // always keep a local copy too
    try {
      const res = await fetch(`/api/patterns/${mode}/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function load(mode, name) {
    try {
      const res = await fetch(`/api/patterns/${mode}/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error('not found on server');
      const body = await res.json();
      return body.data;
    } catch (e) {
      return localLoad(mode, name);
    }
  }

  async function remove(mode, name) {
    localRemove(mode, name);
    try {
      const res = await fetch(`/api/patterns/${mode}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  return { list, save, load, remove };
})();
