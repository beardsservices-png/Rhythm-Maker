// sw.js — makes Rhythm Shop an installable app that still opens offline.
//
// NETWORK FIRST for the app's own files: when you're online you always get
// the latest version straight from the server (no "stuck on an old version"
// after a deploy), and every file fetched is copied into the cache. When the
// network is gone, the cached copy is served instead, so the pages, the
// Studio, the instruments and Practice Mode all still open.
//
// The /api/ routes (saving, loading, Ask Claude) and other sites (the
// MediaPipe CDN) are never cached — they go straight to the network.

const CACHE = 'rhythm-shop-v3';
const SHELL = ['/', '/index.html', '/studio.html', '/practice.html', '/manual.html', '/manifest.webmanifest',
               '/css/base.css', '/css/studio.css', '/css/practice.css', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Instrument recordings are big and never change: cache first, so a song
  // opens instantly (and offline) once its instruments have been heard once.
  if (url.pathname.startsWith('/samples/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then(hit => hit || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
  );
});
