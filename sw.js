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
  let title = '📞 Incoming Call';
  let body = 'You have an incoming call';
  let callId = null;
  let callerId = null;
  
  try {
    data = event.data ? event.data.json() : {};
    console.log('📱 Push data received:', JSON.stringify(data));
    
    if (data.notification) {
      title = data.notification.title || title;
      body = data.notification.body || body;
    } else if (data.title) {
      title = data.title;
      body = data.body || body;
    }
    
    if (data.data) {
      callId = data.data.callId;
      callerId = data.data.callerId;
    } else {
      callId = data.callId;
      callerId = data.callerId;
    }
    
  } catch (e) {
    console.log('Push data parse error:', e);
  }
  
  const options = {
    body: body,
    icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
    badge: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    silent: false,
    tag: 'incoming-call',           // ADDED: helps group notifications
    renotify: true,                 // ADDED: forces notification to show
    timestamp: Date.now(),          // ADDED: ensures fresh notification
    data: {
      callId: callId,
      callerId: callerId,
      url: '/webrtc_v0/'
    },
    actions: [
      { action: 'answer', title: 'Answer Call' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  
  console.log('📱 Attempting to show notification with title:', title);
  
  // Add a small delay to help with background mode
  event.waitUntil(
    new Promise(resolve => {
      setTimeout(() => {
        self.registration.showNotification(title, options)
          .then(() => {
            console.log('✅ Notification shown successfully');
            resolve();
          })
          .catch(err => {
            console.error('❌ Failed to show notification:', err);
            resolve();
          });
      }, 100);
    })
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
    const callUrl = `https://easosunov.github.io/webrtc_v0/?callId=${notificationData.callId}&callerId=${notificationData.callerId}`;
    event.waitUntil(
      clients.openWindow(callUrl)
    );
  } else if (action === 'dismiss') {
    console.log('Notification dismissed');
  } else {
    // Default: open the app
    event.waitUntil(
      clients.openWindow('https://easosunov.github.io/webrtc_v0/')
    );
  }
});

