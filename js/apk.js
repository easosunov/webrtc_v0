// ==================== APK LAUNCHER ====================
console.log('✅ apk.js loaded');

const APK_PACKAGE = "com.webrtc.communicator";
const isAndroid = /android/i.test(navigator.userAgent);

// Make isAndroid globally available
window.isAndroid = isAndroid;

// Track launch attempts
let launchTimestamp = null;

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
    
    // Record launch time
    launchTimestamp = Date.now();
    sessionStorage.setItem('apkLaunchTime', launchTimestamp.toString());
    
    // Update UI
    statusEl.innerHTML = '🚀 Launching...';
    startBtn.disabled = true;
    
    // Launch the app with the correct intent format
    const intentUrl = `intent://start?uid=${window.CONFIG.myUsername}#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
    console.log("Intent URL:", intentUrl);
    window.location.href = intentUrl;
    
    // Don't rely on visibility - just trust that it worked
    // The app will set a marker when it launches
    statusEl.innerHTML = '✅ Launch attempted - app should start';
    
    // Check if we return to this page after a short time
    // This handles the case where the app doesn't launch
    setTimeout(() => {
        const currentStatus = statusEl.innerHTML;
        if (currentStatus !== '✅ APK confirmed running' && 
            currentStatus !== '✅ APK is running in background') {
            
            // Check if we have a confirmation from the app
            const confirmed = sessionStorage.getItem('apkConfirmed');
            if (confirmed === 'true') {
                statusEl.innerHTML = '✅ APK confirmed running';
            } else {
                // User may have clicked Continue but we can't detect it
                statusEl.innerHTML = '✅ App should be running - check notification';
                startBtn.disabled = false;
            }
        }
    }, 3000);
};

// Stop the APK listener
window.stopApkListener = function() {
    if (!isAndroid) return;
    
    console.log("📱 Stopping APK listener");
    
    // Use custom scheme that we added to manifest
    const stopUrl = "webrtc://stop";
    
    console.log("Stop URL:", stopUrl);
    window.location.href = stopUrl;
    
    // Update UI optimistically
    const statusEl = document.getElementById('apkStatus');
    const startBtn = document.getElementById('startApkBtn');
    
    if (statusEl) statusEl.innerHTML = '⏹️ Stop command sent...';
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '▶️ Start Listener';
    }
    
    // Force icon check after delay
    setTimeout(() => {
        if (window.CONFIG?.myUsername) {
            console.log("Checking service status after stop");
            // You could add a status check here if needed
        }
    }, 2000);
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
        
        // Store confirmation that APK launched
        sessionStorage.setItem('apkConfirmed', 'true');
        
        // Update status if we're on the page
        const statusEl = document.getElementById('apkStatus');
        if (statusEl) {
            statusEl.innerHTML = '✅ APK confirmed running';
        }
        
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
    
    // Check if we have confirmation from a previous launch
    const confirmed = sessionStorage.getItem('apkConfirmed');
    if (confirmed === 'true') {
        statusEl.innerHTML = '✅ APK is running in background';
        document.getElementById('startApkBtn').disabled = true;
    } else if (isAndroid) {
        statusEl.innerHTML = '📱 Android ready - Click Start to enable background listener';
    } else {
        statusEl.innerHTML = '📱 APK only available on Android devices';
    }
}

// Test function for debugging
window.testApkIntent = function() {
    console.log("Testing APK intent...");
    window.location.href = `intent://test#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
};

// Run on load
updateApkStatus();
