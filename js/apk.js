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
    
    const intentUrl = `intent://start?uid=${window.CONFIG.myUsername}#Intent;scheme=webrtc;package=com.webrtc.communicator;end`;
    
    // Update UI immediately
    document.getElementById('apkStatus').innerHTML = '⏳ Waiting for permission...';
    document.getElementById('startApkBtn').disabled = true;
    
    // Trigger the intent
    window.location.href = intentUrl;
    
    // Show a message that user needs to approve
    if (window.showStatusModal) {
        window.showStatusModal(
            "📱 Approve Launch", 
            "Tap 'Continue' when Chrome asks to open the app",
            false
        );
    }
    
    // Don't timeout - just show waiting message
    // The app will launch when user approves
    document.getElementById('apkStatus').innerHTML = '✅ Check for permission pop-up';
    
    // Optional: Check if page loses visibility (app launches)
    const checkVisibility = setInterval(() => {
        if (document.visibilityState === 'hidden') {
            // App launched! Page is hidden
            document.getElementById('apkStatus').innerHTML = '✅ APK launched!';
            clearInterval(checkVisibility);
        }
    }, 500);
    
    // Clear after 30 seconds in case user dismisses
    setTimeout(() => {
        clearInterval(checkVisibility);
        if (document.visibilityState === 'visible') {
            document.getElementById('apkStatus').innerHTML = '❌ Launch cancelled';
            document.getElementById('startApkBtn').disabled = false;
        }
    }, 30000);
};
