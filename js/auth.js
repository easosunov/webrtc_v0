console.log('✅ auth.js loaded');

// Flag to ensure we only initialize once
let authInitialized = false;
let installPromptShown = false;

// Wait for UI to be ready - use the dom object from ui.js
window.addEventListener('ui-ready', function() {
    console.log('UI ready event received in auth.js');
    if (!authInitialized) {
        initAuth();
    }
});

// ==================== KEYPAD HANDLING ====================
let currentCode = '';

function updateDisplay() {
    if (!window.dom || !window.dom.codeDisplay) return;
    window.dom.codeDisplay.textContent = currentCode || '▪'.repeat(6);
    if (window.dom.loginBtn) window.dom.loginBtn.disabled = currentCode.length === 0;
}

function initAuth() {
    // Prevent multiple initializations
    if (authInitialized) {
        console.log('Auth already initialized, skipping...');
        return true;
    }
    
    console.log('Initializing auth with dom:', window.dom);
    
    // Check if dom and login button exist
    if (!window.dom || !window.dom.loginBtn) {
        console.warn('DOM or login button not ready yet, will retry...');
        setTimeout(initAuth, 500);
        return false;
    }

    console.log('Found login button:', window.dom.loginBtn);

    // Remove any existing event listeners by cloning and replacing buttons
    const keypadButtons = document.querySelectorAll('.keypad-btn[data-digit]');
    keypadButtons.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            const digit = e.currentTarget.dataset.digit;
            handleKeypadInput(digit);
        });
    });

    // Replace login button to remove old listeners
    const oldLoginBtn = window.dom.loginBtn;
    const newLoginBtn = oldLoginBtn.cloneNode(true);
    oldLoginBtn.parentNode.replaceChild(newLoginBtn, oldLoginBtn);
    window.dom.loginBtn = newLoginBtn;
    
    window.dom.loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Login button clicked');
        login();
    });

    // Replace logout button if it exists
    if (window.dom.logoutBtn) {
        const oldLogoutBtn = window.dom.logoutBtn;
        const newLogoutBtn = oldLogoutBtn.cloneNode(true);
        oldLogoutBtn.parentNode.replaceChild(newLogoutBtn, oldLogoutBtn);
        window.dom.logoutBtn = newLogoutBtn;
        
        window.dom.logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // Remove old keyboard listener and add new one
    document.removeEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);

    updateDisplay();
    authInitialized = true;
    console.log('✅ Auth initialized successfully');
    return true;
}

// Separate keyboard handler function
function handleKeyDown(event) {
    if (window.dom && window.dom.callScreen && window.dom.callScreen.style.display === 'block') return;
    
    const key = event.key;
    
    if (/^[0-9]$/.test(key)) {
        event.preventDefault();
        handleKeypadInput(key);
    }
    else if (key === 'Backspace' || key === 'Delete') {
        event.preventDefault();
        handleKeypadInput('back');
    }
    else if (key === 'c' || key === 'C') {
        event.preventDefault();
        handleKeypadInput('clear');
    }
    else if (key === 'Enter') {
        event.preventDefault();
        if (window.dom && window.dom.loginBtn && !window.dom.loginBtn.disabled) {
            console.log('Enter key pressed, calling login');
            login();
        }
    }
}

function handleKeypadInput(digit) {
    if (digit === 'clear') {
        currentCode = '';
    } else if (digit === 'back') {
        currentCode = currentCode.slice(0, -1);
    } else {
        if (currentCode.length < 10) {
            currentCode += digit;
        }
    }
    updateDisplay();
}

// ==================== SINGLE ACTIVE DEVICE MANAGEMENT ====================

