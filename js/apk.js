// ==================== APK LAUNCHER ====================
console.log('✅ apk.js loaded');

const APK_PACKAGE = "com.easosunov.communicator";
const isAndroid = /android/i.test(navigator.userAgent);

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
    
    // Update UI to waiting state
    document.getElementById('apkStatus').innerHTML = '⏳ Waiting for your approval...';
    document.getElementById('startApkBtn').disabled = true;
    
    // SINGLE intent - no fallbacks, no rapid timeouts
    const intentUrl = `intent://start?uid=${window.CONFIG.myUsername}#Intent;scheme=webrtc;package=com.webrtc.communicator;end`;
    window.location.href = intentUrl;
    
    // Show a helpful message
    if (window.showStatusModal) {
        window.showStatusModal(
            "📱 Approve Launch", 
            "Tap 'Continue' when Chrome asks to open the app",
            false
        );
    }
    
    // Monitor if page goes hidden (app launches)
    const visibilityCheck = setInterval(() => {
        if (document.visibilityState === 'hidden') {
            // App launched successfully
            document.getElementById('apkStatus').innerHTML = '✅ APK launched!';
            clearInterval(visibilityCheck);
        }
    }, 500);
    
    // Long timeout - give user plenty of time to click Continue
    setTimeout(() => {
        clearInterval(visibilityCheck);
        if (document.visibilityState === 'visible') {
            // User never clicked Continue or dismissed the pop-up
            document.getElementById('apkStatus').innerHTML = '❌ Launch cancelled or timed out';
            document.getElementById('startApkBtn').disabled = false;
            
            if (window.showStatusModal) {
                window.showStatusModal(
                    "📱 Launch Failed", 
                    "You need to tap 'Continue' when Chrome asks to open the app",
                    true
                );
            }
        }
    }, 30000); // Give 30 seconds to click Continue
};

// Stop the APK listener
window.stopApkListener = function() {
    if (!isAndroid) return;
    
    console.log("📱 Stopping APK listener");
    
    const intentUrl = `intent://stop#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
    window.location.href = intentUrl;
    
    const statusEl = document.getElementById('apkStatus');
    const startBtn = document.getElementById('startApkBtn');
    
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
    }
}

// Run on load
updateApkStatus();

// Add a test function for debugging
window.testApkIntent = function() {
    console.log("Testing APK intent...");
    window.location.href = `intent://test#Intent;scheme=webrtc;package=${APK_PACKAGE};end`;
};
