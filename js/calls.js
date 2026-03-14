console.log('✅ calls.js loaded');

// ==================== CLEANUP STALE CALLS ====================
window.cleanupStaleCalls = async function() {
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
};

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
        window.loadUsers?.();
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
        window.hangup?.('answer_error');
    }
};


// ==================== SIMPLE VERSION - JUST DELETE ALL BUT LATEST ====================
window.cleanupAllButLatest = async function() {
    if (!CONFIG.myUsername) return;
    
    try {
        log('🧹 Cleaning up all but latest call per user...');
        
        // Get all calls
        const allCallsSnapshot = await db.collection('calls').get();
        
        if (allCallsSnapshot.empty) {
            log('📭 No calls to clean up');
            return;
        }
        
        // Group calls by user pair (caller-callee combination)
        const callsByPair = {};
        
        allCallsSnapshot.forEach(doc => {
            const callData = doc.data();
            // Create a unique key for the pair (sorted so A-B and B-A are the same)
            const users = [callData.callerId, callData.calleeId].sort();
            const pairKey = `${users[0]}-${users[1]}`;
            
            if (!callsByPair[pairKey]) {
                callsByPair[pairKey] = [];
            }
            
            let timestamp = 0;
            if (callData.timestamp) {
                timestamp = callData.timestamp.toMillis?.() || 
                           callData.timestamp._seconds * 1000 || 
                           callData.timestamp;
            }
            
            callsByPair[pairKey].push({
                id: doc.id,
                timestamp: timestamp,
                ref: doc.ref,
                data: callData
            });
        });
        
        // Keep only the most recent for each pair
        const batch = db.batch();
        let deletedCount = 0;
        let keptCount = 0;
        
        Object.keys(callsByPair).forEach(pairKey => {
            const pairCalls = callsByPair[pairKey];
            
            // Sort by timestamp (newest first)
            pairCalls.sort((a, b) => b.timestamp - a.timestamp);
            
            // Keep the most recent
            pairCalls.forEach((call, index) => {
                if (index === 0) {
                    keptCount++;
                    log(`✅ Keeping latest call for pair ${pairKey}`);
                } else {
                    batch.delete(call.ref);
                    deletedCount++;
                    log(`🗑️ Deleting old call for pair ${pairKey}`);
                }
            });
        });
        
        if (deletedCount > 0) {
            await batch.commit();
            log(`🧹 Cleanup complete: kept ${keptCount} calls, deleted ${deletedCount} old calls`);
        } else {
            log(`📭 No old calls to delete`);
        }
        
    } catch (error) {
        log(`❌ Error during cleanup: ${error.message}`);
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
                    
                    if (window.showIncomingCallModal) {
                        window.showIncomingCallModal(callData.callerId, callId, callData.offer);
                    }
                }
            });
        }, (error) => {
            log(`❌ Error listening for calls: ${error.message}`);
        });
};

// ==================== HANGUP FUNCTION ====================
// ==================== HANGUP FUNCTION WITH AUTO-CLEANUP ====================
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
    
    if (window.dom && window.dom.remoteVideo) {
        window.dom.remoteVideo.srcObject = null;
    }
    if (window.dom && window.dom.hangupBtn) {
        window.dom.hangupBtn.disabled = true;
    }
    
    if (window.hideIncomingCallModal) window.hideIncomingCallModal();
    
    log('📞 Call ended');
    window.loadUsers?.();
    
    // ===== AUTO-CLEANUP AFTER HANGUP =====
    // Clean up old calls, keeping only the latest for each user pair
    setTimeout(async () => {
        log('🧹 Running post-call cleanup...');
        await window.cleanupOldCallsKeepLatest();
    }, 1000); // Small delay to ensure call status is updated first
};

// ==================== ENHANCED CLEANUP FUNCTION ====================
window.cleanupOldCallsKeepLatest = async function() {
    if (!CONFIG.myUsername) return;
    
    try {
        log('🧹 Starting smart cleanup - keeping only latest call per user...');
        
        // Get all calls where this user is involved (as caller or callee)
        const [callerCalls, calleeCalls] = await Promise.all([
            db.collection('calls').where('callerId', '==', CONFIG.myUsername).get(),
            db.collection('calls').where('calleeId', '==', CONFIG.myUsername).get()
        ]);
        
        // Combine all calls
        const allCalls = [...callerCalls.docs, ...calleeCalls.docs];
        
        if (allCalls.length === 0) {
            log('📭 No calls to clean up');
            return;
        }
        
        log(`📊 Found ${allCalls.length} total calls`);
        
        // Group calls by the other user
        const callsByUser = {};
        
        allCalls.forEach(doc => {
            const callData = doc.data();
            const otherUser = callData.callerId === CONFIG.myUsername ? 
                callData.calleeId : callData.callerId;
            
            if (!callsByUser[otherUser]) {
                callsByUser[otherUser] = [];
            }
            
            // Get timestamp (handle different timestamp formats)
            let timestamp = 0;
            if (callData.timestamp) {
                timestamp = callData.timestamp.toMillis?.() || 
                           callData.timestamp._seconds * 1000 || 
                           callData.timestamp;
            }
            
            callsByUser[otherUser].push({
                id: doc.id,
                timestamp: timestamp,
                ref: doc.ref,
                data: callData
            });
        });
        
        // For each user, keep only the most recent call
        const batch = db.batch();
        let deletedCount = 0;
        let keptCount = 0;
        
        Object.keys(callsByUser).forEach(otherUser => {
            const userCalls = callsByUser[otherUser];
            
            // Sort by timestamp (newest first)
            userCalls.sort((a, b) => b.timestamp - a.timestamp);
            
            // Keep the first one (most recent), delete the rest
            userCalls.forEach((call, index) => {
                if (index === 0) {
                    keptCount++;
                    log(`✅ Keeping latest call with ${otherUser}`);
                } else {
                    batch.delete(call.ref);
                    deletedCount++;
                    log(`🗑️ Deleting old call with ${otherUser}`);
                }
            });
        });
        
        if (deletedCount > 0) {
            await batch.commit();
            log(`🧹 Cleanup complete: kept ${keptCount} calls, deleted ${deletedCount} old calls`);
        } else {
            log(`📭 No old calls to delete - all calls are already the latest`);
        }
        
    } catch (error) {
        log(`❌ Error during smart cleanup: ${error.message}`);
    }
};



// ==================== ATTACH HANGUP BUTTON LISTENER ====================
// This needs to run after DOM is ready
function attachHangupListener() {
    if (window.dom && window.dom.hangupBtn) {
        // Remove any existing listeners by cloning
        const oldBtn = window.dom.hangupBtn;
        const newBtn = oldBtn.cloneNode(true);
        oldBtn.parentNode.replaceChild(newBtn, oldBtn);
        window.dom.hangupBtn = newBtn;
        
        window.dom.hangupBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.hangup('user_initiated');
        });
        
        console.log('✅ Hangup button listener attached');
    } else {
        console.warn('Hangup button not found, will retry...');
        setTimeout(attachHangupListener, 500);
    }
}

// Try to attach when UI is ready
if (window.dom) {
    attachHangupListener();
} else {
    window.addEventListener('ui-ready', attachHangupListener);
}
