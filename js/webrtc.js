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
        
        if (window.dom && window.dom.localVideo) {
            window.dom.localVideo.srcObject = CONFIG.localStream;
        }
        
        // Initialize camera detection after stream is obtained
        await window.initCameraDetection();
        
        console.log('✅ Media access granted');
        
    } catch (error) {
        console.log(`❌ Media access error: ${error.message}`);
        alert('Could not access camera/microphone. Please check permissions.');
    }
};

// ==================== LOAD TURN SERVERS FROM TWILIO ====================
window.loadTurnServers = async function() {
    try {
        console.log('🔄 Loading TURN servers from Twilio...');
        const response = await fetch('https://turn-token.easosunov.workers.dev/ice');
        if (!response.ok) {
            throw new Error(`Failed to load TURN servers: ${response.status}`);
        }
        const data = await response.json();
        console.log('✅ TURN servers loaded:', data.iceServers.length);
        return data.iceServers;
    } catch (error) {
        console.log(`❌ Failed to load TURN servers: ${error.message}`);
        // Fallback to STUN only
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }
};

// ==================== PEER CONNECTION CREATION ====================
window.createPeerConnection = async function(targetUsername, isCaller = true) {
    console.log(`🔧 Creating peer connection with ${targetUsername} (${isCaller ? 'caller' : 'callee'})`);
    
    CONFIG.targetUsername = targetUsername;
    CONFIG.isCaller = isCaller;
    CONFIG.iceRestartAttempts = 0;
    
    // Show connecting status when call starts
    if (window.showConnectionStatus) {
        window.showConnectionStatus('🔄 Connecting...', 'info');
    }
    
    // Load TURN servers
    const turnServers = await window.loadTurnServers();
    
    const config = {
        iceServers: turnServers,
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
        // Do NOT clear status - keep showing current connection state
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
                // Show connecting message
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('🔄 Connecting...', 'info');
                }
                CONFIG.connectionTimeout = setTimeout(() => {
                    if (CONFIG.peerConnection?.iceConnectionState === 'checking') {
                        console.log('⏰ ICE checking timeout - attempting restart');
                        if (window.showConnectionStatus) {
                            window.showConnectionStatus('🔄 Connection slow, retrying...', 'info');
                        }
                        restartIce();
                    }
                }, CONFIG.ICE_TIMEOUT);
                break;
                
            case 'connected':
            case 'completed':
                console.log('✅ ICE connection established');
                // Show connected status - stays visible during call
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('✅ Connected', 'success');
                }
                clearTimeout(CONFIG.connectionTimeout);
                CONFIG.iceRestartAttempts = 0;
                break;
                
            case 'disconnected':
                console.log('⚠️ ICE disconnected - attempting recovery');
                // Show lost connection message
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('⚠️ Connection lost, reconnecting...', 'warning');
                }
                setTimeout(() => {
                    if (CONFIG.peerConnection?.iceConnectionState === 'disconnected') {
                        restartIce();
                    }
                }, 2000);
                break;
                
            case 'failed':
                console.log('❌ ICE failed');
                // Show failed message
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('❌ Connection failed, reconnecting...', 'error');
                }
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
            // Ensure status shows connected
            if (window.showConnectionStatus) {
                window.showConnectionStatus('✅ Connected', 'success');
            }
        } else if (state === 'failed') {
            console.log('❌ Connection failed');
            if (CONFIG.iceRestartAttempts < CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('🔄 Reconnecting...', 'info');
                }
                restartIce();
            } else {
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('❌ Call ended - connection lost', 'error');
                }
                if (window.showStatusModal) {
                    window.showStatusModal('❌ Call Failed', 'Connection failed after multiple attempts', true);
                }
                if (window.hangup) window.hangup('max_restarts_reached');
            }
        } else if (state === 'disconnected') {
            // Show disconnected message
            if (window.showConnectionStatus) {
                window.showConnectionStatus('⚠️ Connection lost, reconnecting...', 'warning');
            }
        } else if (state === 'closed') {
            // Call was ended - show ended message
            if (window.showConnectionStatus) {
                window.showConnectionStatus('📞 Call ended', 'info');
            }
        }
    };
    
    return CONFIG.peerConnection;
};

