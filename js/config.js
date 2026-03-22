// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
    apiKey: "AIzaSyChU1sW6u5T0Ho0y0yIPgI1dHFYx-6Q_X8",
    authDomain: "webrtc-v0.firebaseapp.com",
    projectId: "webrtc-v0",
    storageBucket: "webrtc-v0.firebasestorage.app",
    messagingSenderId: "647705075894",
    appId: "1:647705075894:web:d23544a3f8e509f69e8617",
    measurementId: "G-5ZSTJSD2N3"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ==================== FIREBASE MESSAGING (FCM) ====================
let messaging = null;
if (firebase.messaging && firebase.messaging.isSupported()) {
    try {
        messaging = firebase.messaging();
        console.log('✅ FCM supported and initialized');
    } catch (error) {
        console.log('❌ FCM initialization error:', error);
    }
} else {
    console.log('ℹ️ FCM not supported in this browser');
}

// ==================== GLOBAL STATE ====================
const CONFIG = {
    myUsername: null,
    myDisplayName: null,
    isAdmin: false,
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    isInCall: false,
    currentCallId: null,
    currentCallPartner: null,
    callTimeout: null,
    iceRestartAttempts: 0,
    MAX_ICE_RESTART_ATTEMPTS: 3,
    connectionTimeout: null,
    ICE_TIMEOUT: 10000,
    reconnectTimer: null,
    targetUsername: null,
    isCaller: false,
    currentIncomingCall: null,
    
    // Connection monitoring constants
    ICE_MONITOR_INTERVAL: 3000,
    HEARTBEAT_INTERVAL: 5000,
    HEARTBEAT_TIMEOUT: 10000,
    MAX_RECONNECTION_ATTEMPTS: 5,
    RECONNECTION_BASE_DELAY: 1000,
    RECONNECTION_MAX_DELAY: 30000,
    PACKET_LOSS_THRESHOLD: 10,
    
    // Monitoring state flags
    iceMonitorInterval: null,
    heartbeatInterval: null,
    heartbeatChannel: null,
    lastHeartbeat: null,
    networkMonitorInterval: null,
    reconnectionAttempts: 0,
    reconnectionTimeout: null,
    
    // Status message tracking
    lastStatusMessage: null,
    statusMessageTimeout: null,
    
    // Push notification
    pushSubscription: null,
    pushSupported: false,
    qualityReduced: false,
    originalVideoConstraints: null
};

// ==================== WEB PUSH CONFIGURATION ====================
const VAPID_PUBLIC_KEY = 'BH33WjtMVo0Y_bml_nke0gtVqahGcPd6m-yjh__LBHp6Ahvfq-vN-m25D2MzMB3e1jbTGwQRGt5ufKEhSyj6Yv0';

// Make VAPID key globally available
window.VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY;

// ==================== TURN SERVER CONFIG ====================
const TURN_SERVER_URL = 'https://turn-token.easosunov.workers.dev/ice';

window.APK_PACKAGE = "com.easosunov.communicator";

// Make CONFIG, db, and messaging globally available
window.CONFIG = CONFIG;
window.db = db;
window.messaging = messaging;

console.log('✅ Config loaded');
console.log('📱 Web Push VAPID key:', VAPID_PUBLIC_KEY ? '✅ Configured' : '❌ Not configured');
console.log('📱 FCM:', messaging ? '✅ Available' : '❌ Not available');
