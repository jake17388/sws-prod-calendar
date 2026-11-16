// This app has no offline mode — the only job here is to stop the browser
// from ever serving a stale cached copy of our own JS/CSS after a deploy.
// The entry script/stylesheets are already cache-busted with a ?v= query in
// index.html, but the ~15 files app.js imports aren't individually
// versioned, so without this a deploy could leave some of them served from
// GitHub Pages' CDN cache until it naturally expires. Every GET just goes
// straight to the network with caching disabled entirely.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Apps Script responses can contain multi-megabyte PDFs. Let Safari own
  // those cross-origin streams directly instead of wrapping them in the PWA
  // service worker, which can reuse or abort them on memory-constrained iPads.
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
