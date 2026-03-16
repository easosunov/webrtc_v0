console.log('✅ chat.js loaded');

// ==================== CHAT HELPERS ====================
function getChatId(user1, user2) {
    // Sort to ensure same ID regardless of order
    return [user1, user2].sort().join('_');
}

// ==================== DELETE A CHAT ====================
window.deleteChat = async function(chatId) {
    if (!confirm('Are you sure you want to delete this chat? All messages will be permanently deleted.')) {
        return;
    }
    
    try {
        console.log('🗑️ Deleting chat:', chatId);
        
        // First, delete all messages in the subcollection
        const messagesSnapshot = await db.collection('chats').doc(chatId)
            .collection('messages')
            .get();
        
        // Delete messages in batches of 500
        const batch = db.batch();
        let count = 0;
        
        for (const doc of messagesSnapshot.docs) {
            batch.delete(doc.ref);
            count++;
            
            if (count === 500) {
                await batch.commit();
                count = 0;
            }
        }
        
        // Commit final batch if any
        if (count > 0) {
            await batch.commit();
        }
        
        // Finally, delete the chat document itself
        await db.collection('chats').doc(chatId).delete();
        
        console.log('✅ Chat deleted successfully');
        
        // Refresh chats list
        await window.loadChats();
        
        // Close chat view if it was open
        if (document.getElementById('current-chat-id').value === chatId) {
            window.closeChat();
        }
        
    } catch (error) {
        console.error('❌ Error deleting chat:', error);
        alert('Failed to delete chat');
    }
};

// ==================== SHOW USERS FOR NEW CHAT ====================
window.showUsersForChat = function() {
    // Simply show the users panel - users are already there
    document.getElementById('chats-view').style.display = 'block';
    document.getElementById('chat-view').style.display = 'none';
};

// ==================== START NEW CHAT WITH USER ====================
window.startChat = async function(otherUsername) {
    console.log('💬 Starting chat with user:', otherUsername);
    
    if (!CONFIG.myUsername) {
        alert('Please log in first');
        return;
    }
    
    const chatId = getChatId(CONFIG.myUsername, otherUsername);
    console.log('Chat ID:', chatId);
    
    try {
        // Get other user's display name
        const userDoc = await db.collection('users').doc(otherUsername).get();
        const otherDisplayName = userDoc.data()?.displayname || otherUsername;
        
        // Check if chat exists
        const chatDoc = await db.collection('chats').doc(chatId).get();
        
        if (!chatDoc.exists) {
            console.log('Creating new chat...');
            // Create new chat
            await db.collection('chats').doc(chatId).set({
                participants: [CONFIG.myUsername, otherUsername],
                participantNames: {
                    [CONFIG.myUsername]: CONFIG.myDisplayName,
                    [otherUsername]: otherDisplayName
                },
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastMessage: '',
                lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
                unreadCount: {
                    [CONFIG.myUsername]: 0,
                    [otherUsername]: 0
                }
            });
        }
        
        // Open the chat
        openChat(chatId);
        
    } catch (error) {
        console.error('❌ Error starting chat:', error);
        alert('Failed to start chat');
    }
};

// ==================== OPEN CHAT ====================
window.openChat = async function(chatId) {
    console.log('💬 Opening chat:', chatId);
    
    // Show chat view, hide chats list
    document.getElementById('chats-view').style.display = 'none';
    document.getElementById('chat-view').style.display = 'flex';
    
    // Store current chat ID
    document.getElementById('current-chat-id').value = chatId;
    
    try {
        // Load chat details
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (!chatDoc.exists) return;
        
        const chatData = chatDoc.data();
        const otherParticipants = chatData.participants.filter(p => p !== CONFIG.myUsername);
        
        // Set chat header
        const otherNames = otherParticipants.map(id => chatData.participantNames?.[id] || id).join(', ');
        document.getElementById('current-chat-name').textContent = otherNames;
        
        // Mark messages as read
        await markChatAsRead(chatId);
        
        // Load messages
        await loadMessages(chatId);
        
        // Listen for new messages
        listenForMessages(chatId);
        
    } catch (error) {
        console.error('❌ Error opening chat:', error);
    }
};

