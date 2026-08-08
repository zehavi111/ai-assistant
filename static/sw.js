// Service worker: app-shell cache-first, API network-only.
// Convention: bump CACHE version on ANY static file change.
const CACHE = 'shell-v4';

const SHELL = [
  '/',
  '/manifest.json',
  '/static/css/tokens.css',
  '/static/css/app.css',
  '/static/js/app.js',
  '/static/js/api.js',
  '/static/js/ui.js',
  '/static/js/views/login.js',
  '/static/js/views/today.js',
  '/static/js/views/tasks.js',
  '/static/js/views/calendar.js',
  '/static/js/views/people.js',
  '/static/js/views/meals.js',
  '/static/js/views/study.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // network-only: stale life data is worse than an error
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
    )
  );
});
