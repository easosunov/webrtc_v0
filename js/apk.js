// ==================== APK LAUNCHER ====================
console.log('✅ apk.js loaded');

const APK_PACKAGE = "com.webrtc.communicator";
const isAndroid = /android/i.test(navigator.userAgent);

// Make isAndroid globally available
window.isAndroid = isAndroid;

// Start the APK listener service
window.startApkListener = function() {
    if (!isAndroid) {
        alert("APK is only available on Android devices");
        return;
    }
    
    if (!window.CONFIG || !window.CONFIG.myUsername) {
        alert("Please log in first");
        return;
    }
    
    console.log("📱 Launching APK listener for user:", window.CONFIG.myUsername);
    
    // Get DOM elements
    const statusEl = document.getElementById('apkStatus');
    const startBtn = document.getElementById('startApkBtn');
    
    if (!statusEl || !startBtn) {
        console.error("APK control elements not found");
        return;
    }
    
    // Update UI
    statusEl.innerHTML = '🚀 Launching...';
    startBtn.disabled = true;
    
    // Launch the app with the correct intent format
    const intentUrl = `intent://start?uid=${window.CONFIG.myUsername}#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
    console.log("Intent URL:", intentUrl);
    window.location.href = intentUrl;
    
    // Track if app launched
    let launched = false;
    
    // Check if page goes hidden (app launches)
    const visibilityCheck = setInterval(() => {
        if (document.visibilityState === 'hidden') {
            // App launched successfully
            launched = true;
            statusEl.innerHTML = '✅ APK launched!';
            clearInterval(visibilityCheck);
            clearTimeout(timeoutId);
            console.log("App launched - page hidden");
        }
    }, 200);
    
    // Safety timeout
    const timeoutId = setTimeout(() => {
        clearInterval(visibilityCheck);
        if (!launched) {
            if (document.visibilityState === 'visible') {
                statusEl.innerHTML = '❌ Launch failed - tap Continue if prompted';
                startBtn.disabled = false;
            } else {
                // Page is hidden but we missed the event
                statusEl.innerHTML = '✅ APK should be running';
            }
        }
    }, 5000);
    
    // If page is already hidden (very fast launch)
    if (document.visibilityState === 'hidden') {
        launched = true;
        statusEl.innerHTML = '✅ APK launched!';
        clearInterval(visibilityCheck);
        clearTimeout(timeoutId);
    }
};

// Stop the APK listener
window.stopApkListener = function() {
    if (!isAndroid) return;
    
    console.log("📱 Stopping APK listener");
    
    const statusEl = document.getElementById('apkStatus');
    const startBtn = document.getElementById('startApkBtn');
    
    const intentUrl = `intent://stop#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
    window.location.href = intentUrl;
    
    if (statusEl) statusEl.innerHTML = '⏸️ APK stopped';
    if (startBtn) startBtn.disabled = false;
};

// Handle URL parameters when opened by APK
(function handleApkLaunch() {
    const urlParams = new URLSearchParams(window.location.search);
    const fromApk = urlParams.get('fromApk');
    const callId = urlParams.get('callId');
    const callerId = urlParams.get('callerId');
    const callerName = urlParams.get('callerName');
    
    if (fromApk === 'true' && callId && callerId) {
        console.log("📱 Opened by APK for call:", callId);
        
        // Store temporarily
        sessionStorage.setItem('apkIncomingCall', JSON.stringify({
            callId: callId,
            callerId: callerId,
            callerName: callerName || callerId,
            timestamp: Date.now()
        }));
        
        // Show a message that APK detected a call
        if (window.showStatusModal) {
            window.showStatusModal(
                "📱 Call Detected", 
                "APK detected an incoming call. Please log in to answer.",
                false
            );
        }
        
        // If already logged in, process immediately
        if (window.CONFIG?.myUsername) {
            setTimeout(checkForApkCall, 1000);
        }
    }
})();

// Check for APK-triggered call
async function checkForApkCall() {
    const pending = sessionStorage.getItem('apkIncomingCall');
    if (!pending) return;
    
    try {
        const callData = JSON.parse(pending);
        console.log("Processing APK call:", callData);
        
        // Get the full call from Firestore
        const callDoc = await window.db.collection('calls').doc(callData.callId).get();
        
        if (callDoc.exists) {
            const call = callDoc.data();
            
            // Show incoming call UI
            if (window.showIncomingCallModal) {
                window.showIncomingCallModal(
                    callData.callerId,
                    callData.callId,
                    call.offer
                );
            }
        } else {
            console.log("Call document not found, may have expired");
        }
        
        sessionStorage.removeItem('apkIncomingCall');
        
    } catch (e) {
        console.error("Error processing APK call:", e);
        sessionStorage.removeItem('apkIncomingCall');
    }
}

// Hook into login
const originalLogin = window.login;
if (originalLogin) {
    window.login = async function() {
        await originalLogin.apply(this, arguments);
        await checkForApkCall();
    };
}

// Update status based on Android
function updateApkStatus() {
    const statusEl = document.getElementById('apkStatus');
    if (!statusEl) return;
    
    if (isAndroid) {
        statusEl.innerHTML = '📱 Android ready - Click Start to enable background listener';
    } else {
        statusEl.innerHTML = '📱 APK only available on Android devices';
    }
}

// When page becomes visible again, check if app should be running
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Page came back to foreground
        const statusEl = document.getElementById('apkStatus');
        const startBtn = document.getElementById('startApkBtn');
        
        if (statusEl && startBtn && startBtn.disabled) {
            // Button is disabled but we're visible - app must be running
            statusEl.innerHTML = '✅ APK is running in background';
        }
    }
});

// Test function for debugging
window.testApkIntent = function() {
    console.log("Testing APK intent...");
    window.location.href = `intent://test#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
};

// Run on load
updateApkStatus();
