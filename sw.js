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
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
