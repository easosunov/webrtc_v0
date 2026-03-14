// ==================== KEYPAD HANDLING ====================
let currentCode = '';

function updateDisplay() {
    dom.codeDisplay.textContent = currentCode || '▪'.repeat(6);
    dom.loginBtn.disabled = currentCode.length === 0;
}

document.querySelectorAll('.keypad-btn[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => {
        const digit = btn.dataset.digit;
        handleKeypadInput(digit);
    });
});

document.addEventListener('keydown', (event) => {
    if (dom.callScreen.style.display === 'block') return;
    
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
        if (!dom.loginBtn.disabled) {
            login();
        }
    }
});

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
    dom.loginStatus.className = 'status-message info';
    dom.loginStatus.textContent = 'Logging in...';
    
    try {
        const userRef = db.collection('users').doc(accessCode);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            log(`❌ User ${accessCode} not found in database`);
            dom.loginStatus.className = 'status-message error';
            dom.loginStatus.textContent = 'Invalid access code';
            
            setTimeout(() => {
                currentCode = '';
                updateDisplay();
                dom.loginStatus.textContent = '';
            }, 2000);
            
            return;
        }
        
        const userData = userDoc.data();
        
        CONFIG.myUsername = accessCode;
        CONFIG.myDisplayName = userData.displayName || accessCode;
        CONFIG.isAdmin = userData.isAdmin || false;
        
        dom.currentUserSpan.textContent = CONFIG.myDisplayName;
        dom.loginScreen.style.display = 'none';
        dom.callScreen.style.display = 'block';
        dom.loginStatus.textContent = '';
        
        log(`✅ Logged in as ${CONFIG.myDisplayName} (${accessCode})`);
        
        await cleanupStaleCalls();
        await window.initMedia();
        await window.loadUsers();
        window.listenForIncomingCalls();
        
    } catch (error) {
        log(`❌ Login error: ${error.message}`);
        dom.loginStatus.className = 'status-message error';
        dom.loginStatus.textContent = 'Login failed. Please try again.';
    }
}

async function logout() {
    try {
        await window.hangup();
        
        if (CONFIG.localStream) {
            CONFIG.localStream.getTracks().forEach(track => track.stop());
            CONFIG.localStream = null;
        }
        
        CONFIG.myUsername = null;
        CONFIG.myDisplayName = null;
        CONFIG.isAdmin = false;
        
        dom.callScreen.style.display = 'none';
        dom.loginScreen.style.display = 'block';
        currentCode = '';
        updateDisplay();
        
        dom.localVideo.srcObject = null;
        dom.remoteVideo.srcObject = null;
        
        log('👋 Logged out');
        
    } catch (error) {
        log(`❌ Logout error: ${error.message}`);
    }
}

dom.loginBtn.addEventListener('click', login);
dom.logoutBtn.addEventListener('click', logout);

// Initialize
updateDisplay();
