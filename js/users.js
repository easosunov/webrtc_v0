console.log('✅ users.js loaded');

// ==================== LOAD USERS ====================
window.loadUsers = async function() {
    try {
        console.log('📋 Loading users from Firestore...');
        const usersSnapshot = await db.collection('users').get();
        const users = [];
        
        console.log(`📊 Total users in database: ${usersSnapshot.size}`);
        
        usersSnapshot.forEach(doc => {
            console.log(`🔍 Found user: ${doc.id}`);
            if (doc.id !== CONFIG.myUsername) {
                const userData = doc.data();
                console.log(`✅ Adding user ${doc.id} to list`);
                users.push({
                    username: doc.id,
                    displayName: userData.displayName || doc.id,
                    isAdmin: userData.isAdmin || false
                });
            } else {
                console.log(`⏭️ Skipping self: ${doc.id}`);
            }
        });
        
        console.log(`📋 Users found (excluding self): ${users.length}`);
        renderUsersList(users);
        
    } catch (error) {
        console.log(`❌ Error loading users: ${error.message}`);
    }
};

function renderUsersList(users) {
    if (!window.dom || !window.dom.usersContainer) {
        console.error('usersContainer not found in dom');
        return;
    }
    
    if (users.length === 0) {
        window.dom.usersContainer.innerHTML = '<div class="user-item">No other users available</div>';
        return;
    }
    
    let html = '';
    users.forEach(user => {
        const isCallActive = CONFIG.currentCallId && CONFIG.isInCall;
        const isThisUserBeingCalled = CONFIG.currentCallId?.includes(user.username);
        
        let buttonText = 'Call';
        let disabled = !CONFIG.localStream || (isCallActive && !isThisUserBeingCalled);
        
        if (isThisUserBeingCalled) {
            buttonText = 'Calling...';
            disabled = true;
        }
        
        html += `
            <div class="user-item">
                <div class="user-info-left">
                    <span class="user-name">${user.displayName} ${user.isAdmin ? '👑' : ''}</span>
                </div>
                <button class="call-user-btn" 
                        onclick="window.callUser('${user.username}')"
                        ${disabled ? 'disabled' : ''}>
                    ${buttonText}
                </button>
            </div>
        `;
    });
    window.dom.usersContainer.innerHTML = html;
}

window.debugUsers = async function() {
    console.log('=== DEBUG USERS ===');
    const snapshot = await db.collection('users').get();
    snapshot.forEach(doc => {
        console.log('User:', doc.id, doc.data());
    });
};
