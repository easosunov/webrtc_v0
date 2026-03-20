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
    
    // ===== NEW: Connection monitoring constants =====
    // Monitoring intervals (in milliseconds)
    ICE_MONITOR_INTERVAL: 3000,      // Check ICE state every 3 seconds
    HEARTBEAT_INTERVAL: 5000,        // Send heartbeat every 5 seconds
    HEARTBEAT_TIMEOUT: 10000,        // Consider connection dead after 10 seconds without heartbeat
    
    // Reconnection settings
    MAX_RECONNECTION_ATTEMPTS: 5,     // Maximum reconnection attempts before giving up
    RECONNECTION_BASE_DELAY: 1000,    // Start with 1 second delay
    RECONNECTION_MAX_DELAY: 30000,    // Max delay of 30 seconds
    
    // Network quality thresholds
    PACKET_LOSS_THRESHOLD: 10,        // Percentage - reduce quality if packet loss > 10%
    
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
    statusMessageTimeout: null
};

const TURN_SERVER_URL = 'https://turn-token.easosunov.workers.dev/ice';

window.APK_PACKAGE = "com.easosunov.communicator";

// Make CONFIG and db globally available
window.CONFIG = CONFIG;
window.db = db;

console.log('✅ Config loaded');
