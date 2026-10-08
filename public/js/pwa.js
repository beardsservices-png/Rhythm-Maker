// pwa.js — register the service worker (installable + offline), and on the
// home page offer the right "install" path for the phone you're on.

(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* http or private mode — still works as a site */ });
    });
  }

  const box = document.getElementById('installBox');
  if (!box) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;                       // already installed

  const btn = document.getElementById('installBtn');
  const hint = document.getElementById('installHint');
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Android / desktop Chrome & Edge: the browser hands us an install prompt.
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    box.hidden = false;
    btn.hidden = false;
    hint.textContent = 'Puts Rhythm Shop on your home screen as its own app — full screen, no browser bar.';
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    box.hidden = true;
  });
  window.addEventListener('appinstalled', () => { box.hidden = true; });

  // iPhone / iPad: Safari has no install button for sites — say how.
  if (ios) {
    box.hidden = false;
    btn.hidden = true;
    hint.innerHTML = 'To install on your iPhone: open this page in <b>Safari</b>, tap the <b>Share</b> button ' +
      '(the square with the arrow), then <b>Add to Home Screen</b>.';
  }
})();
