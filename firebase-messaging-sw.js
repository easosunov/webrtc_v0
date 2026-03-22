// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Firebase configuration
firebase.initializeApp({
    apiKey: "AIzaSyChU1sW6u5T0Ho0y0yIPgI1dHFYx-6Q_X8",
    authDomain: "webrtc-v0.firebaseapp.com",
    projectId: "webrtc-v0",
    storageBucket: "webrtc-v0.firebasestorage.app",
    messagingSenderId: "647705075894",
    appId: "1:647705075894:web:d23544a3f8e509f69e8617"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('📱 Background message received:', payload);
    
    const notificationTitle = payload.notification?.title || 'Incoming Call';
    const notificationOptions = {
        body: payload.notification?.body || 'You have an incoming call',
        icon: payload.notification?.icon || '/webrtc_v0/favicon.ico',
        badge: '/webrtc_v0/favicon.ico',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        data: payload.data || {},
        actions: [
            { action: 'answer', title: 'Answer Call' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };
    
    self.registration.showNotification(notificationTitle, notificationOptions);
});
