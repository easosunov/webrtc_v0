// Wait for UI to be ready
window.addEventListener('ui-ready', function() {
    console.log('UI ready, initializing auth...');
    initAuth();
});

// ==================== KEYPAD HANDLING ====================
let currentCode = '';

function updateDisplay() {
    if (!dom.codeDisplay) return;
    dom.codeDisplay.textContent = currentCode || '▪'.repeat(6);
    if (dom.loginBtn) dom.loginBtn.disabled = currentCode.length === 0;
}

function initAuth() {
    if (!dom.loginBtn) {
        console.error('Login button not found');
        return false;
    }

    // Keypad buttons
    document.querySelectorAll('.keypad-btn[data-digit]').forEach(btn => {
        btn.addEventListener('click', () => {
            const digit = btn.dataset.digit;
            handleKeypadInput(digit);
        });
    });

    // Keyboard support
    document.addEventListener('keydown', (event) => {
        if (dom.callScreen && dom.callScreen.style.display === 'block') return;
        
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
            if (dom.loginBtn && !dom.loginBtn.disabled) {
                login();
            }
        }
    });

    dom.loginBtn.addEventListener('click', login);
    dom.logoutBtn.addEventListener('click', logout);

    updateDisplay();
    console.log('✅ Auth initialized');
    return true;
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

// ==================== AUTHENTICATION ====================
async function login() {
    const accessCode = currentCode;
    if (!accessCode) return;
    
    log(`🔐 Attempting login with code: ${accessCode}`);
    if (dom.loginStatus) {
        dom.loginStatus.className = 'status-message info';
        dom.loginStatus.textContent = 'Logging in...';
    }
    
    try {
        const userRef = db.collection('users').doc(accessCode);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            log(`❌ User ${accessCode} not found in database`);
            if (dom.loginStatus) {
                dom.loginStatus.className = 'status-message error';
                dom.loginStatus.textContent = 'Invalid access code';
            }
            
            setTimeout(() => {
                currentCode = '';
                updateDisplay();
                if (dom.loginStatus) dom.loginStatus.textContent = '';
            }, 2000);
            
            return;
        }
        
        const userData = userDoc.data();
        
        CONFIG.myUsername = accessCode;
        CONFIG.myDisplayName = userData.displayName || accessCode;
        CONFIG.isAdmin = userData.isAdmin || false;
        
        if (dom.currentUserSpan) dom.currentUserSpan.textContent = CONFIG.myDisplayName;
        if (dom.loginScreen) dom.loginScreen.style.display = 'none';
        if (dom.callScreen) dom.callScreen.style.display = 'block';
        if (dom.loginStatus) dom.loginStatus.textContent = '';
        
        log(`✅ Logged in as ${CONFIG.myDisplayName} (${accessCode})`);
        
        // Initialize other modules
        if (window.cleanupStaleCalls) await window.cleanupStaleCalls();
        if (window.initMedia) await window.initMedia();
        if (window.loadUsers) await window.loadUsers();
        if (window.listenForIncomingCalls) window.listenForIncomingCalls();
        
    } catch (error) {
        log(`❌ Login error: ${error.message}`);
        if (dom.loginStatus) {
            dom.loginStatus.className = 'status-message error';
            dom.loginStatus.textContent = 'Login failed. Please try again.';
        }
    }
}

async function logout() {
    try {
        if (window.hangup) await window.hangup();
        
        if (CONFIG.localStream) {
            CONFIG.localStream.getTracks().forEach(track => track.stop());
            CONFIG.localStream = null;
        }
        
        CONFIG.myUsername = null;
        CONFIG.myDisplayName = null;
        CONFIG.isAdmin = false;
        
        if (dom.callScreen) dom.callScreen.style.display = 'none';
        if (dom.loginScreen) dom.loginScreen.style.display = 'block';
        currentCode = '';
        updateDisplay();
        
        if (dom.localVideo) dom.localVideo.srcObject = null;
        if (dom.remoteVideo) dom.remoteVideo.srcObject = null;
        
        log('👋 Logged out');
        
    } catch (error) {
        log(`❌ Logout error: ${error.message}`);
    }
}

// Make functions available globally
window.login = login;
window.logout = logout;
