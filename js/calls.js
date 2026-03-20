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

// ==================== EXPONENTIAL BACKOFF RECONNECTION ====================
async function attemptReconnection() {
    if (!CONFIG.currentCallId || !CONFIG.isInCall) {
        console.log('No active call to reconnect');
        return;
    }
    
    if (CONFIG.reconnectionAttempts >= CONFIG.MAX_RECONNECTION_ATTEMPTS) {
        console.log('❌ Max reconnection attempts reached, ending call');
        window.showConnectionStatusMessage('❌ Connection lost, call ended', 'error');
        setTimeout(() => {
            if (window.hangup) window.hangup('reconnection_failed');
        }, 2000);
        return;
    }
    
    const delay = Math.min(
        CONFIG.RECONNECTION_BASE_DELAY * Math.pow(2, CONFIG.reconnectionAttempts),
        CONFIG.RECONNECTION_MAX_DELAY
    );
    
    console.log(`🔄 Reconnection attempt ${CONFIG.reconnectionAttempts + 1}/${CONFIG.MAX_RECONNECTION_ATTEMPTS} in ${delay}ms`);
    window.showConnectionStatusMessage(`🔄 Reconnecting (attempt ${CONFIG.reconnectionAttempts + 1})...`, 'info');
    
    CONFIG.reconnectionTimeout = setTimeout(async () => {
        try {
            // Check if call still exists
            const callDoc = await db.collection('calls').doc(CONFIG.currentCallId).get();
            if (!callDoc.exists) {
                console.log('Call no longer exists, aborting reconnection');
                window.clearConnectionStatusMessage();
                return;
            }
            
            const callData = callDoc.data();
            
            // Try to restore connection
            if (callData.answer && CONFIG.peerConnection) {
                console.log('Attempting to restore peer connection...');
                
                try {
                    // Create new offer with ICE restart
                    const offer = await CONFIG.peerConnection.createOffer({ iceRestart: true });
                    await CONFIG.peerConnection.setLocalDescription(offer);
                    
                    // Update call in Firestore with new offer
                    await db.collection('calls').doc(CONFIG.currentCallId).update({
                        offer: {
                            type: offer.type,
                            sdp: offer.sdp
                        },
                        restartAttempt: (callData.restartAttempt || 0) + 1,
                        lastReconnectAttempt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    
                    console.log('✅ Reconnection offer sent');
                    CONFIG.reconnectionAttempts = 0;
                    window.clearConnectionStatusMessage();
                    
                } catch (peerError) {
                    console.error('Failed to restart ICE:', peerError);
                    CONFIG.reconnectionAttempts++;
                    attemptReconnection();
                }
            } else {
                console.log('No answer available, waiting...');
                CONFIG.reconnectionAttempts++;
                attemptReconnection();
            }
            
        } catch (error) {
            console.error('Reconnection failed:', error);
            CONFIG.reconnectionAttempts++;
            attemptReconnection();
        }
    }, delay);
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
    
    console.log(`📞 Calling ${targetUsername}...`);
    
    try {
        CONFIG.isInCall = true;
        CONFIG.currentCallId = `${CONFIG.myUsername}_${targetUsername}_${Date.now()}`;
        CONFIG.currentCallPartner = targetUsername;
        CONFIG.callStartTime = Date.now();
        CONFIG.callTimeout = null;
        CONFIG.reconnectionAttempts = 0;
        
        // Enable hangup button immediately so user can cancel
        if (window.dom && window.dom.hangupBtn) {
            window.dom.hangupBtn.disabled = false;
            console.log('✅ Hangup button enabled for cancellation');
        }
        
        // Update all buttons - disable all and set the called user to "Calling..."
        updateAllCallButtons(targetUsername, 'calling');
        
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
            
            if (data.status === 'rejected') {
                console.log('❌ Call was rejected');
                stopRingbackTone();
                if (CONFIG.callTimeout) {
                    clearTimeout(CONFIG.callTimeout);
                    CONFIG.callTimeout = null;
                }
                if (window.showStatusModal) {
                    window.showStatusModal('📢 Call Rejected', 'The call was rejected by the recipient', true);
                }
                window.hangup('rejected');
                unsubscribe();
                return;
            }
            
            if (data.answer && CONFIG.peerConnection && !CONFIG.peerConnection.currentRemoteDescription) {
                console.log('📥 Received answer');
                stopRingbackTone();
                
                if (CONFIG.callTimeout) {
                    clearTimeout(CONFIG.callTimeout);
                    CONFIG.callTimeout = null;
                }
                
                updateAllCallButtons(targetUsername, 'incall');
                window.clearConnectionStatusMessage();
                
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
        
        CONFIG.callTimeout = setTimeout(() => {
            if (CONFIG.isInCall && !CONFIG.peerConnection?.currentRemoteDescription) {
                console.log('⏰ Call timeout - no answer received');
                stopRingbackTone();
                if (window.showStatusModal) {
                    window.showStatusModal('⏰ Call Timeout', 'No answer - call timed out', true);
                }
                window.hangup('timeout');
            }
        }, 30000);
        
    } catch (error) {
        console.log(`❌ Call error: ${error.message}`);
        stopRingbackTone();
        CONFIG.isInCall = false;
        CONFIG.currentCallId = null;
        CONFIG.currentCallPartner = null;
        if (CONFIG.callTimeout) {
            clearTimeout(CONFIG.callTimeout);
            CONFIG.callTimeout = null;
        }
        if (window.dom && window.dom.hangupBtn) {
            window.dom.hangupBtn.disabled = true;
        }
        if (window.loadUsers) window.loadUsers();
    }
};

// ==================== ANSWER FUNCTION ====================
window.answerCall = async function(callId, callerId, offer) {
    console.log(`✅ Answering call from ${callerId}`);
    
    try {
        CONFIG.isInCall = true;
        CONFIG.currentCallId = callId;
        CONFIG.currentCallPartner = callerId;
        CONFIG.reconnectionAttempts = 0;
        
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
        
        // Update all buttons - disable all and set the caller to "In call"
        updateAllCallButtons(callerId, 'incall');
        
        // Show success message briefly
        if (window.showStatusModal) {
            window.showStatusModal('✅ Call Connected', 'You are now connected', false);
            setTimeout(() => {
                window.hideStatusModal();
            }, 2000);
        }
        
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

// ==================== UPDATE ALL CALL BUTTONS ====================
function updateAllCallButtons(partnerUsername, state) {
    const buttons = document.querySelectorAll('.call-user-btn');
    
    buttons.forEach(button => {
        // Extract username from the onclick attribute
        const onclickAttr = button.getAttribute('onclick');
        if (!onclickAttr) return;
        
        const match = onclickAttr.match(/'([^']+)'/);
        if (!match) return;
        
        const buttonUsername = match[1];
        
        if (buttonUsername === partnerUsername) {
            // This is the call partner
            button.disabled = true;
            if (state === 'calling') {
                button.textContent = 'Calling...';
            } else if (state === 'incall') {
                button.textContent = 'In call';
            }
        } else {
            // Other users - disabled but with no special text
            button.disabled = true;
        }
    });
}

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

// ==================== CLEANUP OLD CALLS (KEEP ONLY LATEST PER USER) ====================
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
            console.log(`🧹 Call cleanup complete: kept ${keptCount} calls, deleted ${deletedCount} old calls`);
        } else {
            console.log(`📭 No old calls to delete`);
        }
        
    } catch (error) {
        console.log(`❌ Error during call cleanup: ${error.message}`);
    }
};

// ==================== CLEANUP ORPHANED ICE CANDIDATES ====================
window.cleanupOrphanedIceCandidates = async function() {
    if (!CONFIG.myUsername) return;
    
    try {
        console.log('🧹 Cleaning up orphaned ice-candidates...');
        
        // Get all ice-candidates where this user is the sender
        const candidatesSnapshot = await db.collection('ice-candidates')
            .where('fromUserId', '==', CONFIG.myUsername)
            .get();
        
        if (candidatesSnapshot.empty) {
            console.log('📭 No ice-candidates to check');
            return;
        }
        
        console.log(`📊 Found ${candidatesSnapshot.size} total ice-candidates`);
        
        // Collect all unique callIds from these candidates
        const callIds = new Set();
        candidatesSnapshot.forEach(doc => {
            const callId = doc.data().callId;
            if (callId) callIds.add(callId);
        });
        
        if (callIds.size === 0) {
            console.log('⚠️ No callIds found in ice-candidates');
            return;
        }
        
        console.log(`🔍 Checking ${callIds.size} unique callIds against calls collection`);
        
        // Check which callIds still exist in the calls collection
        // Firestore 'in' queries are limited to 10 values at a time
        const callIdArray = Array.from(callIds);
        const existingCallIds = new Set();
        
        // Process in batches of 10
        for (let i = 0; i < callIdArray.length; i += 10) {
            const batch = callIdArray.slice(i, i + 10);
            const callsSnapshot = await db.collection('calls')
                .where('__name__', 'in', batch)
                .get();
            
            callsSnapshot.forEach(doc => {
                existingCallIds.add(doc.id);
            });
        }
        
        console.log(`✅ Found ${existingCallIds.size} calls still existing`);
        
        // Now delete any ice-candidate whose callId is NOT in existingCallIds
        const deleteBatch = db.batch();
        let deletedCount = 0;
        
        candidatesSnapshot.forEach(doc => {
            const callId = doc.data().callId;
            if (!existingCallIds.has(callId)) {
                deleteBatch.delete(doc.ref);
                deletedCount++;
                console.log(`🗑️ Deleting orphaned ice-candidate for call ${callId}`);
            }
        });
        
        if (deletedCount > 0) {
            await deleteBatch.commit();
            console.log(`🧹 Cleanup complete: deleted ${deletedCount} orphaned ice-candidates`);
        } else {
            console.log(`📭 No orphaned ice-candidates to delete`);
        }
        
    } catch (error) {
        console.log(`❌ Error during ice-candidates cleanup: ${error.message}`);
    }
};

// ==================== ONE-TIME HISTORICAL CLEANUP ====================
window.historicalIceCleanup = async function() {
    if (!CONFIG.myUsername) {
        console.log('❌ Please log in first');
        return;
    }
    
    console.log('🧹 ===== STARTING HISTORICAL ICE-CANDIDATES CLEANUP =====');
    console.log('This will delete ALL ice-candidates except those from the most recent call with each user');
    
    try {
        // Get ALL ice-candidates where this user is the sender
        const candidatesSnapshot = await db.collection('ice-candidates')
            .where('fromUserId', '==', CONFIG.myUsername)
            .get();
        
        console.log(`📊 Found ${candidatesSnapshot.size} total historical ice-candidates`);
        
        if (candidatesSnapshot.empty) {
            console.log('📭 No ice-candidates to clean up');
            return;
        }
        
        // Group candidates by the other user
        const candidatesByUser = {};
        const callIdToCandidates = {};
        
        candidatesSnapshot.forEach(doc => {
            const data = doc.data();
            const otherUser = data.toUserId;
            const callId = data.callId;
            
            if (!candidatesByUser[otherUser]) {
                candidatesByUser[otherUser] = [];
            }
            
            // Get timestamp
            let timestamp = 0;
            if (data.timestamp) {
                timestamp = data.timestamp.toMillis?.() || 
                           data.timestamp._seconds * 1000 || 
                           data.timestamp;
            }
            
            const candidateInfo = {
                id: doc.id,
                timestamp: timestamp,
                ref: doc.ref,
                callId: callId
            };
            
            candidatesByUser[otherUser].push(candidateInfo);
            
            if (!callIdToCandidates[callId]) {
                callIdToCandidates[callId] = [];
            }
            callIdToCandidates[callId].push(candidateInfo);
        });
        
        console.log(`👥 Found conversations with: ${Object.keys(candidatesByUser).join(', ')}`);
        
        // For each user, find their most recent call
        const batch = db.batch();
        let deletedCount = 0;
        let keptCount = 0;
        
        for (const otherUser of Object.keys(candidatesByUser)) {
            console.log(`\n🔍 Processing user ${otherUser}:`);
            const userCandidates = candidatesByUser[otherUser];
            
            // Get all calls between current user and this other user
            const callsBetween = await db.collection('calls')
                .where('callerId', 'in', [CONFIG.myUsername, otherUser])
                .where('calleeId', 'in', [CONFIG.myUsername, otherUser])
                .get();
            
            console.log(`   Found ${callsBetween.size} calls with this user`);
            
            if (callsBetween.empty) {
                // No calls exist - delete ALL candidates for this user
                console.log(`   ❌ No calls found - deleting all ${userCandidates.length} candidates`);
                userCandidates.forEach(candidate => {
                    batch.delete(candidate.ref);
                    deletedCount++;
                });
                continue;
            }
            
            // Find the most recent call
            let latestCallId = null;
            let latestTimestamp = 0;
            
            callsBetween.forEach(doc => {
                const callData = doc.data();
                let callTime = 0;
                if (callData.timestamp) {
                    callTime = callData.timestamp.toMillis?.() || 
                               callData.timestamp._seconds * 1000 || 
                               callData.timestamp;
                }
                
                if (callTime > latestTimestamp) {
                    latestTimestamp = callTime;
                    latestCallId = doc.id;
                }
            });
            
            console.log(`   ✅ Most recent call: ${latestCallId}`);
            
            // Keep only candidates from the most recent call
            userCandidates.forEach(candidate => {
                if (candidate.callId === latestCallId) {
                    keptCount++;
                    console.log(`   ✅ Keeping candidate ${candidate.id} from latest call`);
                } else {
                    batch.delete(candidate.ref);
                    deletedCount++;
                    console.log(`   🗑️ Deleting candidate ${candidate.id} from call ${candidate.callId}`);
                }
            });
        }
        
        console.log(`\n📊 Summary: keeping ${keptCount}, deleting ${deletedCount}`);
        
        if (deletedCount > 0) {
            await batch.commit();
            console.log(`✅ Historical cleanup complete: deleted ${deletedCount} old ice-candidates`);
        } else {
            console.log(`📭 No historical ice-candidates to delete`);
        }
        
        // Final count
        const finalSnapshot = await db.collection('ice-candidates')
            .where('fromUserId', '==', CONFIG.myUsername)
            .get();
        console.log(`📊 Final ice-candidate count: ${finalSnapshot.size}`);
        
    } catch (error) {
        console.log(`❌ Error during historical cleanup:`, error);
    }
};

// ==================== HANGUP FUNCTION ====================
window.hangup = async function(reason = 'user_initiated') {
    console.log(`📞 Call ended - reason: ${reason}`);
    
    if (window.stopRingtone) window.stopRingtone();
    stopRingbackTone();
    
    // Stop all monitoring
    if (window.stopAllMonitoring) {
        window.stopAllMonitoring();
    }
    
    if (CONFIG.callTimeout) {
        clearTimeout(CONFIG.callTimeout);
        CONFIG.callTimeout = null;
    }
    
    if (CONFIG.reconnectionTimeout) {
        clearTimeout(CONFIG.reconnectionTimeout);
        CONFIG.reconnectionTimeout = null;
    }
    
    if (CONFIG.currentCallId) {
        try {
            const callDoc = await db.collection('calls').doc(CONFIG.currentCallId).get();
            if (callDoc.exists) {
                const callData = callDoc.data();
                
                if (callData.status === 'ringing') {
                    if (callData.callerId === CONFIG.myUsername) {
                        await db.collection('calls').doc(CONFIG.currentCallId).update({
                            status: 'cancelled',
                            endedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        console.log('📞 Call cancelled by caller');
                    }
                } else {
                    await db.collection('calls').doc(CONFIG.currentCallId).update({
                        status: 'ended',
                        endedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        } catch (err) {
            console.log(`Error updating call status: ${err.message}`);
        }
    }
    
    if (CONFIG.peerConnection) {
        CONFIG.peerConnection.close();
        CONFIG.peerConnection = null;
    }
    
    if (CONFIG.connectionTimeout) {
        clearTimeout(CONFIG.connectionTimeout);
        CONFIG.connectionTimeout = null;
    }
    
    CONFIG.remoteStream = null;
    CONFIG.isInCall = false;
    CONFIG.currentCallId = null;
    CONFIG.currentCallPartner = null;
    CONFIG.iceRestartAttempts = 0;
    CONFIG.reconnectionAttempts = 0;
    
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
        console.log('🧹 Running post-call cleanups...');
        
        // Clean up old calls first (keep only latest per user)
        if (window.cleanupOldCallsKeepLatest) {
            await window.cleanupOldCallsKeepLatest();
        }
        
        // Then clean up orphaned ice-candidates (delete any without a call)
        if (window.cleanupOrphanedIceCandidates) {
            await window.cleanupOrphanedIceCandidates();
        }
    }, 3000);
};

// ==================== AGGRESSIVE ICE-CANDIDATES CLEANUP ====================
window.aggressiveIceCleanup = async function() {
    if (!CONFIG.myUsername) {
        console.log('❌ Please log in first');
        return;
    }
    
    console.log('🧹 ===== STARTING AGGRESSIVE ICE-CANDIDATES CLEANUP =====');
    console.log('This will keep only the 3 most recent ice-candidates per call');
    
    try {
        // Get ALL ice-candidates where this user is the sender
        const candidatesSnapshot = await db.collection('ice-candidates')
            .where('fromUserId', '==', CONFIG.myUsername)
            .get();
        
        console.log(`📊 Found ${candidatesSnapshot.size} total ice-candidates`);
        
        if (candidatesSnapshot.empty) {
            console.log('📭 No ice-candidates to clean up');
            return;
        }
        
        // Group candidates by callId
        const candidatesByCall = {};
        
        candidatesSnapshot.forEach(doc => {
            const data = doc.data();
            const callId = data.callId;
            
            if (!candidatesByCall[callId]) {
                candidatesByCall[callId] = [];
            }
            
            // Get timestamp
            let timestamp = 0;
            if (data.timestamp) {
                timestamp = data.timestamp.toMillis?.() || 
                           data.timestamp._seconds * 1000 || 
                           data.timestamp;
            }
            
            candidatesByCall[callId].push({
                id: doc.id,
                timestamp: timestamp,
                ref: doc.ref,
                data: data
            });
        });
        
        console.log(`📞 Found ${Object.keys(candidatesByCall).length} unique calls with ice-candidates`);
        
        const batch = db.batch();
        let totalDeleted = 0;
        let totalKept = 0;
        
        // For each call, keep only the 3 most recent candidates
        for (const [callId, candidates] of Object.entries(candidatesByCall)) {
            console.log(`\n🔍 Processing call ${callId}:`);
            console.log(`   Found ${candidates.length} ice-candidates`);
            
            // Sort by timestamp (newest first)
            candidates.sort((a, b) => b.timestamp - a.timestamp);
            
            // Keep only the first 3 (most recent)
            const keepCount = Math.min(3, candidates.length);
            
            candidates.forEach((candidate, index) => {
                if (index < keepCount) {
                    totalKept++;
                    console.log(`   ✅ Keeping candidate ${index + 1}/${keepCount}`);
                } else {
                    batch.delete(candidate.ref);
                    totalDeleted++;
                    console.log(`   🗑️ Deleting excess candidate ${index + 1}/${candidates.length}`);
                }
            });
        }
        
        console.log(`\n📊 Summary: keeping ${totalKept}, deleting ${totalDeleted}`);
        
        if (totalDeleted > 0) {
            await batch.commit();
            console.log(`✅ Aggressive cleanup complete: deleted ${totalDeleted} excess ice-candidates`);
        } else {
            console.log(`📭 No excess ice-candidates to delete`);
        }
        
        // Final count
        const finalSnapshot = await db.collection('ice-candidates')
            .where('fromUserId', '==', CONFIG.myUsername)
            .get();
        console.log(`📊 Final ice-candidate count: ${finalSnapshot.size}`);
        
    } catch (error) {
        console.log(`❌ Error during aggressive cleanup:`, error);
    }
};

// ==================== MANUAL CLEANUP FUNCTION ====================
window.cleanupAll = async function() {
    console.log('🧹 Running full manual cleanup...');
    
    if (window.cleanupOldCallsKeepLatest) {
        await window.cleanupOldCallsKeepLatest();
    }
    
    if (window.cleanupOrphanedIceCandidates) {
        await window.cleanupOrphanedIceCandidates();
    }
    
    console.log('✅ Full manual cleanup complete');
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