async function setActiveDevice(username) {
    console.log(`🔧 Setting active device for ${username}`);
    
    // Detect current device type
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(navigator.userAgent);
    const deviceType = isIOS ? 'ios' : (isAndroid ? 'android' : 'desktop');
    
    console.log(`📱 Device type detected: ${deviceType}`);
    
    // Get current user document
    const userRef = db.collection('users').doc(username);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    
    // Prepare updates - CLEAR ALL push tokens first
    const updates = {
        // Clear ALL existing tokens
        fcmToken: firebase.firestore.FieldValue.delete(),
        fcmEnabled: firebase.firestore.FieldValue.delete(),
        barkDeviceKey: firebase.firestore.FieldValue.delete(),
        barkEnabled: firebase.firestore.FieldValue.delete(),
        webPushSubscription: firebase.firestore.FieldValue.delete(),
        webPushEnabled: firebase.firestore.FieldValue.delete(),
        
        // Set active device info
        activeDevice: deviceType,
        activeDeviceLastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Now add back ONLY the token for THIS device type
    if (deviceType === 'ios') {
        // For iOS, we need the Bark key (preserve existing if any)
        if (userData.barkDeviceKey) {
            updates.barkDeviceKey = userData.barkDeviceKey;
            updates.barkEnabled = true;
            console.log('🍎 iOS device - keeping existing Bark key');
        } else {
            console.log('🍎 iOS device - no Bark key found, user will need to set it up');
        }
    } 
    else if (deviceType === 'android') {
        // For Android, create new FCM token
        if (window.messaging) {
            try {
                const token = await window.messaging.getToken({
                    vapidKey: window.VAPID_PUBLIC_KEY
                });
                if (token) {
                    updates.fcmToken = token;
                    updates.fcmEnabled = true;
                    console.log('📱 Android FCM token obtained');
                }
            } catch (err) {
                console.log('FCM token error:', err);
            }
        }
    }
    else {
        // For desktop, create Web Push subscription
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.ready;
                let subscription = await registration.pushManager.getSubscription();
                
                if (!subscription) {
                    const vapidKey = window.VAPID_PUBLIC_KEY;
                    const base64 = vapidKey.replace(/-/g, '+').replace(/_/g, '/');
                    const applicationServerKey = new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
                    
                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: applicationServerKey
                    });
                }
                
                if (subscription) {
                    const subObject = {
                        endpoint: subscription.endpoint,
                        expirationTime: subscription.expirationTime,
                        keys: {
                            p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('p256dh')))),
                            auth: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('auth'))))
                        }
                    };
                    updates.webPushSubscription = subObject;
                    updates.webPushEnabled = true;
                    console.log('💻 Web Push subscription saved');
                }
            } catch (err) {
                console.log('Web Push error:', err);
            }
        }
    }
    
    // Apply the updates
    await userRef.update(updates);
    console.log(`✅ Active device set to: ${deviceType}`);
    
    // Store device type locally for reference
    localStorage.setItem('activeDevice', deviceType);
    
    return deviceType;
}

// ==================== CLEAR OLD ICE-CANDIDATES ON LOGIN ====================
async function clearOldIceCandidates() {
    console.log('🧹 Entering clearOldIceCandidates function');
    
    if (!CONFIG || !CONFIG.myUsername) {
        console.log('⚠️ No username yet, skipping ice-candidates cleanup');
        return;
    }
    
    console.log(`🧹 Clearing old ice-candidates for user: ${CONFIG.myUsername}`);
    
    try {
        console.log('🔍 Querying ice-candidates collection...');
        const snapshot = await db.collection('ice-candidates')
            .where('fromUserId', '==', CONFIG.myUsername)
            .get();
        
        console.log(`📊 Query returned ${snapshot.size} documents`);
        
        if (snapshot.empty) {
            console.log('📭 No old ice-candidates found');
            return;
        }
        
        console.log(`📊 Found ${snapshot.size} old ice-candidates to delete`);
        
        // Delete in batches of 500
        let totalDeleted = 0;
        let batch = db.batch();
        let count = 0;
        
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i++) {
            batch.delete(docs[i].ref);
            count++;
            
            if (count === 500 || i === docs.length - 1) {
                console.log(`💾 Committing batch of ${count} deletions...`);
                await batch.commit();
                totalDeleted += count;
                console.log(`✅ Deleted ${totalDeleted} so far...`);
                batch = db.batch();
                count = 0;
            }
        }
        
        console.log(`✅ Successfully cleared ${totalDeleted} old ice-candidates`);
        
    } catch (error) {
        console.error('❌ ERROR in clearOldIceCandidates:', error);
        console.error('Error details:', error.message);
    }
}

