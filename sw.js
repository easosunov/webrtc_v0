// Add at the top of sw.js
const APP_VERSION = 'v4.0'; // Increment this with each release
const CACHE_NAME = `webrtc-${APP_VERSION}`;

// In the activate event, delete old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 SW activate version:', APP_VERSION);
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return clients.claim();
    })
  );
});
