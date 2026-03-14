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
        modalOverlay: !!dom.modalOverlay
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

		// In the event listeners section, add:
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
        console.log('🚀 UI loaded with ringtone support');
        
        window.dispatchEvent(new Event('ui-ready'));
    }
});

// Ensure audio context is resumed on user interaction
document.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}, { once: false });

// Make functions available globally
window.startRingtone = startRingtone;
window.stopRingtone = stopRingtone;
