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

  $('ssContinue').addEventListener('click', cont);
  // Closing without choosing never throws work away: it continues the
  // autosave if there is one, otherwise keeps the demo.
  $('ssClose').addEventListener('click', cont);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) cont(); });

  document.addEventListener('DOMContentLoaded', () => show(false));

  return { show, hide, choose, cont, isOpen: () => !el.hidden };
})();
