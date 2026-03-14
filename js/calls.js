console.log('✅ calls.js loaded');

// Audio context for ringback tone (caller hears this)
let ringbackContext = null;
let ringbackGain = null;
let ringbackOscillator = null;
let ringbackInterval = null;

// ==================== RINGBACK TONE FUNCTIONS (for caller) ====================
function initRingbackContext() {
    if (ringbackContext) return ringbackContext;
    
    try {
        ringbackContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('🔊 Ringback audio context initialized');
    } catch (error) {
        console.error('❌ Failed to create ringback audio context:', error);
    }
    return ringbackContext;
}

function startRingbackTone() {
    try {
        stopRingbackTone();
        
        const ctx = initRingbackContext();
        if (!ctx) return;
        
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        
        ringbackGain = ctx.createGain();
        ringbackGain.gain.value = 0.2;
        ringbackGain.connect(ctx.destination);
        
        ringbackOscillator = ctx.createOscillator();
        ringbackOscillator.type = 'sine';
        ringbackOscillator.frequency.value = 440;
        
        ringbackOscillator.connect(ringbackGain);
        ringbackOscillator.start();
        
        let isOn = true;
        ringbackInterval = setInterval(() => {
            if (ringbackGain) {
                ringbackGain.gain.value = isOn ? 0.2 : 0;
                isOn = !isOn;
            }
        }, 2000);
        
        console.log('🔊 Ringback tone started');
    } catch (error) {
        console.error('❌ Failed to start ringback tone:', error);
    }
}

function stopRingbackTone() {
    if (ringbackInterval) {
        clearInterval(ringbackInterval);
        ringbackInterval = null;
    }
    
    if (ringbackOscillator) {
        try {
            ringbackOscillator.stop();
            ringbackOscillator.disconnect();
        } catch (error) {}
        ringbackOscillator = null;
    }
    
    if (ringbackGain) {
        ringbackGain.disconnect();
        ringbackGain = null;
    }
    
    console.log('🔇 Ringback tone stopped');
}

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
                console.log(`🧹 Cleaning up stale call: ${doc.id}`);
                doc.ref.update({
                    status: 'ended',
                    endedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });
    } catch (error) {
        console.log(`Error cleaning up stale calls: ${error.message}`);
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
    
    console.log(`📞 Calling ${targetUsername}...`);
    
    try {
        CONFIG.isInCall = true;
        CONFIG.currentCallId = `${CONFIG.myUsername}_${targetUsername}_${Date.now()}`;
        
        updateCallButtons(targetUsername);
        
        startRingbackTone();
        
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
        
        console.log('📤 Offer sent, waiting for answer...');
        
        const unsubscribe = db.collection('calls').doc(CONFIG.currentCallId).onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            
            const data = snapshot.data();
            if (data.answer && CONFIG.peerConnection && !CONFIG.peerConnection.currentRemoteDescription) {
                console.log('📥 Received answer');
                stopRingbackTone();
                CONFIG.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
                    .catch(err => console.log(`❌ Error setting remote description: ${err.message}`));
                unsubscribe();
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
                            .catch(err => console.log(`❌ Error adding ICE candidate: ${err.message}`));
                        console.log('🧊 Added remote ICE candidate');
                    }
                });
            });
        
        setTimeout(() => {
            if (CONFIG.isInCall && !CONFIG.peerConnection?.currentRemoteDescription) {
                console.log('⏰ Call timeout - no answer received');
                stopRingbackTone();
                window.hangup('timeout');
            }
        }, 30000);
        
    } catch (error) {
        console.log(`❌ Call error: ${error.message}`);
        stopRingbackTone();
        CONFIG.isInCall = false;
        CONFIG.currentCallId = null;
        if (window.loadUsers) window.loadUsers();
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
    console.log(`✅ Answering call from ${callerId}`);
    
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
        
        console.log('📤 Answer sent');
        
        db.collection('ice-candidates')
            .where('callId', '==', callId)
            .where('fromUserId', '==', callerId)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' && CONFIG.peerConnection) {
                        const data = change.doc.data();
                        CONFIG.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                            .catch(err => console.log(`❌ Error adding ICE candidate: ${err.message}`));
                    }
                });
            });
        
    } catch (error) {
        console.log(`❌ Error answering call: ${error.message}`);
        if (window.hangup) window.hangup('answer_error');
    }
};

