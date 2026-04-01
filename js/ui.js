// Global DOM object
window.dom = {};

// Flag to track UI initialization
let uiInitialized = false;

// Audio context for ringtone
let audioContext = null;
let ringtoneGain = null;
let ringtoneOscillator = null;
let ringtoneInterval = null;

// ==================== RINGTONE FUNCTIONS ====================
function initAudioContext() {
    if (audioContext) return audioContext;
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('🔊 Audio context initialized');
    } catch (error) {
        console.error('❌ Failed to create audio context:', error);
    }
    return audioContext;
}

function startRingtone() {
    try {
        stopRingtone();
        
        const ctx = initAudioContext();
        if (!ctx) return;
        
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        
        ringtoneGain = ctx.createGain();
        ringtoneGain.gain.value = 0.3;
        ringtoneGain.connect(ctx.destination);
        
        ringtoneOscillator = ctx.createOscillator();
        ringtoneOscillator.type = 'sine';
        ringtoneOscillator.frequency.value = 440;
        
        ringtoneOscillator.connect(ringtoneGain);
        ringtoneOscillator.start();
        
        let isOn = true;
        ringtoneInterval = setInterval(() => {
            if (ringtoneGain) {
                ringtoneGain.gain.value = isOn ? 0.3 : 0;
                isOn = !isOn;
            }
        }, 500);
        
        console.log('🔔 Ringtone started');
    } catch (error) {
        console.error('❌ Failed to start ringtone:', error);
    }
}

function stopRingtone() {
    if (ringtoneInterval) {
        clearInterval(ringtoneInterval);
        ringtoneInterval = null;
    }
    
    if (ringtoneOscillator) {
        try {
            ringtoneOscillator.stop();
            ringtoneOscillator.disconnect();
        } catch (error) {}
        ringtoneOscillator = null;
    }
    
    if (ringtoneGain) {
        ringtoneGain.disconnect();
        ringtoneGain = null;
    }
    
    console.log('🔕 Ringtone stopped');
}

// Initialize DOM elements when document is ready
function initDOM() {
    console.log('Initializing DOM elements...');
    
    dom.loginScreen = document.getElementById('login-screen');
    dom.callScreen = document.getElementById('call-screen');
    dom.codeDisplay = document.getElementById('code-display');
    dom.loginBtn = document.getElementById('login-btn');
    dom.loginStatus = document.getElementById('login-status');
    dom.logoutBtn = document.getElementById('logout-btn');
    dom.currentUserSpan = document.getElementById('current-user');
    dom.hangupBtn = document.getElementById('hangup-btn');
    dom.localVideo = document.getElementById('local-video');
    dom.remoteVideo = document.getElementById('remote-video');
    dom.usersContainer = document.getElementById('users-container');
    dom.modalOverlay = document.getElementById('modal-overlay');
    dom.incomingModal = document.getElementById('incoming-call-modal');
    dom.callerNameSpan = document.getElementById('caller-name');
    dom.acceptBtn = document.getElementById('accept-call');
    dom.rejectBtn = document.getElementById('reject-call');
    dom.statusModalOverlay = document.getElementById('status-modal-overlay');
    dom.statusModal = document.getElementById('status-modal');
    dom.statusModalTitle = document.getElementById('status-modal-title');
    dom.statusModalMessage = document.getElementById('status-modal-message');
    dom.statusModalOk = document.getElementById('status-modal-ok');

    console.log('DOM Elements Found:', {
        loginScreen: !!dom.loginScreen,
        callScreen: !!dom.callScreen,
        loginBtn: !!dom.loginBtn,
        hangupBtn: !!dom.hangupBtn,
        modalOverlay: !!dom.modalOverlay,
        loginStatus: !!dom.loginStatus
    });

    if (!dom.loginScreen || !dom.callScreen) {
        console.error('Critical screen elements are missing!');
        return false;
    }
    
    return true;
}