// ==================== AUDIO-ONLY MODE (BOTH WAYS) ====================

// Kill video in both directions
window.killVideoBothWays = async function() {
    console.log('🎥 Killing video both ways - entering audio-only mode');
    
    // 1. Stop sending local video
    if (CONFIG.localStream) {
        const videoTracks = CONFIG.localStream.getVideoTracks();
        videoTracks.forEach(track => {
            track.enabled = false;
            console.log('📹 Local video track disabled');
        });
    }
    
    // 2. Stop receiving remote video
    if (CONFIG.peerConnection) {
        const receivers = CONFIG.peerConnection.getReceivers();
        receivers.forEach(receiver => {
            if (receiver.track && receiver.track.kind === 'video') {
                receiver.track.enabled = false;
                console.log('📺 Remote video reception disabled');
            }
        });
    }
    
    // 3. Notify peer via signaling (so they also stop sending)
    if (CONFIG.currentCallId && CONFIG.currentCallPartner) {
        await notifyPeerVideoKill();
    }
    
    // 4. Update UI to show audio-only mode
    if (window.showConnectionStatus) {
        window.showConnectionStatus('🔇 Audio-only mode - video disabled', 'warning');
    }
    
    // Store state
    CONFIG.isAudioOnlyMode = true;
};

// Restore video in both directions
window.restoreVideoBothWays = async function() {
    console.log('🎥 Restoring video both ways - exiting audio-only mode');
    
    // 1. Restore sending local video
    if (CONFIG.localStream) {
        const videoTracks = CONFIG.localStream.getVideoTracks();
        if (videoTracks.length > 0) {
            videoTracks.forEach(track => {
                track.enabled = true;
                console.log('📹 Local video track re-enabled');
            });
        } else {
            // No video track exists - need to add one
            await addVideoTrackToLocalStream();
        }
    } else {
        // No local stream - need to reinitialize
        await window.initMedia();
    }
    
    // 2. Restore receiving remote video
    if (CONFIG.peerConnection) {
        const receivers = CONFIG.peerConnection.getReceivers();
        receivers.forEach(receiver => {
            if (receiver.track && receiver.track.kind === 'video') {
                receiver.track.enabled = true;
                console.log('📺 Remote video reception re-enabled');
            }
        });
    }
    
    // 3. Notify peer via signaling to restore their video
    if (CONFIG.currentCallId && CONFIG.currentCallPartner) {
        await notifyPeerVideoRestore();
    }
    
    // 4. Update UI
    if (window.showConnectionStatus) {
        window.showConnectionStatus('🎥 Video restored - full quality', 'success');
        setTimeout(() => window.clearConnectionStatus(), 3000);
    }
    
    // Store state
    CONFIG.isAudioOnlyMode = false;
};

// Add video track to existing local stream
async function addVideoTrackToLocalStream() {
    try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = videoStream.getVideoTracks()[0];
        
        if (CONFIG.localStream) {
            CONFIG.localStream.addTrack(videoTrack);
        } else {
            CONFIG.localStream = videoStream;
        }
        
        // Update local video element
        if (window.dom && window.dom.localVideo) {
            window.dom.localVideo.srcObject = CONFIG.localStream;
        }
        
        // Add track to peer connection if in call
        if (CONFIG.peerConnection && CONFIG.isInCall) {
            CONFIG.peerConnection.addTrack(videoTrack, CONFIG.localStream);
            
            // Need to renegotiate
            const offer = await CONFIG.peerConnection.createOffer();
            await CONFIG.peerConnection.setLocalDescription(offer);
            
            if (CONFIG.currentCallId) {
                await db.collection('calls').doc(CONFIG.currentCallId).update({
                    offer: {
                        type: offer.type,
                        sdp: offer.sdp
                    },
                    renegotiation: true
                });
            }
        }
        
        console.log('✅ Video track added to local stream');
    } catch (error) {
        console.error('❌ Failed to add video track:', error);
    }
}