// ==================== INCOMING CALL LISTENER ====================
window.listenForIncomingCalls = function() {
    if (!CONFIG.myUsername) return;
    
    console.log(`👂 Listening for incoming calls as ${CONFIG.myUsername}...`);
    
    db.collection('calls')
        .where('calleeId', '==', CONFIG.myUsername)
        .where('status', '==', 'ringing')
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const callData = change.doc.data();
                    const callId = change.doc.id;
                    
                    if (callData.callerId === CONFIG.myUsername) {
                        console.log(`⏭️ Ignoring self-initiated call from ${callData.callerId}`);
                        return;
                    }
                    
                    console.log(`📞 Incoming call from ${callData.callerId}!`);
                    
                    if (window.showIncomingCallModal) {
                        window.showIncomingCallModal(callData.callerId, callId, callData.offer);
                    }
                }
            });
        }, (error) => {
            console.log(`❌ Error listening for calls: ${error.message}`);
        });
};

// ==================== HANGUP FUNCTION WITH AUTO-CLEANUP ====================
window.hangup = async function(reason = 'user_initiated') {
    console.log(`📞 Call ended - reason: ${reason}`);
    
    if (window.stopRingtone) window.stopRingtone();
    stopRingbackTone();
    
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
            console.log(`Error updating call status: ${err.message}`);
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
    
    console.log('📞 Call ended');
    if (window.loadUsers) window.loadUsers();
    
    setTimeout(async () => {
        console.log('🧹 Running post-call cleanup...');
        if (window.cleanupOldCallsKeepLatest) await window.cleanupOldCallsKeepLatest();
    }, 1000);
};

// ==================== CLEANUP OLD CALLS ====================
window.cleanupOldCallsKeepLatest = async function() {
    if (!CONFIG.myUsername) return;
    
    try {
        console.log('🧹 Starting smart cleanup - keeping only latest call per user...');
        
        const [callerCalls, calleeCalls] = await Promise.all([
            db.collection('calls').where('callerId', '==', CONFIG.myUsername).get(),
            db.collection('calls').where('calleeId', '==', CONFIG.myUsername).get()
        ]);
        
        const allCalls = [...callerCalls.docs, ...calleeCalls.docs];
        
        if (allCalls.length === 0) {
            console.log('📭 No calls to clean up');
            return;
        }
        
        console.log(`📊 Found ${allCalls.length} total calls`);
        
        const callsByUser = {};
        
        allCalls.forEach(doc => {
            const callData = doc.data();
            const otherUser = callData.callerId === CONFIG.myUsername ? 
                callData.calleeId : callData.callerId;
            
            if (!callsByUser[otherUser]) {
                callsByUser[otherUser] = [];
            }
            
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
        
        const batch = db.batch();
        let deletedCount = 0;
        let keptCount = 0;
        
        Object.keys(callsByUser).forEach(otherUser => {
            const userCalls = callsByUser[otherUser];
            userCalls.sort((a, b) => b.timestamp - a.timestamp);
            
            userCalls.forEach((call, index) => {
                if (index === 0) {
                    keptCount++;
                    console.log(`✅ Keeping latest call with ${otherUser}`);
                } else {
                    batch.delete(call.ref);
                    deletedCount++;
                    console.log(`🗑️ Deleting old call with ${otherUser}`);
                }
            });
        });
        
        if (deletedCount > 0) {
            await batch.commit();
            console.log(`🧹 Cleanup complete: kept ${keptCount} calls, deleted ${deletedCount} old calls`);
        } else {
            console.log(`📭 No old calls to delete`);
        }
        
    } catch (error) {
        console.log(`❌ Error during smart cleanup: ${error.message}`);
    }
};

// ==================== ATTACH HANGUP BUTTON LISTENER ====================
function attachHangupListener() {
    if (window.dom && window.dom.hangupBtn) {
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

if (window.dom) {
    attachHangupListener();
} else {
    window.addEventListener('ui-ready', attachHangupListener);
}

document.addEventListener('click', () => {
    if (ringbackContext && ringbackContext.state === 'suspended') {
        ringbackContext.resume();
    }
}, { once: false });
