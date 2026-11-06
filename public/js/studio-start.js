// studio-start.js — the start screen: pick up where you left off, start from a
// template, or open a saved track. Shown every time the Studio opens (like a
// groovebox's start page), and from Open → "New from a template…".

const StartScreen = (() => {
  const $ = (id) => document.getElementById(id);
  const el = $('startScreen');
  let midSession = false;

  function begin(fn) {
    if (Transport.isPlaying) Transport.stop();
    return Promise.resolve(fn()).then(() => {
      hide();
      History.resume();
      App.select(Project.tracks()[0] && Project.tracks()[0].id);
    });
  }

  function choose(id) {
    return begin(() => {
      if (id === 'demo') Project.reset();
      else Project.restore(Templates.build(id));
      $('projName').value = '';
      const t = Templates.list().find(x => x.id === id);
      App.msg(id === 'blank'
        ? 'Blank track — click steps in the drum machine, or play the keys with "Write notes" on.'
        : `${t ? t.label : 'Demo'} template loaded — press Play (Space). Everything in it is yours to change.`);
    });
  }

  function cont() {
    if (midSession) { hide(); return Promise.resolve(); }
    return begin(async () => {
      const ok = await History.restoreAutosave();
      if (!ok) Project.reset();
      App.msg(ok ? 'Picked up where you left off.' : 'Demo beat loaded.');
    });
  }

  async function renderSaved() {
    const box = $('ssSaved');
    box.textContent = 'Loading…';
    try {
      const { names } = await (await fetch('/api/projects')).json();
      box.innerHTML = '';
      if (!names || !names.length) { box.textContent = 'Nothing saved on the server yet.'; return; }
      names.sort((a, b) => a.localeCompare(b)).forEach(n => {
        const b = document.createElement('button');
        b.className = 'menuitem';
        b.textContent = n;
        b.addEventListener('click', () => begin(() => window.__bhsLoad(n)));
        box.appendChild(b);
      });
    } catch (_) { box.textContent = 'Could not reach the server.'; }
  }

  function show(fromMenu) {
    midSession = !!fromMenu;
    const saved = History.saved();
    const c = $('ssContinue');
    if (midSession) {
      c.hidden = false;
      c.textContent = 'Back to what I was doing';
    } else if (saved && saved.project) {
      c.hidden = false;
      const when = new Date(saved.savedAt || Date.now());
      c.textContent = `Continue where you left off${saved.name ? ' — ' + saved.name : ''} (${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`;
    } else {
      c.hidden = true;
    }
    el.hidden = false;
    renderSaved();
  }

  function hide() { el.hidden = true; }

  // Template cards
  const grid = $('ssTemplates');
  [...Templates.list(), { id: 'demo', label: 'BHS demo', blurb: '90 BPM · the beat the Studio ships with' }].forEach(t => {
    const b = document.createElement('button');
    b.className = 'ss-tpl';
    b.dataset.id = t.id;
    b.innerHTML = `<b>${t.label}</b><span>${t.blurb}</span>`;
    b.addEventListener('click', () => {
      if (midSession && !confirm(`Start a new ${t.label} track? Anything unsaved here is lost (it's still autosaved until you change the new one).`)) return;
      choose(t.id);
    });
    grid.appendChild(b);
  });

  // Open a song file: sheet music (MusicXML) or MIDI -> a new song, saved to the library.
  const fileIn = $('ssFile'), fileMsg = $('ssFileMsg');
  const say = (t, err) => { fileMsg.hidden = false; fileMsg.textContent = t; fileMsg.classList.toggle('err', !!err); };
  $('ssOpenFile').addEventListener('click', () => {
    if (midSession && !confirm('Open a song file as a new track? Anything unsaved here is lost (it\'s still autosaved until you change the new one).')) return;
    fileIn.value = '';
    fileIn.click();
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    say('Reading ' + f.name + '…');
    let spec;
    try { spec = await SongFile.read(f); } catch (e) { say(e.message || 'Could not read that file.', true); return; }
    // Never overwrite something already in the library with the same name.
    // The library keeps letters, digits, spaces, - and _ only (server rule): name it that way up front.
    const base = spec.label.replace(/[^a-z0-9 _-]+/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 56) || 'Song';
    let name = base, taken = [];
    try { taken = ((await (await fetch('/api/projects')).json()).names) || []; } catch (_) { /* offline: save will say so */ }
    for (let i = 2; taken.includes(name); i++) name = `${base} ${i}`;
    const sum = spec._summary;
    await begin(() => { Project.restore(Templates.fromSpec(spec)); $('projName').value = name; });
    fileMsg.hidden = true;
    App.msg(`Opened "${name}": ${sum.tracks} tracks, ${sum.bars} bars. Saving it to your library…`);
    const saveBtn = $('saveBtn');
    if (saveBtn) saveBtn.click();
  });

  $('ssContinue').addEventListener('click', cont);
  // Closing without choosing never throws work away: it continues the
  // autosave if there is one, otherwise keeps the demo.
  $('ssClose').addEventListener('click', cont);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) cont(); });

  document.addEventListener('DOMContentLoaded', () => show(false));

  return { show, hide, choose, cont, isOpen: () => !el.hidden };
})();
