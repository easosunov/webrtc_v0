// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    
    // ==================== DOM ELEMENTS ====================
    window.dom = {
        loginScreen: document.getElementById('login-screen'),
        callScreen: document.getElementById('call-screen'),
        codeDisplay: document.getElementById('code-display'),
        loginBtn: document.getElementById('login-btn'),
        loginStatus: document.getElementById('login-status'),
        logoutBtn: document.getElementById('logout-btn'),
        currentUserSpan: document.getElementById('current-user'),
        hangupBtn: document.getElementById('hangup-btn'),
        localVideo: document.getElementById('local-video'),
        remoteVideo: document.getElementById('remote-video'),
        usersContainer: document.getElementById('users-container'),
        debugContent: document.getElementById('debug-content'),
        clearDebugBtn: document.getElementById('clear-debug'),
        modalOverlay: document.getElementById('modal-overlay'),
        incomingModal: document.getElementById('incoming-call-modal'),
        callerNameSpan: document.getElementById('caller-name'),
        acceptBtn: document.getElementById('accept-call'),
        rejectBtn: document.getElementById('reject-call')
    };

    // ==================== DEBUG LOGGING ====================
    window.log = function(message) {
        const timestamp = new Date().toLocaleTimeString();
        const line = `[${timestamp}] ${message}`;
        dom.debugContent.innerHTML += line + '\n';
        dom.debugContent.scrollTop = dom.debugContent.scrollHeight;
        console.log(message);
    };

    dom.clearDebugBtn.addEventListener('click', () => {
        dom.debugContent.innerHTML = '';
    });

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

    dom.acceptBtn.addEventListener('click', () => {
        if (CONFIG.currentIncomingCall) {
            const { callId, callerId, offer } = CONFIG.currentIncomingCall;
            hideIncomingCallModal();
            window.answerCall(callId, callerId, offer);
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
});
