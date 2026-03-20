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
    CONFIG.reconnectionAttempts = 0;
    CONFIG.currentQualityReduced = false;  // Track if quality was reduced
    
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
                if (window.clearConnectionStatus) {
                    window.clearConnectionStatus();
                }
                clearTimeout(CONFIG.connectionTimeout);
                CONFIG.iceRestartAttempts = 0;
                CONFIG.reconnectionAttempts = 0;
                break;
                
            case 'disconnected':
                console.log('⚠️ ICE disconnected - attempting recovery');
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('⚠️ Connection lost, reconnecting...', 'info');
                }
                setTimeout(() => {
                    if (CONFIG.peerConnection?.iceConnectionState === 'disconnected') {
                        restartIce();
                    }
                }, 2000);
                break;
                
            case 'failed':
                console.log('❌ ICE failed');
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
            if (window.clearConnectionStatus) {
                window.clearConnectionStatus();
            }
            
            // Start enhanced monitoring when connected
            startICEMonitoring();
            startNetworkMonitoring();
        } else if (state === 'failed') {
            console.log('❌ Connection failed');
            if (CONFIG.iceRestartAttempts < CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('🔄 Reconnecting...', 'info');
                }
                restartIce();
            } else {
                if (window.showConnectionStatus) {
                    window.showConnectionStatus('❌ Call failed - connection lost', 'error');
                }
                if (window.hangup) window.hangup('max_restarts_reached');
            }
        } else if (state === 'disconnected') {
            if (window.showConnectionStatus) {
                window.showConnectionStatus('⚠️ Connection interrupted, reconnecting...', 'info');
            }
        }
    };
    
    return CONFIG.peerConnection;
};

// ==================== ICE MONITORING ====================
function startICEMonitoring() {
    // Clear any existing interval
    if (CONFIG.iceMonitorInterval) {
        clearInterval(CONFIG.iceMonitorInterval);
        CONFIG.iceMonitorInterval = null;
    }
    
    CONFIG.iceMonitorInterval = setInterval(() => {
        if (!CONFIG.peerConnection || !CONFIG.isInCall) {
            if (CONFIG.iceMonitorInterval) {
                clearInterval(CONFIG.iceMonitorInterval);
                CONFIG.iceMonitorInterval = null;
            }
            return;
        }
        
        const iceState = CONFIG.peerConnection.iceConnectionState;
        const connectionState = CONFIG.peerConnection.connectionState;
        
        // Log state every 10th check to reduce noise
        if (Math.random() < 0.1) {
            console.log(`📊 ICE Monitor: ${iceState}, Connection: ${connectionState}`);
        }
        
        // If we're in a call but connection seems dead, attempt recovery
        if ((iceState === 'failed' || iceState === 'disconnected') && 
            CONFIG.isInCall && 
            CONFIG.iceRestartAttempts < CONFIG.MAX_ICE_RESTART_ATTEMPTS) {
            console.warn(`⚠️ ICE Monitor detected ${iceState}, attempting recovery...`);
            if (window.showConnectionStatus) {
                window.showConnectionStatus('🔄 Connection unstable, reconnecting...', 'info');
            }
            restartIce();
        }
    }, CONFIG.ICE_MONITOR_INTERVAL);
}

// ==================== NETWORK QUALITY MONITORING ====================
let lastPacketLoss = 0;
let qualityRestoreTimer = null;

