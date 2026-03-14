// Global DOM object - define it immediately
window.dom = {};

// Initialize DOM elements when document is ready
function initDOM() {
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

    // Verify all elements exist
    if (!dom.loginScreen || !dom.callScreen || !dom.codeDisplay || !dom.loginBtn || !dom.loginStatus || 
        !dom.logoutBtn || !dom.currentUserSpan || !dom.hangupBtn || !dom.localVideo || !dom.remoteVideo || 
        !dom.usersContainer || !dom.debugContent || !dom.clearDebugBtn || !dom.modalOverlay || 
        !dom.incomingModal || !dom.callerNameSpan || !dom.acceptBtn || !dom.rejectBtn) {
        console.error('Some DOM elements are missing!');
        return false;
    }
    return true;
}

// ==================== DEBUG LOGGING ====================
window.log = function(message) {
    if (!dom.debugContent) {
        console.log(message); // Fallback if DOM not ready
        return;
    }
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${message}`;
    dom.debugContent.innerHTML += line + '\n';
    dom.debugContent.scrollTop = dom.debugContent.scrollHeight;
    console.log(message);
};

// ==================== MODAL FUNCTIONS ====================
window.showIncomingCallModal = function(callerId, callId, offer) {
    CONFIG.currentIncomingCall = { callId, callerId, offer };
    dom.callerNameSpan.textContent = `Call from ${callerId}`;
    dom.modalOverlay.style.display = 'block';
    dom.incomingModal.style.display = 'block';
};

window.hideIncomingCallModal = function() {
    dom.modalOverlay.style.display = 'none';
    dom.incomingModal.style.display = 'none';
    CONFIG.currentIncomingCall = null;
};

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (initDOM()) {
        // Set up event listeners that depend on DOM
        dom.clearDebugBtn.addEventListener('click', () => {
            dom.debugContent.innerHTML = '';
        });

        dom.acceptBtn.addEventListener('click', () => {
            if (CONFIG.currentIncomingCall) {
                const { callId, callerId, offer } = CONFIG.currentIncomingCall;
                hideIncomingCallModal();
                if (window.answerCall) window.answerCall(callId, callerId, offer);
            }
        });

        dom.rejectBtn.addEventListener('click', () => {
            if (CONFIG.currentIncomingCall) {
                const { callId } = CONFIG.currentIncomingCall;
                db.collection('calls').doc(callId).update({
                    status: 'rejected',
                    endedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                hideIncomingCallModal();
                log('📞 Call rejected');
            }
        });

        dom.modalOverlay.addEventListener('click', () => {
            hideIncomingCallModal();
        });

        log('🚀 UI loaded');
        
        // Initialize the app after UI is ready
        if (window.initApp) window.initApp();
    }
});
