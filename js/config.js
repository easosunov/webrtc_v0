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
    iceRestartAttempts: 0,
    MAX_ICE_RESTART_ATTEMPTS: 3,
    connectionTimeout: null,
    ICE_TIMEOUT: 10000,
    reconnectTimer: null,
    targetUsername: null,
    isCaller: false,
    currentIncomingCall: null
};

// Make CONFIG globally available
window.CONFIG = CONFIG;
window.db = db;
