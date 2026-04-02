// Global DOM object
// VERSION: 4.0 - CLEAN - NO DEBUG ALERTS
console.log('🚀 UI.JS VERSION 4.0 - CLEAN');

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
    
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        alert('Notification permission denied. Please enable in browser settings.');
        return false;
    }
    
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
    const checkExisting = async () => {
        if (!CONFIG.myUsername) return;
        
        const userDoc = await db.collection('users').doc(CONFIG.myUsername).get();
        const userData = userDoc.data();
        if (userData?.webPushSubscription || userData?.fcmToken) {
            console.log('✅ Push already enabled for this user');
            return;
        }
        
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

// Extract key from URL
function extractBarkKey(input) {
    if (!input) return null;
    input = input.trim();
    
    if (input.includes('api.day.app/')) {
        const match = input.match(/api\.day\.app\/([^\/]+)/);
        if (match && match[1]) return match[1];
    }
    
    if (input.length > 20 && /^[a-zA-Z0-9]+$/.test(input)) {
        return input;
    }
    
    return null;
}

// Save Bark key
async function saveBarkDeviceKey() {
    if (!CONFIG.myUsername) {
        alert('Please log in first');
        return false;
    }
    
    const barkUrl = prompt(
        '🍎 Set up iOS Call Notifications\n\n' +
        '1. Open the Bark app\n' +
        '2. Tap the "Service" tab\n' +
        '3. Tap "Copy Test"\n' +
        '4. Paste the URL here\n\n' +
        'Paste the URL here:'
    );
    
    if (!barkUrl) return false;
    
    const barkKey = extractBarkKey(barkUrl);
    if (!barkKey) {
        alert('❌ Invalid Bark URL. Please tap "Copy Test" in the Bark app and paste again.');
        return false;
    }
    
    try {
        await db.collection('users').doc(CONFIG.myUsername).update({
            barkDeviceKey: barkKey,
            barkEnabled: true,
            barkLastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        localStorage.setItem('bark_device_key', barkKey);
        alert('✅ Bark notifications enabled!');
        return true;
        
    } catch (error) {
        console.error('❌ Failed to save:', error);
        alert('❌ Failed to save: ' + error.message);
        return false;
    }
}

// Bark Setup Button - Clean version without alerts
function addBarkSetupButton() {
    console.log('addBarkSetupButton() called');
    
    if (!CONFIG || !CONFIG.myUsername) {
        console.log('No user logged in');
        return;
    }
    
    const checkAndAdd = async () => {
        try {
            const userDoc = await db.collection('users').doc(CONFIG.myUsername).get();
            const userData = userDoc.data();
            
            if (userData && userData.barkDeviceKey) {
                console.log('Bark already enabled - skipping button');
                return;
            }
        } catch (e) {
            console.log('Error checking user data:', e.message);
        }
        
        const rightPanels = document.querySelector('.right-panels');
        if (!rightPanels) {
            console.error('Could not find .right-panels');
            return;
        }
        
        let placeholder = document.getElementById('bark-setup-container-placeholder');
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = 'bark-setup-container-placeholder';
            placeholder.style.cssText = 'width: 100%; margin-top: 20px;';
            rightPanels.appendChild(placeholder);
        }
        
        placeholder.innerHTML = '';
        
        const container = document.createElement('div');
        container.id = 'bark-setup-container';
        container.style.cssText = 'background: #ff9800; padding: 12px; margin: 10px 0; border-radius: 10px; text-align: center;';
        
        const button = document.createElement('button');
        button.textContent = '🍎 Enable iOS Call Notifications (Bark)';
        button.style.cssText = 'background: white; color: #ff9800; padding: 10px; border: none; border-radius: 8px; width: 100%; font-size: 14px; font-weight: bold; cursor: pointer;';
        
        button.onclick = async () => {
            button.disabled = true;
            button.textContent = 'Setting up...';
            await saveBarkDeviceKey();
            button.disabled = false;
            button.textContent = '🍎 Enable iOS Call Notifications (Bark)';
            
            const checkAgain = await db.collection('users').doc(CONFIG.myUsername).get();
            if (checkAgain.data()?.barkDeviceKey) {
                container.remove();
            }
        };
        
        container.appendChild(button);
        placeholder.appendChild(container);
        console.log('Bark button added');
    };
    
    checkAndAdd();
}

// ==================== AUTO-SUBSCRIBE ====================
window.autoSubscribeToPush = async function() {
    if (!CONFIG.myUsername) return;
    
    const userDoc = await db.collection('users').doc(CONFIG.myUsername).get();
    const userData = userDoc.data();
    
    if (userData?.webPushSubscription || userData?.fcmToken) {
        console.log('Already subscribed');
        return;
    }
    
    const permission = Notification.permission;
    
    if (permission === 'granted') {
        console.log('Permission already granted, auto-subscribing...');
        await savePushSubscriptions();
    } else if (permission === 'default') {
        console.log('Asking for notification permission...');
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
window.addBarkSetupButton = addBarkSetupButton;
window.saveBarkDeviceKey = saveBarkDeviceKey;
window.extractBarkKey = extractBarkKey;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded');
    
    if (initDOM() && !uiInitialized) {
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
            
            dom.rejectBtn.addEventListener('click', async () => {
                if (CONFIG.currentIncomingCall) {
                    const { callId } = CONFIG.currentIncomingCall;
                    
                    try {
                        await db.collection('calls').doc(callId).update({
                            status: 'rejected',
                            endedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        console.log('Call rejected');
                        fetch(`https://us-central1-webrtc-v0.cloudfunctions.net/rejectCall?callId=${callId}`)
                            .catch(err => console.log('Reject endpoint error:', err));
                    } catch (err) {
                        console.error('Error rejecting call:', err);
                    }
                    
                    hideIncomingCallModal();
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
        console.log('UI loaded');
        
        window.dispatchEvent(new Event('ui-ready'));
    }
});

// ==================== LOGIN COMPLETE EVENT ====================
window.addEventListener('login-complete', () => {
    console.log('Login complete event fired');
    setTimeout(() => {
        window.autoSubscribeToPush();
        addBarkSetupButton();
    }, 1000);
});

// ==================== CHECK ON PAGE LOAD ====================
setTimeout(() => {
    if (CONFIG && CONFIG.myUsername) {
        console.log('User already logged in');
        window.autoSubscribeToPush();
        addBarkSetupButton();
    }
}, 3000);

// ==================== AUDIO CONTEXT RESUME ====================
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}, { once: false });