// ==================== MODAL FUNCTIONS WITH RINGTONE ====================
window.showIncomingCallModal = function(callerId, callId, offer) {
    if (!dom.modalOverlay || !dom.incomingModal || !dom.callerNameSpan) {
        console.error('Modal elements not found');
        return;
    }
    
    CONFIG.currentIncomingCall = { callId, callerId, offer };
    dom.callerNameSpan.textContent = `Call from ${callerId}`;
    dom.modalOverlay.style.display = 'block';
    dom.incomingModal.style.display = 'block';
    
    startRingtone();
    
    setTimeout(() => {
        if (CONFIG.currentIncomingCall) {
            console.log('⏰ Incoming call timed out');
            hideIncomingCallModal();
        }
    }, 30000);
};

window.hideIncomingCallModal = function() {
    if (!dom.modalOverlay || !dom.incomingModal) return;
    
    dom.modalOverlay.style.display = 'none';
    dom.incomingModal.style.display = 'none';
    CONFIG.currentIncomingCall = null;
    
    stopRingtone();
};

// ==================== STATUS MODAL FUNCTIONS ====================
window.showStatusModal = function(title, message, isError = false) {
    if (!dom.statusModal || !dom.statusModalOverlay || !dom.statusModalTitle || !dom.statusModalMessage) {
        console.error('Status modal elements not found');
        return;
    }
    
    dom.statusModalTitle.textContent = title;
    dom.statusModalMessage.textContent = message;
    
    // Change color for error messages
    if (isError) {
        dom.statusModalTitle.style.color = '#f44336';
    } else {
        dom.statusModalTitle.style.color = '#333';
    }
    
    dom.statusModalOverlay.style.display = 'block';
    dom.statusModal.style.display = 'block';
};

window.hideStatusModal = function() {
    if (!dom.statusModal || !dom.statusModalOverlay) return;
    
    dom.statusModalOverlay.style.display = 'none';
    dom.statusModal.style.display = 'none';
};

// ==================== CONNECTION STATUS MESSAGES ====================
window.showConnectionStatus = function(message, type = 'info') {
    if (CONFIG.lastStatusMessage === message) return;
    
    CONFIG.lastStatusMessage = message;
    
    const statusArea = document.getElementById('call-status-area');
    const statusText = document.getElementById('call-status-text');
    
    if (statusArea && statusText) {
        statusText.textContent = message;
        statusArea.className = `call-status-area ${type}`;
        statusArea.style.display = 'block';
        
        if (type === 'success') {
            if (CONFIG.statusMessageTimeout) {
                clearTimeout(CONFIG.statusMessageTimeout);
            }
            CONFIG.statusMessageTimeout = setTimeout(() => {
                window.clearConnectionStatus();
            }, 3000);
        }
    } else {
        if (dom.loginStatus) {
            dom.loginStatus.textContent = message;
            dom.loginStatus.className = `status-message ${type}`;
            dom.loginStatus.style.display = 'block';
        }
    }
};

window.clearConnectionStatus = function() {
    CONFIG.lastStatusMessage = null;
    
    const statusArea = document.getElementById('call-status-area');
    if (statusArea) {
        statusArea.style.display = 'none';
        statusArea.className = 'call-status-area';
    }
    
    if (dom.loginStatus) {
        dom.loginStatus.textContent = '';
        dom.loginStatus.className = 'status-message';
        dom.loginStatus.style.display = 'none';
    }
    
    if (CONFIG.statusMessageTimeout) {
        clearTimeout(CONFIG.statusMessageTimeout);
        CONFIG.statusMessageTimeout = null;
    }
};

// ==================== CALL BUTTON STATE MANAGEMENT ====================
window.updateCallButtonState = function(partnerUsername, isInCall, isCalling = false) {
    const buttons = document.querySelectorAll('.call-user-btn');
    
    buttons.forEach(button => {
        const onclickAttr = button.getAttribute('onclick');
        if (!onclickAttr) return;
        
        const match = onclickAttr.match(/'([^']+)'/);
        if (!match) return;
        
        const buttonUsername = match[1];
        
        if (buttonUsername === partnerUsername) {
            button.disabled = true;
            if (isCalling) {
                button.textContent = 'Calling...';
            } else if (isInCall) {
                button.textContent = 'In call';
            }
        } else if (isInCall || isCalling) {
            button.disabled = true;
        } else {
            button.disabled = false;
            button.textContent = 'Call';
        }
    });
};

