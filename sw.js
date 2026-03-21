// Service Worker with Push Notification Support
const CACHE_NAME = 'webrtc-communicator-v2';

const urlsToCache = [
  '/webrtc_v0/',
  '/webrtc_v0/index.html',
  '/webrtc_v0/js/config.js',
  '/webrtc_v0/js/ui.js',
  '/webrtc_v0/js/init.js',
  '/webrtc_v0/js/auth.js',
  '/webrtc_v0/js/users.js',
  '/webrtc_v0/js/webrtc.js',
  '/webrtc_v0/js/calls.js',
  '/webrtc_v0/js/apk.js',
  '/webrtc_v0/js/chat.js'
];



self.addEventListener('install', event => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching files...');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('🚀 Service Worker activated');
  event.waitUntil(clients.claim());
});

// ==================== FETCH HANDLER ====================
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// ==================== PUSH NOTIFICATION HANDLER ====================
self.addEventListener('push', event => {
  console.log('📱 Push notification received:', event);
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
    console.log('📱 Push data:', data);
  } catch (e) {
    console.log('Push data parse error:', e);
  }
  
  const title = data.title || 'WebRTC Communicator';
  const options = {
    body: data.body || 'Incoming call',
    icon: '/data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23667eea"/%3E%3Ctext x="50" y="70" font-size="50" text-anchor="middle" fill="white"%3E📞%3C/text%3E%3C/svg%3E',
    badge: '/data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23667eea"/%3E%3Ctext x="50" y="70" font-size="50" text-anchor="middle" fill="white"%3E📞%3C/text%3E%3C/svg%3E',
    vibrate: [200, 100, 200],
    data: {
      callId: data.callId,
      callerId: data.callerId,
      url: data.url || '/'
    },
    actions: [
      {
        action: 'answer',
        title: 'Answer Call'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ==================== NOTIFICATION CLICK HANDLER ====================
self.addEventListener('notificationclick', event => {
  console.log('🔔 Notification clicked:', event);
  event.notification.close();
  
  const notificationData = event.notification.data;
  const action = event.action;
  
  if (action === 'answer') {
    // Open the app to answer the call
    const callUrl = `/?callId=${notificationData.callId}&callerId=${notificationData.callerId}`;
    event.waitUntil(
      clients.openWindow(callUrl)
    );
  } else if (action === 'dismiss') {
    // Just close the notification
    console.log('Notification dismissed');
  } else {
    // Default: open the app
    event.waitUntil(
      clients.openWindow(notificationData.url || '/')
    );
  }
});