function startNetworkMonitoring() {
    // Clear any existing interval
    if (CONFIG.networkMonitorInterval) {
        clearInterval(CONFIG.networkMonitorInterval);
        CONFIG.networkMonitorInterval = null;
    }
    
    CONFIG.networkMonitorInterval = setInterval(async () => {
        if (!CONFIG.peerConnection || !CONFIG.isInCall) {
            if (CONFIG.networkMonitorInterval) {
                clearInterval(CONFIG.networkMonitorInterval);
                CONFIG.networkMonitorInterval = null;
            }
            return;
        }
        
        try {
            const stats = await CONFIG.peerConnection.getStats();
            let packetLoss = 0;
            let currentBitrate = 0;
            
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    packetLoss = report.packetsLost || 0;
                }
                if (report.type === 'candidate-pair' && report.nominated === true) {
                    currentBitrate = report.bytesReceived / 1000;
                }
            });
            
            // Log network quality periodically
            if (Math.random() < 0.05) {
                console.log(`📊 Network: packet loss=${packetLoss}, bitrate=${currentBitrate}KB/s`);
            }
            
            // Check if packet loss is high
            if (packetLoss > CONFIG.PACKET_LOSS_THRESHOLD && CONFIG.localStream) {
                if (!CONFIG.qualityReduced) {
                    console.warn(`⚠️ High packet loss: ${packetLoss}%`);
                    if (window.showConnectionStatus) {
                        window.showConnectionStatus('⚠️ Poor connection quality, reducing video...', 'info');
                    }
                    reduceVideoQuality();
                    CONFIG.qualityReduced = true;
                    
                    // Clear the status message after 3 seconds
                    setTimeout(() => {
                        if (window.clearConnectionStatus && CONFIG.qualityReduced === true) {
                            // Don't clear if we're still having issues
                            if (packetLoss <= CONFIG.PACKET_LOSS_THRESHOLD) {
                                window.clearConnectionStatus();
                            }
                        }
                    }, 3000);
                }
            } 
            // Check if quality should be restored
            else if (packetLoss <= CONFIG.PACKET_LOSS_THRESHOLD && CONFIG.qualityReduced) {
                // Clear any pending restore timer
                if (qualityRestoreTimer) {
                    clearTimeout(qualityRestoreTimer);
                }
                
                // Wait 5 seconds of good connection before restoring
                qualityRestoreTimer = setTimeout(() => {
                    restoreVideoQuality();
                    CONFIG.qualityReduced = false;
                    qualityRestoreTimer = null;
                    
                    if (window.showConnectionStatus) {
                        window.showConnectionStatus('✅ Connection quality restored', 'success');
                    }
                }, 5000);
            }
            
            lastPacketLoss = packetLoss;
            
        } catch (error) {
            console.error('Failed to get network stats:', error);
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
        if (!CONFIG.originalVideoConstraints) {
            const settings = videoTrack.getSettings();
            CONFIG.originalVideoConstraints = {
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
        // Restore original quality
        const constraints = {
            width: { ideal: CONFIG.originalVideoConstraints?.width || 1280 },
            height: { ideal: CONFIG.originalVideoConstraints?.height || 720 },
            frameRate: { ideal: CONFIG.originalVideoConstraints?.frameRate || 30 }
        };
        
        await videoTrack.applyConstraints(constraints);
        console.log('📹 Restored video quality - network conditions improved');
    } catch (error) {
        console.error('Failed to restore video quality:', error);
    }
}

// ==================== CAMERA SWITCHING ====================
let currentFacingMode = 'user'; // 'user' = front camera, 'environment' = rear camera
let hasMultipleCameras = false;

// Initialize camera detection
window.initCameraDetection = async function() {
    try {
        console.log('📷 Detecting available cameras...');
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        hasMultipleCameras = videoDevices.length > 1;
        console.log(`📷 Found ${videoDevices.length} camera(s):`, 
            videoDevices.map(d => d.label || 'Unnamed').join(', '));
        
        // Update UI if camera switch button exists
        updateCameraButtonVisibility();
        
        return videoDevices;
    } catch (error) {
        console.error('❌ Failed to detect cameras:', error);
        return [];
    }
};

// Update camera button visibility
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

// Switch between front and rear camera
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
    
    // Toggle facing mode
    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    try {
        // Get current video track settings to preserve resolution
        const videoTrack = CONFIG.localStream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        
        // Stop all tracks in current stream
        CONFIG.localStream.getTracks().forEach(track => track.stop());
        
        // Request new stream with desired camera
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
        
        // Update CONFIG with new stream
        CONFIG.localStream = newStream;
        
        // Update video element
        if (window.dom && window.dom.localVideo) {
            window.dom.localVideo.srcObject = newStream;
        }
        
        // If in a call, replace tracks in peer connection
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
        
        // Show feedback
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
        
        // Try to recover original stream
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

// ==================== STOP ALL MONITORING ====================
window.stopAllMonitoring = function() {
    console.log('🛑 Stopping all connection monitoring');
    
    if (CONFIG.iceMonitorInterval) {
        clearInterval(CONFIG.iceMonitorInterval);
        CONFIG.iceMonitorInterval = null;
    }
    
    if (CONFIG.networkMonitorInterval) {
        clearInterval(CONFIG.networkMonitorInterval);
        CONFIG.networkMonitorInterval = null;
    }
    
    if (CONFIG.reconnectionTimeout) {
        clearTimeout(CONFIG.reconnectionTimeout);
        CONFIG.reconnectionTimeout = null;
    }
    
    if (qualityRestoreTimer) {
        clearTimeout(qualityRestoreTimer);
        qualityRestoreTimer = null;
    }
    
    if (window.clearConnectionStatus) {
        window.clearConnectionStatus();
    }
    
    CONFIG.reconnectionAttempts = 0;
    CONFIG.iceRestartAttempts = 0;
    CONFIG.qualityReduced = false;
};

// Make functions available globally
window.stopAllMonitoring = stopAllMonitoring;

// ==================== CONFIG ADDITIONS ====================
// Add to CONFIG if not already present
if (typeof CONFIG.qualityReduced === 'undefined') {
    CONFIG.qualityReduced = false;
}
if (typeof CONFIG.originalVideoConstraints === 'undefined') {
    CONFIG.originalVideoConstraints = null;
}