// ==================== LOAD MESSAGES ====================
async function loadMessages(chatId) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = '<div style="text-align: center; padding: 20px;">Loading messages...</div>';
    
    try {
        const messagesSnapshot = await db.collection('chats').doc(chatId)
            .collection('messages')
            .orderBy('timestamp', 'asc')
            .limit(50)
            .get();
        
        if (messagesSnapshot.empty) {
            messagesContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #666;">
                    <p>No messages yet. Say hello!</p>
                </div>
            `;
            return;
        }
        
        let lastDate = null;
        let lastSender = null;
        let html = '';
        
        messagesSnapshot.forEach(doc => {
            const msg = doc.data();
            const msgDate = msg.timestamp?.toDate() || new Date();
            const dateStr = msgDate.toLocaleDateString();
            
            // Add date separator if new day
            if (dateStr !== lastDate) {
                html += `<div class="message-date-separator">${msgDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>`;
                lastDate = dateStr;
                lastSender = null;
            }
            
            const isMe = msg.senderId === CONFIG.myUsername;
            const showSender = !isMe && msg.senderId !== lastSender;
            
            html += `
                <div class="message ${isMe ? 'message-me' : 'message-other'}">
                    ${showSender ? `<div class="message-sender">${msg.senderName || msg.senderId}</div>` : ''}
                    <div class="message-bubble">
                        <div class="message-text">${msg.text}</div>
                        <div class="message-time">
                            ${msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            ${isMe ? (msg.readBy?.includes(CONFIG.myUsername) ? ' ✓✓' : ' ✓') : ''}
                        </div>
                    </div>
                </div>
            `;
            
            lastSender = msg.senderId;
        });
        
        messagesContainer.innerHTML = html;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
    } catch (error) {
        console.error('❌ Error loading messages:', error);
        messagesContainer.innerHTML = '<div style="color: red; padding: 20px;">Error loading messages</div>';
    }
}

// ==================== SEND MESSAGE ====================
window.sendMessage = async function() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    
    const chatId = document.getElementById('current-chat-id')?.value;
    if (!chatId) {
        alert('No chat selected');
        return;
    }
    
    input.value = '';
    
    try {
        // Get chat to know participants
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (!chatDoc.exists) return;
        
        const chatData = chatDoc.data();
        
        // Add message to subcollection
        await db.collection('chats').doc(chatId)
            .collection('messages')
            .add({
                senderId: CONFIG.myUsername,
                senderName: CONFIG.myDisplayName,
                text: text,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                type: 'text',
                readBy: [CONFIG.myUsername]
            });
        
        // Update chat metadata
        await db.collection('chats').doc(chatId).update({
            lastMessage: text,
            lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
            lastMessageSender: CONFIG.myUsername,
            [`unreadCount.${CONFIG.myUsername}`]: 0,
            // Increment unread for others
            ...Object.fromEntries(
                chatData.participants
                    .filter(p => p !== CONFIG.myUsername)
                    .map(p => [`unreadCount.${p}`, firebase.firestore.FieldValue.increment(1)])
            )
        });
        
    } catch (error) {
        console.error('❌ Error sending message:', error);
        alert('Failed to send message');
    }
};

// ==================== MARK CHAT AS READ ====================
async function markChatAsRead(chatId) {
    try {
        await db.collection('chats').doc(chatId).update({
            [`unreadCount.${CONFIG.myUsername}`]: 0
        });
    } catch (error) {
        console.error('Error marking chat as read:', error);
    }
}

// ==================== LISTEN FOR NEW MESSAGES ====================
function listenForMessages(chatId) {
    db.collection('chats').doc(chatId)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    // Reload messages when new one arrives
                    loadMessages(chatId);
                }
            });
        });
}

// ==================== CLOSE CHAT ====================
window.closeChat = function() {
    document.getElementById('chats-view').style.display = 'block';
    document.getElementById('chat-view').style.display = 'none';
    document.getElementById('current-chat-id').value = '';
};

// ==================== LOAD ALL CHATS ====================
window.loadChats = async function() {
    if (!CONFIG.myUsername) return;
    
    try {
        console.log('📋 Loading chats for user:', CONFIG.myUsername);
        
        const chatsSnapshot = await db.collection('chats')
            .where('participants', 'array-contains', CONFIG.myUsername)
            .orderBy('lastMessageTime', 'desc')
            .get();
        
        const chatsContainer = document.getElementById('chats-container');
        if (!chatsContainer) return;
        
        if (chatsSnapshot.empty) {
            chatsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No chats yet. Click "New Chat" to start one.</div>';
            return;
        }
        
        let html = '';
        chatsSnapshot.forEach(doc => {
            const data = doc.data();
            const otherParticipants = data.participants.filter(p => p !== CONFIG.myUsername);
            const chatName = otherParticipants.map(id => data.participantNames?.[id] || id).join(', ');
            const lastMessageTime = data.lastMessageTime?.toDate() || new Date();
            const timeStr = formatMessageTime(lastMessageTime);
            const unread = data.unreadCount?.[CONFIG.myUsername] || 0;
            
            // Updated HTML with delete button
            html += `
                <div class="chat-item" style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
                    <div onclick="openChat('${doc.id}')" style="display: flex; flex: 1; cursor: pointer;">
                        <div class="chat-avatar">${chatName.substring(0,2).toUpperCase()}</div>
                        <div class="chat-info">
                            <div class="chat-header">
                                <span class="chat-name">${chatName}</span>
                                <span class="chat-time">${timeStr}</span>
                            </div>
                            <div class="chat-preview">
                                <span class="chat-message">${data.lastMessage || 'No messages'}</span>
                                ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <button onclick="deleteChat('${doc.id}'); event.stopPropagation();" 
                            style="background: none; border: none; color: #999; cursor: pointer; padding: 5px 10px; font-size: 16px; border-radius: 50%;"
                            onmouseover="this.style.backgroundColor='#f0f0f0'"
                            onmouseout="this.style.backgroundColor='transparent'"
                            title="Delete chat">
                        🗑️
                    </button>
                </div>
            `;
        });
        
        chatsContainer.innerHTML = html;
        
    } catch (error) {
        console.error('❌ Error loading chats:', error);
    }
};

// ==================== DELETE CURRENT CHAT ====================
window.deleteCurrentChat = async function() {
    const chatId = document.getElementById('current-chat-id').value;
    if (!chatId) {
        alert('No chat selected');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this chat? All messages will be permanently deleted.')) {
        return;
    }
    
    try {
        console.log('🗑️ Deleting current chat:', chatId);
        
        // First, delete all messages in the subcollection
        const messagesSnapshot = await db.collection('chats').doc(chatId)
            .collection('messages')
            .get();
        
        // Delete messages in batches
        const batch = db.batch();
        messagesSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
        // Finally, delete the chat document itself
        await db.collection('chats').doc(chatId).delete();
        
        console.log('✅ Chat deleted successfully');
        
        // Close chat view and refresh list
        window.closeChat();
        await window.loadChats();
        
    } catch (error) {
        console.error('❌ Error deleting chat:', error);
        alert('Failed to delete chat');
    }
};

function formatMessageTime(date) {
    const now = new Date();
    const diff = now - date;
    
    if (diff < 24 * 60 * 60 * 1000) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diff < 7 * 24 * 60 * 60 * 1000) {
        return date.toLocaleDateString([], { weekday: 'short' });
    } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
}

// Load chats when user logs in
const chatOriginalLogin = window.login;
if (chatOriginalLogin) {
    window.login = async function() {
        await chatOriginalLogin.apply(this, arguments);
        await window.loadChats();
    };
}
