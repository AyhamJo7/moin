/**
 * PWA service worker, app shell only (P13.11.03).
 *
 * The shell (/, manifest, icon) is cache-first so the app opens offline with
 * the offline notice. API responses are never cached: no personal data rests
 * in the cache (INV-12, P13 privacy).
 */

const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('shell-v1').then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});