// Notify peer to kill their video
async function notifyPeerVideoKill() {
    if (!CONFIG.currentCallPartner || !CONFIG.currentCallId) return;
    
    try {
        // Store video-kill signal in Firestore
        await db.collection('calls').doc(CONFIG.currentCallId).update({
            videoKillRequested: true,
            videoKillTimestamp: firebase.firestore.FieldValue.serverTimestamp(),
            videoKillFrom: CONFIG.myUsername
        });
        
        console.log('📡 Video kill signal sent to peer');
    } catch (error) {
        console.error('❌ Failed to send video kill signal:', error);
    }
}

// Notify peer to restore video
async function notifyPeerVideoRestore() {
    if (!CONFIG.currentCallPartner || !CONFIG.currentCallId) return;
    
    try {
        await db.collection('calls').doc(CONFIG.currentCallId).update({
            videoKillRequested: false,
            videoRestoreTimestamp: firebase.firestore.FieldValue.serverTimestamp(),
            videoRestoreFrom: CONFIG.myUsername
        });
        
        console.log('📡 Video restore signal sent to peer');
    } catch (error) {
        console.error('❌ Failed to send video restore signal:', error);
    }
}

// Listen for video kill/restore signals from peer
window.listenForVideoControlSignals = function() {
    if (!CONFIG.myUsername) return;
    
    // Listen for video kill signals during active call
    const callId = CONFIG.currentCallId;
    if (!callId) return;
    
    db.collection('calls').doc(callId).onSnapshot((snapshot) => {
        if (!snapshot.exists) return;
        const data = snapshot.data();
        
        // Check if peer requested video kill
        if (data.videoKillRequested === true && 
            data.videoKillFrom !== CONFIG.myUsername &&
            !CONFIG.isAudioOnlyMode) {
            
            console.log('📡 Peer requested audio-only mode');
            
            // Kill video but don't send signal back (avoid loop)
            if (CONFIG.localStream) {
                CONFIG.localStream.getVideoTracks().forEach(track => {
                    track.enabled = false;
                });
            }
            if (CONFIG.peerConnection) {
                CONFIG.peerConnection.getReceivers().forEach(receiver => {
                    if (receiver.track && receiver.track.kind === 'video') {
                        receiver.track.enabled = false;
                    }
                });
            }
            
            CONFIG.isAudioOnlyMode = true;
            
            // Update UI feedback
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.style.opacity = '0.7';
                localVideo.style.border = '2px solid #ff9800';
            }
            
            if (window.showConnectionStatus) {
                window.showConnectionStatus('🔇 Peer switched to audio-only mode', 'warning');
            }
        }
        
        // Check if peer requested video restore
        if (data.videoKillRequested === false && 
            data.videoRestoreFrom !== CONFIG.myUsername &&
            CONFIG.isAudioOnlyMode) {
            
            console.log('📡 Peer requested video restore');
            
            // Restore video but don't send signal back
            if (CONFIG.localStream) {
                CONFIG.localStream.getVideoTracks().forEach(track => {
                    track.enabled = true;
                });
            }
            if (CONFIG.peerConnection) {
                CONFIG.peerConnection.getReceivers().forEach(receiver => {
                    if (receiver.track && receiver.track.kind === 'video') {
                        receiver.track.enabled = true;
                    }
                });
            }
            
            CONFIG.isAudioOnlyMode = false;
            
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.style.opacity = '1';
                localVideo.style.border = 'none';
            }
            
            if (window.showConnectionStatus) {
                window.showConnectionStatus('🎥 Video restored by peer', 'success');
                setTimeout(() => window.clearConnectionStatus(), 3000);
            }
        }
    });
};


// ==================== CAMERA SWITCHING ====================
let currentFacingMode = 'user';
let hasMultipleCameras = false;

window.initCameraDetection = async function() {
    try {
        console.log('📷 Detecting available cameras...');
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        hasMultipleCameras = videoDevices.length > 1;
        console.log(`📷 Found ${videoDevices.length} camera(s):`, 
            videoDevices.map(d => d.label || 'Unnamed').join(', '));
        
        updateCameraButtonVisibility();
        
        return videoDevices;
    } catch (error) {
        console.error('❌ Failed to detect cameras:', error);
        return [];
    }
};

