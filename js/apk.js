// ==================== APK LAUNCHER ====================
console.log('✅ apk.js loaded');

const APK_PACKAGE = "com.easosunov.communicator";
const isAndroid = /android/i.test(navigator.userAgent);

// Function to check if APK is installed
function isApkInstalled() {
    // This is a best-effort check - we'll assume it might be installed
    // The actual check would require a custom plugin
    return true; // Assume installed for now
}

// Start the APK listener service using multiple methods
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
    
    // Method 1: Custom scheme intent (works if app is installed)
    const intentUrl = `intent://start?uid=${window.CONFIG.myUsername}#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
    
    // Method 2: Direct package launch (alternative)
    const packageIntent = `intent://#Intent;package=${APK_PACKAGE};end`;
    
    // Try custom scheme first
    window.location.href = intentUrl;
    
    // Update UI optimistically
    document.getElementById('apkStatus').innerHTML = '✅ APK started - listening in background';
    document.getElementById('startApkBtn').disabled = true;
    
    // Show instructions if app not installed
    setTimeout(() => {
        if (document.visibilityState === 'visible') {
            if (window.showStatusModal) {
                window.showStatusModal(
                    "📱 APK Required", 
                    "If the app didn't open, make sure WebRTC Listener APK is installed on your device",
                    false
                );
            }
        }
    }, 2000);
};

// Stop the APK listener
window.stopApkListener = function() {
    if (!isAndroid) return;
    
    console.log("📱 Stopping APK listener");
    
    const intentUrl = `intent://stop#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
    window.location.href = intentUrl;
    
    document.getElementById('apkStatus').innerHTML = '⏸️ APK stopped';
    document.getElementById('startApkBtn').disabled = false;
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
    }
}

// Run on load
updateApkStatus();
