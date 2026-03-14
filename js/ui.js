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
        // Stop any existing ringtone
        stopRingtone();
        
        const ctx = initAudioContext();
        if (!ctx) return;
        
        // Resume audio context if suspended (browsers require user interaction)
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        
        // Create gain node for volume control
        ringtoneGain = ctx.createGain();
        ringtoneGain.gain.value = 0.3; // 30% volume
        ringtoneGain.connect(ctx.destination);
        
        // Create oscillator for the ringtone
        ringtoneOscillator = ctx.createOscillator();
        ringtoneOscillator.type = 'sine'; // Sine wave for softer ring
        ringtoneOscillator.frequency.value = 440; // A4 note
        
        // Connect oscillator to gain
        ringtoneOscillator.connect(ringtoneGain);
        
        // Start the oscillator
        ringtoneOscillator.start();
        
        // Create on/off pattern for ringing effect
        let isOn = true;
        ringtoneInterval = setInterval(() => {
            if (ringtoneGain) {
                ringtoneGain.gain.value = isOn ? 0.3 : 0;
                isOn = !isOn;
            }
        }, 500); // 500ms on, 500ms off
        
        log('🔔 Ringtone started');
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
        } catch (error) {
            // Ignore errors if already stopped
        }
        ringtoneOscillator = null;
    }
    
    if (ringtoneGain) {
        ringtoneGain.disconnect();
        ringtoneGain = null;
    }
    
    log('🔕 Ringtone stopped');
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
    dom.debugContent = document.getElementById('debug-content');
    dom.clearDebugBtn = document.getElementById('clear-debug');
    dom.modalOverlay = document.getElementById('modal-overlay');
    dom.incomingModal = document.getElementById('incoming-call-modal');
    dom.callerNameSpan = document.getElementById('caller-name');
    dom.acceptBtn = document.getElementById('accept-call');
    dom.rejectBtn = document.getElementById('reject-call');

    console.log('DOM Elements Found:', {
        loginScreen: !!dom.loginScreen,
        callScreen: !!dom.callScreen,
        loginBtn: !!dom.loginBtn,
        hangupBtn: !!dom.hangupBtn,
        modalOverlay: !!dom.modalOverlay
    });

    if (!dom.loginScreen || !dom.callScreen) {
        console.error('Critical screen elements are missing!');
        return false;
    }
    
    return true;
}

// ==================== DEBUG LOGGING ====================
window.log = function(message) {
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${message}`;
    
    if (dom.debugContent) {
        dom.debugContent.innerHTML += line + '\n';
        dom.debugContent.scrollTop = dom.debugContent.scrollHeight;
    }
    console.log(message);
};

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
    
    // Start ringing
    startRingtone();
    
    // Auto-stop after 30 seconds (timeout)
    setTimeout(() => {
        if (CONFIG.currentIncomingCall) {
            log('⏰ Incoming call timed out');
            hideIncomingCallModal();
        }
    }, 30000);
};

window.hideIncomingCallModal = function() {
    if (!dom.modalOverlay || !dom.incomingModal) return;
    
    dom.modalOverlay.style.display = 'none';
    dom.incomingModal.style.display = 'none';
    CONFIG.currentIncomingCall = null;
    
    // Stop ringing
    stopRingtone();
};

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded');
    
    if (initDOM() && !uiInitialized) {
        // Clone and replace buttons to ensure clean event listeners
        if (dom.clearDebugBtn) {
            const newClearBtn = dom.clearDebugBtn.cloneNode(true);
            dom.clearDebugBtn.parentNode.replaceChild(newClearBtn, dom.clearDebugBtn);
            dom.clearDebugBtn = newClearBtn;
            
            dom.clearDebugBtn.addEventListener('click', () => {
                if (dom.debugContent) dom.debugContent.innerHTML = '';
            });
        }

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
                    log('📞 Call rejected');
                }
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
        log('🚀 UI loaded with ringtone support');
        
        // Signal that UI is ready
        window.dispatchEvent(new Event('ui-ready'));
    }
});

// Ensure audio context is resumed on user interaction
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}, { once: false });