// ==================== INSTALL BUTTON ====================
async function checkAndShowInstallButton() {
    // Only show once per session
    if (installPromptShown) {
        console.log('Install prompt already shown, skipping');
        return;
    }
    
    // Only on Android
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid) {
        console.log('Not Android, skipping install button');
        return;
    }
    
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) {
        console.log('App already installed to home screen');
        return;
    }
    
    console.log('App not installed, showing install button once');
    installPromptShown = true;
    
    const installSection = document.getElementById('install-app-section');
    if (installSection) {
        installSection.style.display = 'block';
    }
}

// ==================== ANDROID FCM TOKEN SETUP ====================
async function setupAndroidFCM() {
    // Only run on Android devices
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid) {
        console.log('📱 Not Android, skipping FCM setup');
        return;
    }
    
    // Check if FCM is available
    if (!window.messaging) {
        console.log('❌ FCM not available on this device');
        return;
    }
    
    try {
        console.log('📱 Android: Setting up FCM notifications...');
        
        // Register root service worker
        let registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
        if (!registration) {
            registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
                scope: '/'
            });
            console.log('✅ Service worker registered');
        }
        
        // Wait for activation
        if (!registration.active) {
            console.log('Waiting for service worker activation...');
            await new Promise((resolve) => {
                registration.addEventListener('activate', () => resolve());
            });
        }
        console.log('✅ Service worker active');
        
        // Tell FCM to use this service worker
        if (window.messaging.useServiceWorker) {
            window.messaging.useServiceWorker(registration);
        }
        
        // Request permission if not already granted
        if (Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('❌ Permission denied');
                return;
            }
        }
        
        // ALWAYS get a fresh token - this ensures app appears in notification settings
        console.log('Getting fresh FCM token...');
        
        // Delete any existing token first to force a fresh one
        try {
            const oldToken = await window.messaging.getToken();
            if (oldToken) {
                console.log('Deleting old token...');
                await window.messaging.deleteToken();
            }
        } catch (e) {
            console.log('No old token to delete');
        }
        
        // Get NEW token
        const token = await window.messaging.getToken({
            vapidKey: window.VAPID_PUBLIC_KEY,
            serviceWorkerRegistration: registration
        });
        
        if (token) {
            // Save to Firestore (always update)
            await db.collection('users').doc(CONFIG.myUsername).update({
                fcmToken: token,
                fcmEnabled: true,
                fcmLastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('✅ FCM token saved/updated:', token.substring(0, 50) + '...');
            
            // Also store that token was fetched this session
            sessionStorage.setItem('fcm_token_fetched', 'true');
        } else {
            console.log('❌ No token received');
        }
        
    } catch (error) {
        console.error('❌ FCM setup error:', error);
    }
}

