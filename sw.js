// Offline support for Beneath the Skin.
// The page registers this as sw.js?v=VERSION and fills the 'bts-v<VERSION>' cache itself
// (see the "Offline play" script in index.html). This worker only serves from it.
const VERSION = new URL(self.location).searchParams.get('v') || '0';
const CACHE = 'bts-v' + VERSION;
const FONTS = 'bts-fonts';

self.addEventListener('install', () => self.skipWaiting());

// A new version takes over straight away and deletes the old version's files.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('bts-') && k !== CACHE && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The page itself: always try the network first so new versions show up,
  // and fall back to the saved copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .catch(() => caches.match(new URL('./', self.registration.scope).href, { cacheName: CACHE }))
    );
    return;
  }

  // Google Fonts: keep a copy the first time they load.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  // Game files: URLs carry ?v=VERSION, so a cached copy is always the right one.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { cacheName: CACHE }).then(hit => hit || fetch(req)));
  }
});
