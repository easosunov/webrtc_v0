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
    
    // Simple intent to launch APK with just the user ID
    const intentUrl = `intent://start?uid=${window.CONFIG.myUsername}#Intent;package=${APK_PACKAGE};scheme=webrtc;end`;
    window.location.href = intentUrl;
    
    // Update UI
    document.getElementById('apkStatus').innerHTML = '✅ APK started - listening in background';
    document.getElementById('startApkBtn').disabled = true;
};

// Stop the APK listener
window.stopApkListener = function() {
    if (!isAndroid) return;
    
    console.log("📱 Stopping APK listener");
    
    const intentUrl = `intent://stop#Intent;package=${APK_PACKAGE};scheme=webrtc;end`;
    window.location.href = intentUrl;
    
    document.getElementById('apkStatus').innerHTML = '⏸️ APK stopped';
    document.getElementById('startApkBtn').disabled = false;
};

// NO call handling here - APK only starts the service
// The web page will get calls directly from Firebase as usual
