// assist.js — "Ask a music question" for Practice Mode.
// A plain Q&A helper for a beginner: it explains, it doesn't do the practising.
// Hidden unless the server has an API key; throttled and daily-capped so a kid
// left alone with it can't run up a bill.

(function () {
  'use strict';
  const panel = document.getElementById('assistPanel');
  const form = document.getElementById('assistForm');
  const input = document.getElementById('assistInput');
  const send = document.getElementById('assistSend');
  const log = document.getElementById('assistLog');
  if (!panel || !form) return;

  const CAP_PER_DAY = 40;
  const MIN_GAP_MS = 4000;
  let lastAt = 0;

  function usage() {
    const today = new Date().toISOString().slice(0, 10);
    let u = { day: today, n: 0 };
    try { u = JSON.parse(localStorage.getItem('rhythmshop:practice:assist') || 'null') || u; } catch (e) {}
    if (u.day !== today) u = { day: today, n: 0 };
    return u;
  }
  function bumpUsage() {
    const u = usage(); u.n++;
    try { localStorage.setItem('rhythmshop:practice:assist', JSON.stringify(u)); } catch (e) {}
  }

  function bubble(text, who) {
    const d = document.createElement('div');
    d.className = 'assist-msg ' + who;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  // Reveal the panel only if the server can actually answer.
  fetch('/api/practice-assist')
    .then(r => r.json())
    .then(d => { if (d && d.available) panel.hidden = false; })
    .catch(() => { /* stay hidden */ });

  function currentContext() {
    const inst = document.querySelector('#instPicker .inst-btn.active');
    const target = document.getElementById('targetName');
    return {
      instrument: inst ? inst.textContent.trim() : 'flute',
      currentNote: target ? target.textContent.trim() : null,
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;

    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) { bubble('One sec — ask me again in a moment.', 'sys'); return; }
    if (usage().n >= CAP_PER_DAY) { bubble('That’s a lot of questions for one day! Ask a grown-up if you need more.', 'sys'); return; }
    lastAt = now;

    bubble(q, 'me');
    input.value = '';
    send.disabled = true;
    const thinking = bubble('thinking…', 'ai');

    try {
      const res = await fetch('/api/practice-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, context: currentContext() }),
      });
      const data = await res.json().catch(() => ({}));
      thinking.remove();
      if (!res.ok) {
        bubble(data.error || 'Couldn’t answer that one — try again in a minute.', 'sys');
      } else {
        bubble(data.answer || '…', 'ai');
        bumpUsage();
      }
    } catch (err) {
      thinking.remove();
      bubble('Couldn’t reach the helper. Check the internet connection.', 'sys');
    }
    send.disabled = false;
  });
})();
