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

// ==================== FETCH (UPDATED FOR SHARE TARGET) ====================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Handle Web Share Target POST requests
  if (request.method === 'POST' && url.pathname === '/webrtc_v0/') {
    console.log('📤 SW: Handling share target POST request');
    
    event.respondWith((async () => {
      let sharedData = {
        title: null,
        text: null,
        url: null
      };
      
      try {
        // Parse form data from the POST request
        const formData = await request.formData();
        sharedData.title = formData.get('title');
        sharedData.text = formData.get('text');
        sharedData.url = formData.get('url');
        
        console.log('📤 SW: Received shared data:', sharedData);
        
        // Store shared data in cache for when the app opens
        const cache = await caches.open('shared-data');
        await cache.put('/webrtc_v0/pending-share', new Response(JSON.stringify({
          sharedData,
          timestamp: Date.now()
        })));
        
      } catch (error) {
        console.error('❌ SW: Error parsing share data:', error);
      }
      
      // Return the main page with a flag indicating shared content
      // This tells the app to check for pending shares
      const response = await fetch('/webrtc_v0/index.html');
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('X-Pending-Share', 'true');
      
      return newResponse;
    })());
    return;
  }
  
  // Normal GET requests - serve from cache or network
  event.respondWith(
    caches.match(request).then((res) => {
      return res || fetch(request);
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
