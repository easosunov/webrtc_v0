// Simple service worker for offline capability
const CACHE_NAME = 'webrtc-communicator-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/js/config.js',
  '/js/ui.js',
  '/js/init.js',
  '/js/auth.js',
  '/js/users.js',
  '/js/webrtc.js',
  '/js/calls.js',
  '/js/apk.js',
  '/js/chat.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
