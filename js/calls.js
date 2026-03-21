console.log('✅ calls.js loaded');

// ==================== HELPER FUNCTIONS ====================
function getChatId(user1, user2) {
    return [user1, user2].sort().join('_');
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Track whether call log has been added for current call
let callLogAdded = false;

async function addCallLogEntry(otherUserId, callerId, wasAnswered, duration, wasRejected = false) {
    if (!CONFIG.myUsername || !otherUserId) {
        console.log('❌ Cannot add call log: missing username or otherUserId');
        return;
    }
    
    const chatId = getChatId(CONFIG.myUsername, otherUserId);
    const isCaller = (callerId === CONFIG.myUsername);
    
    // Get the other user's display name
    let otherName = otherUserId;
    try {
        const userDoc = await db.collection('users').doc(otherUserId).get();
        otherName = userDoc.data()?.displayname || otherUserId;
    } catch (e) {
        console.log('Could not get display name');
    }
    
    // Build the message based on outcome - ONE message per call
    let messageText = '';
    
    if (wasRejected) {
        if (isCaller) {
            messageText = `📞 You called ${otherName} → ❌ Rejected`;
        } else {
            messageText = `📞 Call from ${otherName} → ❌ Rejected`;
        }
    } else if (wasAnswered) {
        if (isCaller) {
            messageText = `📞 You called ${otherName} → ✅ Connected (${formatDuration(duration)})`;
        } else {
            messageText = `📞 Call from ${otherName} → ✅ Connected (${formatDuration(duration)})`;
        }
    } else {
        // Missed call
        if (isCaller) {
            messageText = `📞 You called ${otherName} → 🔴 Missed`;
        } else {
            messageText = `📞 Call from ${otherName} → 🔴 Missed`;
        }
    }
    
    const logData = {
        type: 'call_log',
        text: messageText,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        duration: duration,
        callerId: callerId,
        wasAnswered: wasAnswered,
        wasRejected: wasRejected,
        senderId: CONFIG.myUsername,
        senderName: CONFIG.myDisplayName
    };
    
    try {
        const chatRef = db.collection('chats').doc(chatId);
        
        const chatDoc = await chatRef.get();
        if (!chatDoc.exists) {
            const userDoc = await db.collection('users').doc(otherUserId).get();
            const otherDisplayName = userDoc.data()?.displayname || otherUserId;
            
            await chatRef.set({
                participants: [CONFIG.myUsername, otherUserId],
                participantNames: {
                    [CONFIG.myUsername]: CONFIG.myDisplayName,
                    [otherUserId]: otherDisplayName
                },
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastMessage: messageText,
                lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
                lastMessageSender: CONFIG.myUsername,
                unreadCount: {
                    [CONFIG.myUsername]: 0,
                    [otherUserId]: 0
                }
            });
        } else {
            await chatRef.update({
                lastMessage: messageText,
                lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
                lastMessageSender: CONFIG.myUsername,
                [`unreadCount.${otherUserId}`]: firebase.firestore.FieldValue.increment(1)
            });
        }
        
        const messagesRef = chatRef.collection('messages');
        await messagesRef.add(logData);
        
        console.log(`✅ Call log added: ${messageText}`);
        
    } catch (error) {
        console.error('❌ Error adding call log:', error);
    }
}

// ==================== RINGBACK TONE FUNCTIONS ====================
let ringbackContext = null;
let ringbackGain = null;
let ringbackOscillator = null;
let ringbackInterval = null;

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
        CONFIG.currentCallPartner = targetUsername;
        CONFIG.callStartTime = Date.now();
        CONFIG.callTimeout = null;
        CONFIG.callWasAnswered = false;
        CONFIG.callWasRejected = false;
        callLogAdded = false; // Reset flag for new call
        
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
        
        // Keep listener active throughout the call
        let callListener = db.collection('calls').doc(CONFIG.currentCallId).onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            
            const data = snapshot.data();
            
            // Check if call was rejected
            if (data.status === 'rejected') {
                console.log('❌ Call was rejected');
                stopRingbackTone();
                if (CONFIG.callTimeout) {
                    clearTimeout(CONFIG.callTimeout);
                    CONFIG.callTimeout = null;
                }
                CONFIG.callWasRejected = true;
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('📞 Call rejected', 'info');
                }
                if (window.showStatusModal) {
                    window.showStatusModal('📢 Call Rejected', 'The call was rejected by the recipient', true);
                }
                callListener();
                window.hangup('rejected');
                return;
            }
            
            // Check if call was ended/cancelled by the other user
            if (data.status === 'ended' || data.status === 'cancelled') {
                console.log(`📞 Call was ${data.status} by the other user`);
                if (window.showConnectionStatus) {
                    window.showConnectionStatus(`📞 Call ended by other user`, 'info');
                }
                callListener();
                setTimeout(() => {
                    window.hangup('remote_ended');
                }, 1000);
                return;
            }
            
            // Check for answer
            if (data.answer && CONFIG.peerConnection && !CONFIG.peerConnection.currentRemoteDescription) {
                console.log('📥 Received answer');
                stopRingbackTone();
                
                if (CONFIG.callTimeout) {
                    clearTimeout(CONFIG.callTimeout);
                    CONFIG.callTimeout = null;
                }
                
                CONFIG.callWasAnswered = true;
                
                updateAllCallButtons(targetUsername, 'incall');
                
                CONFIG.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
                    .catch(err => console.log(`❌ Error setting remote description: ${err.message}`));
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
        CONFIG.callStartTime = Date.now();
        CONFIG.callWasAnswered = true;
        CONFIG.callWasRejected = false;
        callLogAdded = false; // Reset flag for new call
        
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
        
        updateAllCallButtons(callerId, 'incall');
        
        if (window.showStatusModal) {
            window.showStatusModal('✅ Call Connected', 'You are now connected', false);
            setTimeout(() => {
                window.hideStatusModal();
            }, 2000);
        }
        
        const callListener = db.collection('calls').doc(callId).onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            const data = snapshot.data();
            
            if (data.status === 'ended' || data.status === 'cancelled') {
                console.log(`📞 Call was ${data.status} by the caller`);
                if (window.showConnectionStatus) {
                    window.showConnectionStatus(`📞 Call ended by other user`, 'info');
                }
                callListener();
                setTimeout(() => {
                    window.hangup('remote_ended');
                }, 1000);
            }
        });
        
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
        const onclickAttr = button.getAttribute('onclick');
        if (!onclickAttr) return;
        
        const match = onclickAttr.match(/'([^']+)'/);
        if (!match) return;
        
        const buttonUsername = match[1];
        
        if (buttonUsername === partnerUsername) {
            button.disabled = true;
            if (state === 'calling') {
                button.textContent = 'Calling...';
            } else if (state === 'incall') {
                button.textContent = 'In call';
            }
        } else {
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
        
        const candidatesSnapshot = await db.collection('ice-candidates')
            .where('fromUserId', '==', CONFIG.myUsername)
            .get();
        
        if (candidatesSnapshot.empty) {
            console.log('📭 No ice-candidates to check');
            return;
        }
        
        console.log(`📊 Found ${candidatesSnapshot.size} total ice-candidates`);
        
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
        
        const callIdArray = Array.from(callIds);
        const existingCallIds = new Set();
        
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

// ==================== HANGUP FUNCTION ====================
window.hangup = async function(reason = 'user_initiated') {
    console.log(`📞 Call ended - reason: ${reason}`);
    
    if (window.stopRingtone) window.stopRingtone();
    stopRingbackTone();
    
    if (window.clearConnectionStatus) {
        window.clearConnectionStatus();
    }
    
    if (CONFIG.callTimeout) {
        clearTimeout(CONFIG.callTimeout);
        CONFIG.callTimeout = null;
    }
    
    // Add call log at the end of the call - ONLY ONCE
    if (CONFIG.currentCallId && CONFIG.currentCallPartner && !callLogAdded) {
        callLogAdded = true;
        
        const duration = CONFIG.callStartTime ? Math.floor((Date.now() - CONFIG.callStartTime) / 1000) : null;
        const callerId = CONFIG.currentCallId.split('_')[0];
        
        // Determine outcome
        if (reason === 'rejected') {
            await addCallLogEntry(CONFIG.currentCallPartner, callerId, false, null, true);
        } else if (reason === 'timeout' || (reason === 'remote_ended' && !CONFIG.callWasAnswered)) {
            await addCallLogEntry(CONFIG.currentCallPartner, callerId, false, null, false);
        } else if (reason === 'remote_ended' && CONFIG.callWasAnswered) {
            await addCallLogEntry(CONFIG.currentCallPartner, callerId, true, duration, false);
        } else if (reason === 'user_initiated' && CONFIG.callWasAnswered) {
            await addCallLogEntry(CONFIG.currentCallPartner, callerId, true, duration, false);
        } else if (reason === 'user_initiated' && !CONFIG.callWasAnswered && !CONFIG.callWasRejected) {
            await addCallLogEntry(CONFIG.currentCallPartner, callerId, false, null, false);
        }
        
        try {
            const callDoc = await db.collection('calls').doc(CONFIG.currentCallId).get();
            if (callDoc.exists) {
                const callData = callDoc.data();
                
                if (callData.status === 'ringing' || callData.status === 'answered') {
                    if (callData.callerId === CONFIG.myUsername) {
                        await db.collection('calls').doc(CONFIG.currentCallId).update({
                            status: 'cancelled',
                            endedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        console.log('📞 Call cancelled by caller');
                    } else {
                        await db.collection('calls').doc(CONFIG.currentCallId).update({
                            status: 'ended',
                            endedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        console.log('📞 Call ended by callee');
                    }
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
    CONFIG.callStartTime = null;
    CONFIG.callWasAnswered = false;
    CONFIG.callWasRejected = false;
    
    // Reset the flag after call is fully cleaned up
    setTimeout(() => {
        callLogAdded = false;
    }, 1000);
    
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
        
        if (window.cleanupOldCallsKeepLatest) {
            await window.cleanupOldCallsKeepLatest();
        }
        
        if (window.cleanupOrphanedIceCandidates) {
            await window.cleanupOrphanedIceCandidates();
        }
    }, 3000);
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
