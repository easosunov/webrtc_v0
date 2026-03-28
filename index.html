// firebase-messaging-sw.js (at root)
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyChU1sW6u5T0Ho0y0yIPgI1dHFYx-6Q_X8",
    authDomain: "webrtc-v0.firebaseapp.com",
    projectId: "webrtc-v0",
    storageBucket: "webrtc-v0.firebasestorage.app",
    messagingSenderId: "647705075894",
    appId: "1:647705075894:web:d23544a3f8e509f69e8617"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('🔥 Background message received:', payload);
    
    const notificationTitle = payload.notification?.title || '📞 Incoming Call';
    const notificationOptions = {
        body: payload.notification?.body || 'You have an incoming call',
        icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
        badge: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        silent: false,
        priority: 'high',
        sticky: true,
        tag: 'incoming-call',
        renotify: true,
        timestamp: Date.now(),
        data: payload.data || {},
        actions: [
            { action: 'answer', title: 'Answer Call' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(notificationTitle, notificationOptions)
    );
});
