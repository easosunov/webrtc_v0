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

// ==================== CONNECTION STATUS MESSAGES (for call screen) ====================
window.showConnectionStatus = function(message, type = 'info') {
    // Don't show duplicate messages
    if (CONFIG.lastStatusMessage === message) return;
    
    CONFIG.lastStatusMessage = message;
    
    // Use the call status area (visible during calls)
    const statusArea = document.getElementById('call-status-area');
    const statusText = document.getElementById('call-status-text');
    
    if (statusArea && statusText) {
        statusText.textContent = message;
        statusArea.className = `call-status-area ${type}`;
        statusArea.style.display = 'block';
        
        // Auto-clear success messages after 3 seconds
        if (type === 'success') {
            if (CONFIG.statusMessageTimeout) {
                clearTimeout(CONFIG.statusMessageTimeout);
            }
            CONFIG.statusMessageTimeout = setTimeout(() => {
                window.clearConnectionStatus();
            }, 3000);
        }
    } else {
        // Fallback to login-status (for login screen)
        if (dom.loginStatus) {
            dom.loginStatus.textContent = message;
            dom.loginStatus.className = `status-message ${type}`;
            dom.loginStatus.style.display = 'block';
        }
    }
};

window.clearConnectionStatus = function() {
    CONFIG.lastStatusMessage = null;
    
    // Clear call status area
    const statusArea = document.getElementById('call-status-area');
    if (statusArea) {
        statusArea.style.display = 'none';
        statusArea.className = 'call-status-area';
    }
    
    // Also clear login status (for consistency)
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
            // Disable all other call buttons during a call
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

// ==================== WEB PUSH NOTIFICATIONS ====================
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('❌ This browser does not support notifications');
        alert('Your browser does not support notifications');
        return false;
    }
    
    const permission = await Notification.requestPermission();
    console.log('📱 Notification permission:', permission);
    
    if (permission === 'granted') {
        await subscribeToPush();
        return true;
    }
    return false;
}

async function subscribeToPush() {
    if (!('serviceWorker' in navigator)) {
        console.log('❌ Service Worker not supported');
        return false;
    }
    
    if (!window.VAPID_PUBLIC_KEY) {
        console.error('❌ VAPID_PUBLIC_KEY not configured');
        return false;
    }
    
    try {
        const registration = await navigator.serviceWorker.ready;
        console.log('✅ Service Worker ready');
        
        // Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();
        
        if (subscription) {
            console.log('✅ Already subscribed to push');
            CONFIG.pushSubscription = subscription;
            await savePushSubscription(subscription);
            return true;
        }
        
        // Convert VAPID public key from base64 to Uint8Array
        const vapidPublicKey = window.VAPID_PUBLIC_KEY;
        const base64ToUint8Array = (base64String) => {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }
            return outputArray;
        };
        
        const applicationServerKey = base64ToUint8Array(vapidPublicKey);
        
        // Create new subscription
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        });
        
        console.log('✅ Push subscription created');
        CONFIG.pushSubscription = subscription;
        await savePushSubscription(subscription);
        return true;
        
    } catch (error) {
        console.error('❌ Failed to subscribe to push:', error);
        return false;
    }
}

async function savePushSubscription(subscription) {
    if (!CONFIG.myUsername) {
        console.log('⏳ Not logged in yet, will save later');
        // Store temporarily to save after login
        window.pendingPushSubscription = subscription;
        return;
    }
    
    try {
        // Convert subscription to plain object for Firestore
        const subscriptionData = {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            keys: {
                p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('p256dh')))),
                auth: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('auth'))))
            }
        };
        
        await db.collection('users').doc(CONFIG.myUsername).update({
            pushSubscription: subscriptionData,
            pushEnabled: true,
            pushLastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('✅ Push subscription saved to Firestore');
        
    } catch (error) {
        console.error('❌ Failed to save push subscription:', error);
    }
}

function showEnablePushButton() {
    // Check if push is already enabled
    if (CONFIG.pushSubscription) {
        console.log('Push already enabled');
        return;
    }
    
    // Check if we already have a button
    if (document.getElementById('enable-push-btn')) {
        return;
    }
    
    // Check if VAPID key is configured
    if (!window.VAPID_PUBLIC_KEY || window.VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') {
        console.log('⚠️ VAPID key not configured, skipping push button');
        return;
    }
    
    // Create enable push button
    const pushButton = document.createElement('button');
    pushButton.id = 'enable-push-btn';
    pushButton.className = 'enable-push-btn';
    pushButton.textContent = '🔔 Enable Notifications';
    
    pushButton.onclick = async () => {
        pushButton.disabled = true;
        pushButton.textContent = 'Requesting permission...';
        const granted = await requestNotificationPermission();
        if (granted) {
            pushButton.textContent = '✅ Notifications enabled';
            setTimeout(() => {
                pushButton.remove();
            }, 3000);
        } else {
            pushButton.textContent = '❌ Permission denied';
            setTimeout(() => {
                pushButton.textContent = '🔔 Enable Notifications';
                pushButton.disabled = false;
            }, 3000);
        }
    };
    
    // Add to users panel
    const usersPanel = document.querySelector('.users-panel');
    if (usersPanel && usersPanel.querySelector('#enable-push-btn') === null) {
        // Add after the users container
        usersPanel.appendChild(pushButton);
        console.log('✅ Enable push button added to UI');
    }
}

// Check for pending subscription after login
function checkPendingPushSubscription() {
    if (window.pendingPushSubscription && CONFIG.myUsername) {
        console.log('📱 Saving pending push subscription');
        savePushSubscription(window.pendingPushSubscription);
        window.pendingPushSubscription = null;
    }
}

// Expose functions globally
window.startRingtone = startRingtone;
window.stopRingtone = stopRingtone;
window.showConnectionStatus = showConnectionStatus;
window.clearConnectionStatus = clearConnectionStatus;
window.updateCallButtonState = updateCallButtonState;
window.resetAllCallButtons = resetAllCallButtons;
window.requestNotificationPermission = requestNotificationPermission;
window.subscribeToPush = subscribeToPush;
window.savePushSubscription = savePushSubscription;
window.showEnablePushButton = showEnablePushButton;
window.checkPendingPushSubscription = checkPendingPushSubscription;

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded');
    
    if (initDOM() && !uiInitialized) {
        // Clone and replace buttons to ensure clean event listeners
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
            
            dom.rejectBtn.addEventListener('click', () => {
                if (CONFIG.currentIncomingCall) {
                    const { callId } = CONFIG.currentIncomingCall;
                    db.collection('calls').doc(callId).update({
                        status: 'rejected',
                        endedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(err => console.error('Error rejecting call:', err));
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
        console.log('🚀 UI loaded with ringtone, connection status, and push notification support');
        
        window.dispatchEvent(new Event('ui-ready'));
    }
});

// Ensure audio context is resumed on user interaction
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}, { once: false });
