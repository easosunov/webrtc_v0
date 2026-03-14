// ==================== MEDIA INITIALIZATION ====================
window.initMedia = async function() {
    try {
        console.log('📹 Requesting camera and microphone access...');
        CONFIG.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });
        
        if (window.dom && window.dom.localVideo) window.dom.localVideo.srcObject = CONFIG.localStream;
        console.log('✅ Media access granted');
        
    } catch (error) {
        console.log(`❌ Media access error: ${error.message}`);
        alert('Could not access camera/microphone. Please check permissions.');
    }
};

// ==================== PEER CONNECTION CREATION ====================
window.createPeerConnection = async function(targetUsername, isCaller = true) {
    console.log(`🔧 Creating peer connection with ${targetUsername} (${isCaller ? 'caller' : 'callee'})`);
    
    CONFIG.targetUsername = targetUsername;
    CONFIG.isCaller = isCaller;
    CONFIG.iceRestartAttempts = 0;
    
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    };
    
    CONFIG.peerConnection = new RTCPeerConnection(config);
    
    if (CONFIG.localStream) {
        CONFIG.localStream.getTracks().forEach(track => {
            CONFIG.peerConnection.addTrack(track, CONFIG.localStream);
        });
    }
    
    CONFIG.remoteStream = new MediaStream();
    if (window.dom && window.dom.remoteVideo) window.dom.remoteVideo.srcObject = CONFIG.remoteStream;
    
    CONFIG.peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
            CONFIG.remoteStream.addTrack(track);
        });
        console.log('✅ Remote stream received');
        if (window.dom && window.dom.hangupBtn) window.dom.hangupBtn.disabled = false;
        clearTimeout(CONFIG.connectionTimeout);
    };
    
    CONFIG.peerConnection.onicecandidate = (event) => {
        if (event.candidate && CONFIG.currentCallId) {
            console.log(`🧊 ICE candidate: ${event.candidate.type || 'unknown'}`);
            db.collection('ice-candidates').add({
                callId: CONFIG.currentCallId,
                fromUserId: CONFIG.myUsername,
                toUserId: targetUsername,
                candidate: event.candidate.toJSON(),
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.log(`❌ Error storing ICE candidate: ${err.message}`));
        }
    };
    
    CONFIG.peerConnection.oniceconnectionstatechange = () => {
        const state = CONFIG.peerConnection.iceConnectionState;
        console.log(`🧊 ICE state: ${state}`);
        
        switch(state) {
            case 'checking':
                CONFIG.connectionTimeout = setTimeout(() => {
                    if (CONFIG.peerConnection?.iceConnectionState === 'checking') {
                        console.log('⏰ ICE checking timeout - attempting restart');
                        restartIce();
                    }
                }, CONFIG.ICE_TIMEOUT);
                break;
                
            case 'connected':
            case 'completed':
                console.log('✅ ICE connection established');
                clearTimeout(CONFIG.connectionTimeout);
                CONFIG.iceRestartAttempts = 0;
                break;
                
            case 'disconnected':
                console.log('⚠️ ICE disconnected - attempting recovery');
                setTimeout(() => {
                    if (CONFIG.peerConnection?.iceConnectionState === 'disconnected') {
                        restartIce();
                    }
                }, 2000);
                break;
                
            case 'failed':
                console.log('❌ ICE failed');
                restartIce();
                break;
        }
    };
    
    CONFIG.peerConnection.onconnectionstatechange = () => {
        const state = CONFIG.peerConnection.connectionState;
        console.log(`🔗 Connection state: ${state}`);
        
        if (state === 'connected') {
            CONFIG.isInCall = true;
            clearTimeout(CONFIG.connectionTimeout);
        } else if (state === 'failed') {
            console.log('❌ Connection failed');
            if (CONFIG.iceRestartAttempts < CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
                restartIce();
            } else {
                alert('Call failed after multiple attempts');
                if (window.hangup) window.hangup('max_restarts_reached');
            }
        }
    };
    
    return CONFIG.peerConnection;
};

async function restartIce() {
    if (CONFIG.iceRestartAttempts >= CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
        console.log('❌ Max ICE restart attempts reached');
        return;
    }
    
    CONFIG.iceRestartAttempts++;
    console.log(`🔄 ICE restart attempt ${CONFIG.iceRestartAttempts}/${CONFIG.MAX_ICE_RESTART_ATTEMPTS}`);
    
    try {
        const offer = await CONFIG.peerConnection.createOffer({ iceRestart: true });
        await CONFIG.peerConnection.setLocalDescription(offer);
        
        await db.collection('calls').doc(CONFIG.currentCallId).update({
            offer: {
                type: offer.type,
                sdp: offer.sdp
            },
            restartAttempt: CONFIG.iceRestartAttempts,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('📤 ICE restart offer sent');
        
    } catch (error) {
        console.log(`❌ ICE restart failed: ${error.message}`);
    }
}