function updateCameraButtonVisibility() {
    const switchBtn = document.getElementById('switch-camera-btn');
    if (switchBtn) {
        if (hasMultipleCameras) {
            switchBtn.style.display = 'block';
            switchBtn.disabled = false;
        } else {
            switchBtn.style.display = 'none';
        }
    }
}

window.switchCamera = async function() {
    if (!hasMultipleCameras) {
        alert('No alternate camera available');
        return false;
    }
    
    if (!CONFIG.localStream) {
        alert('No active camera stream');
        return false;
    }
    
    console.log('🔄 Switching camera from', currentFacingMode);
    
    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    try {
        const videoTrack = CONFIG.localStream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        
        CONFIG.localStream.getTracks().forEach(track => track.stop());
        
        const constraints = {
            audio: true,
            video: {
                facingMode: newFacingMode,
                width: settings.width ? { ideal: settings.width } : { ideal: 1280 },
                height: settings.height ? { ideal: settings.height } : { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        };
        
        console.log('📷 Requesting camera with facingMode:', newFacingMode);
        
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        CONFIG.localStream = newStream;
        
        if (window.dom && window.dom.localVideo) {
            window.dom.localVideo.srcObject = newStream;
        }
        
        if (CONFIG.peerConnection && CONFIG.isInCall) {
            console.log('🔄 Updating peer connection with new camera');
            
            const senders = CONFIG.peerConnection.getSenders();
            const videoSender = senders.find(sender => 
                sender.track && sender.track.kind === 'video'
            );
            
            if (videoSender) {
                const newVideoTrack = newStream.getVideoTracks()[0];
                await videoSender.replaceTrack(newVideoTrack);
                console.log('✅ Video track replaced in peer connection');
            }
            
            const audioSender = senders.find(sender => 
                sender.track && sender.track.kind === 'audio'
            );
            
            if (audioSender) {
                const newAudioTrack = newStream.getAudioTracks()[0];
                await audioSender.replaceTrack(newAudioTrack);
            }
        }
        
        currentFacingMode = newFacingMode;
        console.log('✅ Camera switched to', currentFacingMode === 'user' ? 'front' : 'rear');
        
        if (window.showStatusModal) {
            window.showStatusModal(
                '📷 Camera Switched',
                `Now using ${currentFacingMode === 'user' ? 'front' : 'rear'} camera`,
                false
            );
            setTimeout(() => window.hideStatusModal(), 1500);
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ Failed to switch camera:', error);
        
        try {
            console.log('Attempting to recover original camera...');
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { facingMode: currentFacingMode }
            });
            CONFIG.localStream = fallbackStream;
            if (window.dom && window.dom.localVideo) {
                window.dom.localVideo.srcObject = fallbackStream;
            }
        } catch (fallbackError) {
            console.error('Recovery failed:', fallbackError);
        }
        
        alert('Failed to switch camera. Please check permissions.');
        return false;
    }
};

async function restartIce() {
    if (CONFIG.iceRestartAttempts >= CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
        console.log('❌ Max ICE restart attempts reached');
        if (window.showConnectionStatus) {
            window.showConnectionStatus('❌ Cannot recover connection, call may end', 'error');
        }
        return;
    }
    
    CONFIG.iceRestartAttempts++;
    console.log(`🔄 ICE restart attempt ${CONFIG.iceRestartAttempts}/${CONFIG.MAX_ICE_RESTART_ATTEMPTS}`);
    
    // Show restart attempt status
    if (window.showConnectionStatus) {
        window.showConnectionStatus(`⚠️ Reconnecting (attempt ${CONFIG.iceRestartAttempts}/${CONFIG.MAX_ICE_RESTART_ATTEMPTS})...`, 'warning');
    }
    
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
        if (window.showConnectionStatus) {
            window.showConnectionStatus(`❌ Reconnection attempt ${CONFIG.iceRestartAttempts} failed`, 'error');
        }
    }
}