window.resetAllCallButtons = function() {
    const buttons = document.querySelectorAll('.call-user-btn');
    buttons.forEach(button => {
        button.disabled = false;
        button.textContent = 'Call';
    });
};

// ==================== DUAL PUSH SYSTEM ====================

async function getWebPushSubscription() {
    if (!('serviceWorker' in navigator)) return null;
    
    try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        
        if (subscription) return subscription;
        
        // Create new Web Push subscription
        const vapidKey = window.VAPID_PUBLIC_KEY;
        if (!vapidKey) {
            console.log('❌ VAPID key missing');
            return null;
        }
        
        const base64 = vapidKey.replace(/-/g, '+').replace(/_/g, '/');
        const applicationServerKey = new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
        
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey
        });
        
        console.log('✅ Web Push subscription created');
        return subscription;
        
    } catch (error) {
        console.error('❌ Web Push subscription error:', error);
        return null;
    }
}

async function getFCMToken() {
    if (!window.messaging) {
        console.log('❌ FCM not available');
        return null;
    }
    
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('❌ Notification permission denied');
            return null;
        }
        
        const token = await window.messaging.getToken({
            vapidKey: window.VAPID_PUBLIC_KEY
        });
        
        if (token) {
            console.log('✅ FCM token obtained');
        } else {
            console.log('❌ No FCM token returned');
        }
        return token;
        
    } catch (error) {
        console.error('❌ FCM token error:', error);
        return null;
    }
}

async function savePushSubscriptions() {
    if (!CONFIG.myUsername) {
        console.log('⏳ Not logged in yet');
        return false;
    }
    
    const updates = {};
    let hasUpdates = false;
    
    // Get Web Push subscription (works on all platforms)
    const webPushSub = await getWebPushSubscription();
    if (webPushSub) {
        updates.webPushSubscription = {
            endpoint: webPushSub.endpoint,
            expirationTime: webPushSub.expirationTime,
            keys: {
                p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(webPushSub.getKey('p256dh')))),
                auth: btoa(String.fromCharCode.apply(null, new Uint8Array(webPushSub.getKey('auth'))))
            }
        };
        updates.webPushEnabled = true;
        hasUpdates = true;
        console.log('✅ Web Push subscription saved');
    }
    
    // Try to get FCM token (Android only)
    const fcmToken = await getFCMToken();
    if (fcmToken) {
        updates.fcmToken = fcmToken;
        updates.fcmEnabled = true;
        hasUpdates = true;
        console.log('✅ FCM token saved');
    }
    
    if (hasUpdates) {
        try {
            await db.collection('users').doc(CONFIG.myUsername).update(updates);
            console.log('✅ All push subscriptions saved to Firestore');
            return true;
        } catch (error) {
            console.error('❌ Failed to save subscriptions:', error);
            return false;
        }
    }
    
    console.log('⚠️ No push subscriptions created');
    return false;
}

window.enablePushNotifications = async function() {
    console.log('🔔 Enabling push notifications...');
    
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        alert('Notification permission denied. Please enable in browser settings.');
        return false;
    }
    
    // Save both types of subscriptions
    const success = await savePushSubscriptions();
    
    if (success) {
        console.log('✅ Push notifications enabled successfully');
        return true;
    } else {
        console.log('❌ Failed to enable push notifications');
        return false;
    }
};

