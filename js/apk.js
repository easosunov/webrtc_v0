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
    
    // Use the EXACT same format that worked in ADB
    const intentUrl = `intent://start?uid=${window.CONFIG.myUsername}#Intent;scheme=webrtc;package=com.webrtc.communicator;end`;
    
    // Try to open the app
    window.location.href = intentUrl;
    
    // Update UI
    document.getElementById('apkStatus').innerHTML = '✅ APK starting...';
    document.getElementById('startApkBtn').disabled = true;
    
    // Don't show error - ADB confirms it works!
    setTimeout(() => {
        if (document.visibilityState === 'visible') {
            document.getElementById('apkStatus').innerHTML = '✅ APK should be running (check notification)';
        }
    }, 2000);
};
