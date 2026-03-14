// ==================== CLEANUP STALE CALLS ====================
async function cleanupStaleCalls() {
    if (!CONFIG.myUsername) return;
    
    try {
        const oldCalls = await db.collection('calls')
            .where('callerId', '==', CONFIG.myUsername)
            .where('status', '==', 'ringing')
            .get();
        
        const twoMinutesAgo = Date.now() - 120000;
        
        oldCalls.forEach(doc => {
            const callData = doc.data();
            const callTime = callData.timestamp?.toMillis?.() || 0;
            
            if (callTime < twoMinutesAgo) {
                log(`🧹 Cleaning up stale call: ${doc.id}`);
                doc.ref.update({
                    status: 'ended',
                    endedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });
    } catch (error) {
        log(`Error cleaning up stale calls: ${error.message}`);
    }
}

// ==================== CALL FUNCTIONS ====================
window.callUser = async function(targetUsername) {
    if (!CONFIG.localStream) {
        alert('Please wait for camera access');
        return;
    }
    
    if (CONFIG.isInCall) {
        alert('Already in a call');
        return;
    }
    
    log(`📞 Calling ${targetUsername}...`);
    
    try {
        CONFIG.isInCall = true;
        CONFIG.currentCallId = `${CONFIG.myUsername}_${targetUsername}_${Date.now()}`;
        
        updateCallButtons(targetUsername);
        
        await window.createPeerConnection(targetUsername, true);
        
        const offer = await CONFIG.peerConnection.createOffer();
        await CONFIG.peerConnection.setLocalDescription(offer);
        
        await db.collection('calls').doc(CONFIG.currentCallId).set({
            callerId: CONFIG.myUsername,
            calleeId: targetUsername,
            offer: {
                type: offer.type,
                sdp: offer.sdp
            },
            status: 'ringing',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            restartAttempt: 0
        });
        
        log('📤 Offer sent, waiting for answer...');
        
        db.collection('calls').doc(CONFIG.currentCallId).onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            
            const data = snapshot.data();
            if (data.answer && CONFIG.peerConnection && !CONFIG.peerConnection.currentRemoteDescription) {
                log('📥 Received answer');
                CONFIG.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
                    .catch(err => log(`❌ Error setting remote description: ${err.message}`));
            }
        });
        
        db.collection('ice-candidates')
            .where('callId', '==', CONFIG.currentCallId)
            .where('fromUserId', '==', targetUsername)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' && CONFIG.peerConnection) {
                        const data = change.doc.data();
                        CONFIG.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                            .catch(err => log(`❌ Error adding ICE candidate: ${err.message}`));
                        log('🧊 Added remote ICE candidate');
                    }
                });
            });
        
    } catch (error) {
        log(`❌ Call error: ${error.message}`);
        CONFIG.isInCall = false;
        CONFIG.currentCallId = null;
        window.loadUsers();
    }
};

function updateCallButtons(calledUsername) {
    const buttons = document.querySelectorAll('.call-user-btn');
    buttons.forEach(button => {
        if (button.getAttribute('onclick')?.includes(calledUsername)) {
            button.disabled = true;
            button.textContent = 'Calling...';
        } else {
            button.disabled = true;
        }
    });
}

// ==================== ANSWER FUNCTION ====================
window.answerCall = async function(callId, callerId, offer) {
    log(`✅ Answering call from ${callerId}`);
    
    try {
        CONFIG.isInCall = true;
        CONFIG.currentCallId = callId;
        
        await window.createPeerConnection(callerId, false);
        
        await CONFIG.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await CONFIG.peerConnection.createAnswer();
        await CONFIG.peerConnection.setLocalDescription(answer);
        
        await db.collection('calls').doc(callId).update({
            answer: {
                type: answer.type,
                sdp: answer.sdp
            },
            status: 'answered',
            answeredAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        log('📤 Answer sent');
        
        db.collection('ice-candidates')
            .where('callId', '==', callId)
            .where('fromUserId', '==', callerId)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' && CONFIG.peerConnection) {
                        const data = change.doc.data();
                        CONFIG.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                            .catch(err => log(`❌ Error adding ICE candidate: ${err.message}`));
                    }
                });
            });
        
    } catch (error) {
        log(`❌ Error answering call: ${error.message}`);
        window.hangup('answer_error');
    }
};

// ==================== INCOMING CALL LISTENER ====================
window.listenForIncomingCalls = function() {
    if (!CONFIG.myUsername) return;
    
    log(`👂 Listening for incoming calls as ${CONFIG.myUsername}...`);
    
    db.collection('calls')
        .where('calleeId', '==', CONFIG.myUsername)
        .where('status', '==', 'ringing')
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const callData = change.doc.data();
                    const callId = change.doc.id;
                    
                    if (callData.callerId === CONFIG.myUsername) {
                        log(`⏭️ Ignoring self-initiated call from ${callData.callerId}`);
                        return;
                    }
                    
                    log(`📞 Incoming call from ${callData.callerId}!`);
                    
                    // Show custom modal
                    window.showIncomingCallModal(callData.callerId, callId, callData.offer);
                }
            });
        }, (error) => {
            log(`❌ Error listening for calls: ${error.message}`);
        });
};

// ==================== HANGUP FUNCTION ====================
window.hangup = async function(reason = 'user_initiated') {
    log(`📞 Call ended - reason: ${reason}`);
    
    if (CONFIG.peerConnection) {
        CONFIG.peerConnection.close();
        CONFIG.peerConnection = null;
    }
    
    if (CONFIG.currentCallId) {
        try {
            await db.collection('calls').doc(CONFIG.currentCallId).update({
                status: 'ended',
                endedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            log(`Error updating call status: ${err.message}`);
        }
    }
    
    if (CONFIG.connectionTimeout) {
        clearTimeout(CONFIG.connectionTimeout);
        CONFIG.connectionTimeout = null;
    }
    
    CONFIG.remoteStream = null;
    CONFIG.isInCall = false;
    CONFIG.currentCallId = null;
    CONFIG.iceRestartAttempts = 0;
    
    dom.remoteVideo.srcObject = null;
    dom.hangupBtn.disabled = true;
    
    window.hideIncomingCallModal();
    
    log('📞 Call ended');
    window.loadUsers();
};

dom.hangupBtn.addEventListener('click', () => window.hangup('user_initiated'));

// Make cleanupStaleCalls available globally
window.cleanupStaleCalls = cleanupStaleCalls;
