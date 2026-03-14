// Global DOM object
window.dom = {};

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

    // Log what we found
    console.log('DOM Elements:', {
        loginScreen: !!dom.loginScreen,
        callScreen: !!dom.callScreen,
        loginBtn: !!dom.loginBtn,
        hangupBtn: !!dom.hangupBtn,
        modalOverlay: !!dom.modalOverlay
    });

    // Verify all critical elements exist
    if (!dom.loginScreen || !dom.callScreen || !dom.loginBtn) {
        console.error('Critical DOM elements are missing!');
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

// ==================== MODAL FUNCTIONS ====================
window.showIncomingCallModal = function(callerId, callId, offer) {
    if (!dom.modalOverlay || !dom.incomingModal || !dom.callerNameSpan) {
        console.error('Modal elements not found');
        return;
    }
    
    CONFIG.currentIncomingCall = { callId, callerId, offer };
    dom.callerNameSpan.textContent = `Call from ${callerId}`;
    dom.modalOverlay.style.display = 'block';
    dom.incomingModal.style.display = 'block';
};

window.hideIncomingCallModal = function() {
    if (!dom.modalOverlay || !dom.incomingModal) return;
    
    dom.modalOverlay.style.display = 'none';
    dom.incomingModal.style.display = 'none';
    CONFIG.currentIncomingCall = null;
};

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded');
    
    if (initDOM()) {
        // Set up event listeners that depend on DOM
        if (dom.clearDebugBtn) {
            dom.clearDebugBtn.addEventListener('click', () => {
                if (dom.debugContent) dom.debugContent.innerHTML = '';
            });
        }

        if (dom.acceptBtn) {
            dom.acceptBtn.addEventListener('click', () => {
                if (CONFIG.currentIncomingCall) {
                    const { callId, callerId, offer } = CONFIG.currentIncomingCall;
                    hideIncomingCallModal();
                    if (window.answerCall) window.answerCall(callId, callerId, offer);
                }
            });
        }

        if (dom.rejectBtn) {
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
            dom.modalOverlay.addEventListener('click', () => {
                hideIncomingCallModal();
            });
        }

        log('🚀 UI loaded');
        
        // Signal that UI is ready
        window.dispatchEvent(new Event('ui-ready'));
    }
});