window.showEnablePushButton = function() {
    // Check if already have subscriptions
    const checkExisting = async () => {
        if (!CONFIG.myUsername) return;
        
        const userDoc = await db.collection('users').doc(CONFIG.myUsername).get();
        const userData = userDoc.data();
        if (userData?.webPushSubscription || userData?.fcmToken) {
            console.log('✅ Push already enabled for this user');
            return;
        }
        
        // Create button if not already present
        if (document.getElementById('enable-push-btn')) return;
        
        const pushButton = document.createElement('button');
        pushButton.id = 'enable-push-btn';
        pushButton.className = 'enable-push-btn';
        pushButton.textContent = '🔔 Enable Notifications';
        
        pushButton.onclick = async () => {
            pushButton.disabled = true;
            pushButton.textContent = 'Enabling...';
            
            const success = await window.enablePushNotifications();
            if (success) {
                pushButton.textContent = '✅ Notifications enabled';
                setTimeout(() => pushButton.remove(), 3000);
            } else {
                pushButton.textContent = '❌ Failed. Try again?';
                pushButton.disabled = false;
            }
        };
        
        const usersPanel = document.querySelector('.users-panel');
        if (usersPanel) {
            usersPanel.appendChild(pushButton);
            console.log('✅ Enable push button added');
        }
    };
    
    checkExisting();
};

// ==================== BARK (iOS) REGISTRATION ====================
// 🔧 NEW FUNCTION: Extract key from URL or raw key
function extractBarkKey(input) {
    if (!input) return null;
    
    // Remove whitespace
    input = input.trim();
    
    // If it's a Bark URL, extract the key
    if (input.includes('api.day.app/')) {
        const match = input.match(/api\.day\.app\/([^\/]+)/);
        if (match && match[1]) {
            return match[1];
        }
    }
    
    // If it's a raw key (looks like a long string), return as-is
    if (input.length > 20 && /^[a-zA-Z0-9]+$/.test(input)) {
        return input;
    }
    
    return null;
}

async function getBarkDeviceKey() {
    // Check if we already have a saved key
    let barkKey = localStorage.getItem('bark_device_key');
    if (barkKey) {
        console.log('✅ Bark device key already saved:', barkKey.substring(0, 10) + '...');
        return barkKey;
    }
    
    // 🔧 UPDATED: Clearer instructions for the new Bark UI
    barkKey = prompt(
        '🍎 Set up iOS Call Notifications\n\n' +
        '1. Open the Bark app\n' +
        '2. Tap the "Service" tab\n' +
        '3. Tap "Copy Test"\n' +
        '4. Paste the URL here\n\n' +
        'Paste the URL here:'
    );
    
    if (barkKey) {
        const extractedKey = extractBarkKey(barkKey);
        if (extractedKey) {
            localStorage.setItem('bark_device_key', extractedKey);
            console.log('✅ Bark device key extracted and saved');
            return extractedKey;
        } else {
            alert('❌ Invalid Bark URL. Please tap "Copy Test" in the Bark app and paste again.');
            return null;
        }
    }
    
    return null;
}

