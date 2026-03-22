// ==================== SERVICE WORKER ====================

const CACHE_NAME = 'webrtc-v3';

const urlsToCache = [
  '/webrtc_v0/',
  '/webrtc_v0/index.html',
  '/webrtc_v0/css/styles.css',
  '/webrtc_v0/js/config.js',
  '/webrtc_v0/js/ui.js',
  '/webrtc_v0/js/auth.js',
  '/webrtc_v0/js/users.js',
  '/webrtc_v0/js/webrtc.js',
  '/webrtc_v0/js/calls.js',
  '/webrtc_v0/js/chat.js',
  '/webrtc_v0/js/apk.js'
];

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
  console.log('🔧 SW installing');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Caching files...');
      return cache.addAll(urlsToCache).catch(err => {
        console.error('Cache addAll failed:', err);
      });
    })
  );

  self.skipWaiting();
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
  console.log('🚀 SW active');
  event.waitUntil(clients.claim());
});

// ==================== FETCH ====================
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((res) => {
      return res || fetch(event.request);
    })
  );
});

// ==================== PUSH ====================
self.addEventListener('push', (event) => {
  console.log('🔥 PUSH RECEIVED');

  let data = {};

  try {
    data = event.data ? event.data.json() : {};
    console.log('📦 Data:', data);
  } catch (e) {
    console.error('❌ JSON parse error', e);
  }

  const title = data.title || 'Incoming Call';

  const options = {
    body: data.body || 'You have an incoming call',
    icon: data.icon || 'https://easosunov.github.io/webrtc_v0/favicon.ico',
    badge: data.icon || 'https://easosunov.github.io/webrtc_v0/favicon.ico',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    tag: 'incoming-call',
    renotify: true,
    data: {
      callId: data.callId,
      callerId: data.callerId,
      url: data.url || '/webrtc_v0/'
    },
    actions: [
      { action: 'answer', title: 'Answer' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  // ✅ NO setTimeout — CRITICAL FOR ANDROID
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ==================== CLICK ====================
self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notification click');

  event.notification.close();

  const data = event.notification.data;
  const action = event.action;

  let url = '/webrtc_v0/';

  if (action === 'answer' && data.callId) {
    url = `/webrtc_v0/?callId=${data.callId}&callerId=${data.callerId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('/webrtc_v0/') && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
