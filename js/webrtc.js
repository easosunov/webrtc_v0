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

// ==================== RESTART ICE (DEFINED FIRST) ====================
async function restartIce() {
    if (!CONFIG.peerConnection) {
        console.log('❌ No peer connection to restart');
        return;
    }
    
    if (CONFIG.iceRestartAttempts >= CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
        console.log('❌ Max ICE restart attempts reached');
        if (window.showConnectionStatus) {
            window.showConnectionStatus('❌ Cannot recover connection, call may end', 'error');
        }
        return;
    }
    
    CONFIG.iceRestartAttempts++;
    console.log(`🔄 ICE restart attempt ${CONFIG.iceRestartAttempts}/${CONFIG.MAX_ICE_RESTART_ATTEMPTS}`);
    
    try {
        const offer = await CONFIG.peerConnection.createOffer({ iceRestart: true });
        await CONFIG.peerConnection.setLocalDescription(offer);
        
        if (CONFIG.currentCallId) {
            await db.collection('calls').doc(CONFIG.currentCallId).update({
                offer: {
                    type: offer.type,
                    sdp: offer.sdp
                },
                restartAttempt: CONFIG.iceRestartAttempts,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        console.log('📤 ICE restart offer sent');
        
    } catch (error) {
        console.log(`❌ ICE restart failed: ${error.message}`);
    }
}

// ==================== PEER CONNECTION CREATION ====================
window.createPeerConnection = async function(targetUsername, isCaller = true) {
    console.log(`🔧 Creating peer connection with ${targetUsername} (${isCaller ? 'caller' : 'callee'})`);
    
    CONFIG.targetUsername = targetUsername;
    CONFIG.isCaller = isCaller;
    CONFIG.iceRestartAttempts = 0;
    
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
        
        // Clear any reconnection status when stream is received
        if (window.clearConnectionStatus) {
            window.clearConnectionStatus();
        }
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
            
            // Start network monitoring when connected
            startNetworkMonitoring();
        } else if (state === 'failed') {
            console.log('❌ Connection failed');
            if (CONFIG.iceRestartAttempts < CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
                restartIce();
            } else {
                if (window.showStatusModal) {
                    window.showStatusModal('❌ Call Failed', 'Connection failed after multiple attempts', true);
                }
                if (window.hangup) window.hangup('max_restarts_reached');
            }
        }
    };
    
    return CONFIG.peerConnection;
};

// ==================== NETWORK QUALITY MONITORING ====================
let networkMonitorInterval = null;
let qualityReduced = false;
let originalVideoConstraints = null;
let qualityRestoreTimer = null;

function startNetworkMonitoring() {
    // Clear any existing interval
    if (networkMonitorInterval) {
        clearInterval(networkMonitorInterval);
        networkMonitorInterval = null;
    }
    
    networkMonitorInterval = setInterval(async () => {
        if (!CONFIG.peerConnection || !CONFIG.isInCall) {
            if (networkMonitorInterval) {
                clearInterval(networkMonitorInterval);
                networkMonitorInterval = null;
            }
            return;
        }
        
        try {
            const stats = await CONFIG.peerConnection.getStats();
            let packetLoss = 0;
            
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    packetLoss = report.packetsLost || 0;
                }
            });
            
            // Log packet loss occasionally
            if (Math.random() < 0.1) {
                console.log(`📊 Packet loss: ${packetLoss}`);
            }
            
            // Check if packet loss is high
            if (packetLoss > CONFIG.PACKET_LOSS_THRESHOLD && CONFIG.localStream) {
                if (!qualityReduced) {
                    console.warn(`⚠️ High packet loss: ${packetLoss}%`);
                    reduceVideoQuality();
                    qualityReduced = true;
                }
            } 
            // Check if quality should be restored
            else if (packetLoss <= CONFIG.PACKET_LOSS_THRESHOLD && qualityReduced) {
                if (qualityRestoreTimer) {
                    clearTimeout(qualityRestoreTimer);
                }
                
                qualityRestoreTimer = setTimeout(() => {
                    restoreVideoQuality();
                    qualityReduced = false;
                    qualityRestoreTimer = null;
                    console.log('✅ Video quality restored');
                }, 5000);
            }
            
        } catch (error) {
            // Silently fail - stats collection can error occasionally
        }
    }, 5000);
}

// ==================== REDUCE VIDEO QUALITY ====================
async function reduceVideoQuality() {
    if (!CONFIG.localStream) return;
    
    const videoTrack = CONFIG.localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    try {
        // Store original constraints if not already stored
        if (!originalVideoConstraints) {
            const settings = videoTrack.getSettings();
            originalVideoConstraints = {
                width: settings.width || 1280,
                height: settings.height || 720,
                frameRate: settings.frameRate || 30
            };
        }
        
        const constraints = {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15 }
        };
        
        await videoTrack.applyConstraints(constraints);
        console.log('📹 Reduced video quality due to network conditions');
    } catch (error) {
        console.error('Failed to reduce video quality:', error);
    }
}

// ==================== RESTORE VIDEO QUALITY ====================
async function restoreVideoQuality() {
    if (!CONFIG.localStream) return;
    
    const videoTrack = CONFIG.localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    try {
        const constraints = {
            width: { ideal: originalVideoConstraints?.width || 1280 },
            height: { ideal: originalVideoConstraints?.height || 720 },
            frameRate: { ideal: originalVideoConstraints?.frameRate || 30 }
        };
        
        await videoTrack.applyConstraints(constraints);
        console.log('📹 Restored video quality');
    } catch (error) {
        console.error('Failed to restore video quality:', error);
    }
}

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

// ==================== STOP MONITORING ====================
window.stopNetworkMonitoring = function() {
    if (networkMonitorInterval) {
        clearInterval(networkMonitorInterval);
        networkMonitorInterval = null;
    }
    if (qualityRestoreTimer) {
        clearTimeout(qualityRestoreTimer);
        qualityRestoreTimer = null;
    }
    qualityReduced = false;
};

// Make functions available globally
window.stopNetworkMonitoring = window.stopNetworkMonitoring;