async function saveBarkDeviceKey() {
    if (!CONFIG.myUsername) {
        console.log('⏳ Not logged in yet');
        return false;
    }
    
    const barkKey = await getBarkDeviceKey();
    if (!barkKey) return false;
    
    try {
        await db.collection('users').doc(CONFIG.myUsername).update({
            barkDeviceKey: barkKey,
            barkEnabled: true,
            barkLastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ Bark device key saved to Firestore');
        return true;
    } catch (error) {
        console.error('❌ Failed to save Bark key:', error);
        return false;
    }
}

// Show a button to enable Bark (iOS only)
window.showEnableBarkButton = function() {
    console.log('🔍 showEnableBarkButton called');
    
    // 🔧 UPDATED: Improved iOS detection for modern iPads
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                  (/Mac/.test(navigator.userAgent) && 'ontouchstart' in document);
    
    console.log('iOS detection result:', isIOS);
    console.log('User Agent:', navigator.userAgent);
    
    // For testing on Windows - you can comment out this check
    // if (!isIOS) {
    //     console.log('Not iOS, skipping Bark button');
    //     return;
    // }
    
    // Check if already have Bark key
    const checkExisting = async () => {
        if (!CONFIG.myUsername) {
            console.log('No username yet, waiting...');
            return;
        }
        
        try {
            const userDoc = await db.collection('users').doc(CONFIG.myUsername).get();
            const userData = userDoc.data();
            if (userData?.barkDeviceKey) {
                console.log('✅ Bark already enabled for this user');
                return;
            }
        } catch (e) {
            console.log('Could not check Bark status:', e);
        }
        
        // Create button if not already present
        if (document.getElementById('enable-bark-btn')) {
            console.log('Bark button already exists');
            return;
        }
        
        // 🔧 UPDATED: Button with clearer text
        const barkButton = document.createElement('button');
        barkButton.id = 'enable-bark-btn';
        barkButton.className = 'enable-bark-btn';
        barkButton.textContent = '🍎 Enable iOS Call Notifications (Bark)';
        barkButton.style.cssText = 'background: #ff9800; color: white; padding: 12px; margin: 10px 0; border: none; border-radius: 8px; width: 100%; font-size: 14px; cursor: pointer; font-weight: bold;';
        
        barkButton.onclick = async () => {
            barkButton.disabled = true;
            barkButton.textContent = 'Enabling...';
            barkButton.style.background = '#666';
            
            const success = await saveBarkDeviceKey();
            if (success) {
                barkButton.textContent = '✅ iOS Notifications Enabled';
                barkButton.style.background = '#4CAF50';
                setTimeout(() => barkButton.remove(), 3000);
            } else {
                barkButton.textContent = '❌ Failed. Tap to try again';
                barkButton.disabled = false;
                barkButton.style.background = '#f44336';
            }
        };
        
        // Try multiple container locations
        let container = document.querySelector('.users-panel');
        if (!container) {
            container = document.querySelector('.right-panels');
        }
        if (!container) {
            container = document.getElementById('users-container')?.parentElement;
        }
        if (!container) {
            container = document.querySelector('.main-content .right-panels');
        }
        
        if (container) {
            container.insertBefore(barkButton, container.firstChild);
            console.log('✅ Enable Bark button added to', container.className);
        } else {
            console.error('❌ Could not find container for Bark button');
        }
    };
    
    checkExisting();
};

// ==================== AUTO-SUBSCRIBE ====================
window.autoSubscribeToPush = async function() {
    if (!CONFIG.myUsername) return;
    
    // Check if already have subscriptions
    const userDoc = await db.collection('users').doc(CONFIG.myUsername).get();
    const userData = userDoc.data();
    
    if (userData?.webPushSubscription || userData?.fcmToken) {
        console.log('✅ Already subscribed');
        return;
    }
    
    // Check permission
    const permission = Notification.permission;
    
    if (permission === 'granted') {
        console.log('🔔 Permission already granted, auto-subscribing...');
        await savePushSubscriptions();
    } else if (permission === 'default') {
        console.log('🔔 Asking for notification permission...');
        await window.enablePushNotifications();
    }
};

// ==================== EXPOSE GLOBALLY ====================
window.startRingtone = startRingtone;
window.stopRingtone = stopRingtone;
window.showConnectionStatus = showConnectionStatus;
window.clearConnectionStatus = clearConnectionStatus;
window.updateCallButtonState = updateCallButtonState;
window.resetAllCallButtons = resetAllCallButtons;
window.showEnablePushButton = showEnablePushButton;
window.autoSubscribeToPush = autoSubscribeToPush;
window.enablePushNotifications = enablePushNotifications;
window.showEnableBarkButton = showEnableBarkButton;
window.saveBarkDeviceKey = saveBarkDeviceKey;
window.extractBarkKey = extractBarkKey;  // 🔧 NEW: Export for debugging

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded');
    
    if (initDOM() && !uiInitialized) {
        // Clone and replace buttons for clean event listeners
        if (dom.acceptBtn) {
            const newAcceptBtn = dom.acceptBtn.cloneNode(true);
            dom.acceptBtn.parentNode.replaceChild(newAcceptBtn, dom.acceptBtn);
            dom.acceptBtn = newAcceptBtn;
            
            dom.acceptBtn.addEventListener('click', () => {
                if (CONFIG.currentIncomingCall) {
                    const { callId, callerId, offer } = CONFIG.currentIncomingCall;
                    hideIncomingCallModal();
                    if (window.answerCall) window.answerCall(callId, callerId, offer);
                }
            });
        }

        if (dom.rejectBtn) {
            const newRejectBtn = dom.rejectBtn.cloneNode(true);
            dom.rejectBtn.parentNode.replaceChild(newRejectBtn, dom.rejectBtn);
            dom.rejectBtn = newRejectBtn;
            
            // 🔧 UPDATED: Async reject handler with status update
            dom.rejectBtn.addEventListener('click', async () => {
                if (CONFIG.currentIncomingCall) {
                    const { callId } = CONFIG.currentIncomingCall;
                    
                    // Explicitly update the call status to 'rejected'
                    try {
                        await db.collection('calls').doc(callId).update({
                            status: 'rejected',
                            endedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        console.log('📞 Call rejected, status updated to rejected');
                        
                        // Also trigger the reject endpoint to clean up intervals
                        fetch(`https://us-central1-webrtc-v0.cloudfunctions.net/rejectCall?callId=${callId}`)
                            .catch(err => console.log('Reject endpoint error:', err));
                            
                    } catch (err) {
                        console.error('Error rejecting call:', err);
                    }
                    
                    hideIncomingCallModal();
                    console.log('📞 Call rejected');
                }
            });
        }

        if (dom.statusModalOk) {
            const newOkBtn = dom.statusModalOk.cloneNode(true);
            dom.statusModalOk.parentNode.replaceChild(newOkBtn, dom.statusModalOk);
            dom.statusModalOk = newOkBtn;
            
            dom.statusModalOk.addEventListener('click', () => {
                hideStatusModal();
            });
        }

        if (dom.statusModalOverlay) {
            const newOverlay = dom.statusModalOverlay.cloneNode(true);
            dom.statusModalOverlay.parentNode.replaceChild(newOverlay, dom.statusModalOverlay);
            dom.statusModalOverlay = newOverlay;
            
            dom.statusModalOverlay.addEventListener('click', () => {
                hideStatusModal();
            });
        }

        if (dom.modalOverlay) {
            const newOverlay = dom.modalOverlay.cloneNode(true);
            dom.modalOverlay.parentNode.replaceChild(newOverlay, dom.modalOverlay);
            dom.modalOverlay = newOverlay;
            
            dom.modalOverlay.addEventListener('click', () => {
                hideIncomingCallModal();
            });
        }

        uiInitialized = true;
        console.log('🚀 UI loaded with dual push support (Web Push + FCM + Bark iOS)');
        
        window.dispatchEvent(new Event('ui-ready'));
    }
});

// ==================== LOGIN COMPLETE EVENT ====================
window.addEventListener('login-complete', () => {
    console.log('📱 Login complete, checking push subscriptions...');
    setTimeout(() => {
        window.autoSubscribeToPush();
        
        // 🔧 UPDATED: Show Bark button for iOS users with improved detection
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                      (/Mac/.test(navigator.userAgent) && 'ontouchstart' in document);
        
        console.log('Login complete - iOS detected:', isIOS);
        
        // Show the button (for testing, remove iOS check if needed)
        setTimeout(() => {
            console.log('Calling showEnableBarkButton...');
            window.showEnableBarkButton();
        }, 1500);
    }, 1000);
});

// ==================== CHECK ON PAGE LOAD ====================
setTimeout(() => {
    if (CONFIG && CONFIG.myUsername) {
        console.log('📱 User already logged in, checking push...');
        window.autoSubscribeToPush();
        
        // 🔧 UPDATED: Show Bark button for iOS users with improved detection
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                      (/Mac/.test(navigator.userAgent) && 'ontouchstart' in document);
        
        if (isIOS) {
            setTimeout(() => {
                window.showEnableBarkButton();
            }, 2000);
        }
    } else {
        console.log('📱 Not logged in, push will be enabled after login');
    }
}, 3000);

// ==================== AUDIO CONTEXT RESUME ====================
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}, { once: false });
