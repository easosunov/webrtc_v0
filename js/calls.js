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
        console.log('📢 Showing connecting status');
        window.showConnectionStatus('🔄 Connecting...', 'info');
    } else {
        console.log('❌ window.showConnectionStatus not found');
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
                console.log('📢 ICE checking - showing connecting status');
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
                console.log('📢 ICE connected - showing connected status');
                // Show connected status - stays visible during call
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('✅ Connected', 'success');
                } else {
                    console.log('❌ window.showConnectionStatus not found in ICE connected');
                }
                clearTimeout(CONFIG.connectionTimeout);
                CONFIG.iceRestartAttempts = 0;
                break;
                
            case 'disconnected':
                console.log('⚠️ ICE disconnected - attempting recovery');
                console.log('📢 ICE disconnected - showing lost connection');
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
                console.log('📢 ICE failed - showing failure');
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
            console.log('📢 Connection state connected - ensuring status');
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
        }
    };
    
    return CONFIG.peerConnection;
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
        console.log(`📢 Showing reconnect attempt ${CONFIG.iceRestartAttempts}`);
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