// ==================== AUTHENTICATION ====================
async function login() {
    console.log('🚨 Login function called!');
    const accessCode = currentCode;
    if (!accessCode) return;
    
    console.log(`🔐 Attempting login with code: ${accessCode}`);
    if (window.dom && window.dom.loginStatus) {
        window.dom.loginStatus.className = 'status-message info';
        window.dom.loginStatus.textContent = 'Logging in...';
    }
    
    try {
        console.log('📡 Querying Firestore for user document...');
        const userRef = db.collection('users').doc(accessCode);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            console.log(`❌ User ${accessCode} not found in database`);
            if (window.dom && window.dom.loginStatus) {
                window.dom.loginStatus.className = 'status-message error';
                window.dom.loginStatus.textContent = 'Invalid access code';
            }
            
            setTimeout(() => {
                currentCode = '';
                updateDisplay();
                if (window.dom && window.dom.loginStatus) window.dom.loginStatus.textContent = '';
            }, 2000);
            
            return;
        }
        
        const userData = userDoc.data();
        console.log('✅ User data retrieved:', userData);
        
        CONFIG.myUsername = accessCode;
        CONFIG.myDisplayName = userData.displayname || userData.displayName || accessCode;
        CONFIG.isAdmin = userData.isadmin || userData.isAdmin || false;
        
        console.log(`✅ Set CONFIG: username=${CONFIG.myUsername}, displayName=${CONFIG.myDisplayName}, isAdmin=${CONFIG.isAdmin}`);
        
        if (window.dom && window.dom.currentUserSpan) {
            window.dom.currentUserSpan.textContent = CONFIG.myDisplayName;
        }
        if (window.dom && window.dom.loginScreen) window.dom.loginScreen.style.display = 'none';
        if (window.dom && window.dom.callScreen) window.dom.callScreen.style.display = 'block';
        if (window.dom && window.dom.loginStatus) window.dom.loginStatus.textContent = '';
        
        console.log('✅ UI updated, showing call screen');
        
        // ===== SET ACTIVE DEVICE - THIS CLEANS UP OLD TOKENS =====
        console.log('🔜 Setting active device and cleaning old tokens...');
        await setActiveDevice(CONFIG.myUsername);
        console.log('✅ Active device set');
        
        // ===== CLEAR OLD ICE-CANDIDATES ON LOGIN =====
        console.log('🔜 About to call clearOldIceCandidates...');
        await clearOldIceCandidates();
        console.log('✅ clearOldIceCandidates completed');
        
        // Initialize other modules with error handling
        try {
            if (window.cleanupStaleCalls) {
                console.log('Calling cleanupStaleCalls...');
                await window.cleanupStaleCalls();
            }
        } catch (e) {
            console.error('Error in cleanupStaleCalls:', e);
        }
        
        try {
            if (window.initMedia) {
                console.log('Calling initMedia...');
                await window.initMedia();
            }
        } catch (e) {
            console.error('Error in initMedia:', e);
        }
        
        try {
            if (window.loadUsers) {
                console.log('Calling loadUsers...');
                await window.loadUsers();
            }
        } catch (e) {
            console.error('Error in loadUsers:', e);
        }
        
        try {
            if (window.listenForIncomingCalls) {
                console.log('Calling listenForIncomingCalls...');
                window.listenForIncomingCalls();
            }
        } catch (e) {
            console.error('Error in listenForIncomingCalls:', e);
        }
        
        console.log('✅ Login complete!');
        
        // ===== SHOW INSTALL BUTTON (ONCE) =====
        await checkAndShowInstallButton();
        
        // ===== DISPATCH LOGIN COMPLETE EVENT =====
        window.dispatchEvent(new CustomEvent('login-complete', { 
            detail: { username: CONFIG.myUsername } 
        }));
        
    } catch (error) {
        console.log(`❌ Login error: ${error.message}`);
        console.error('Full error:', error);
        if (window.dom && window.dom.loginStatus) {
            window.dom.loginStatus.className = 'status-message error';
            window.dom.loginStatus.textContent = 'Login failed. Please try again.';
        }
    }
}

async function logout() {
    console.log('Logout function called');
    try {
        if (window.hangup) await window.hangup();
        
        // Clean up active device on logout
        if (CONFIG.myUsername) {
            try {
                await db.collection('users').doc(CONFIG.myUsername).update({
                    activeDevice: firebase.firestore.FieldValue.delete(),
                    lastLogout: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log('✅ Active device cleared on logout');
            } catch (err) {
                console.log('Logout cleanup error:', err);
            }
        }
        
        if (CONFIG.localStream) {
            CONFIG.localStream.getTracks().forEach(track => track.stop());
            CONFIG.localStream = null;
        }
        
        CONFIG.myUsername = null;
        CONFIG.myDisplayName = null;
        CONFIG.isAdmin = false;
        
        if (window.dom && window.dom.callScreen) window.dom.callScreen.style.display = 'none';
        if (window.dom && window.dom.loginScreen) window.dom.loginScreen.style.display = 'block';
        currentCode = '';
        updateDisplay();
        
        if (window.dom && window.dom.localVideo) window.dom.localVideo.srcObject = null;
        if (window.dom && window.dom.remoteVideo) window.dom.remoteVideo.srcObject = null;
        
        console.log('👋 Logged out');
        
    } catch (error) {
        console.log(`❌ Logout error: ${error.message}`);
    }
}

// Make functions available globally
window.login = login;
window.logout = logout;
window.setActiveDevice = setActiveDevice;
