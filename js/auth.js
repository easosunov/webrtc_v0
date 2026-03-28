console.log('✅ auth.js loaded');

// Flag to ensure we only initialize once
let authInitialized = false;

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
        // Check if user already has a token
        const userDoc = await db.collection('users').doc(CONFIG.myUsername).get();
        if (userDoc.data()?.fcmToken) {
            console.log('✅ User already has FCM token');
            return;
        }
        
        console.log('📱 Android: Setting up FCM notifications...');
        
        // Register root service worker (for FCM)
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
            scope: '/'
        });
        console.log('✅ FCM service worker registered at:', registration.scope);
        
        // Tell FCM to use this service worker
        if (window.messaging.useServiceWorker) {
            window.messaging.useServiceWorker(registration);
        }
        
        // Request notification permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('❌ Notification permission denied');
            return;
        }
        
        // Get FCM token
        const token = await window.messaging.getToken({
            vapidKey: window.VAPID_PUBLIC_KEY
        });
        
        if (token) {
            // Save to Firestore
            await db.collection('users').doc(CONFIG.myUsername).update({
                fcmToken: token,
                fcmEnabled: true,
                fcmLastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('✅ FCM token saved for Android');
        } else {
            console.log('❌ No FCM token received');
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
        
        // ===== ANDROID FCM TOKEN SETUP =====
        await setupAndroidFCM();
        
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
