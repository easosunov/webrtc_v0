console.log('✅ chat.js loaded');

// ==================== CHAT HELPERS ====================
function getChatId(user1, user2) {
    return [user1, user2].sort().join('_');
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

// ==================== URL DETECTION ====================
function makeLinksClickable(text) {
    if (!text) return text;
    
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;
    
    return text.replace(urlRegex, function(url) {
        let fullUrl = url;
        if (url.startsWith('www')) {
            fullUrl = 'https://' + url;
        }
        
        return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer" 
                style="color: #0066cc; text-decoration: underline;">${url}</a>`;
    });
}

// ==================== SHOW USERS FOR NEW CHAT ====================
window.showUsersForChat = function() {
    document.getElementById('chats-view').style.display = 'block';
    document.getElementById('chat-view').style.display = 'none';
};

// ==================== DELETE CHAT ====================
window.deleteChat = async function(chatId) {
    if (!confirm('Are you sure you want to delete this chat? All messages will be permanently deleted.')) {
        return;
    }
    
    try {
        console.log('🗑️ Deleting chat:', chatId);
        
        const messagesSnapshot = await db.collection('chats').doc(chatId)
            .collection('messages')
            .get();
        
        const batch = db.batch();
        messagesSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
        await db.collection('chats').doc(chatId).delete();
        
        console.log('✅ Chat deleted successfully');
        
        await window.loadChats();
        
        if (document.getElementById('current-chat-id').value === chatId) {
            window.closeChat();
        }
        
    } catch (error) {
        console.error('❌ Error deleting chat:', error);
        alert('Failed to delete chat');
    }
};

// ==================== DELETE CURRENT CHAT ====================
window.deleteCurrentChat = async function() {
    const chatId = document.getElementById('current-chat-id').value;
    if (!chatId) {
        alert('No chat selected');
        return;
    }
    
    if (!confirm('⚠️ Are you sure you want to delete this chat? All messages will be permanently deleted.')) {
        return;
    }
    
    try {
        console.log('🗑️ Deleting current chat:', chatId);
        
        const messagesSnapshot = await db.collection('chats').doc(chatId)
            .collection('messages')
            .get();
        
        for (const doc of messagesSnapshot.docs) {
            await doc.ref.delete();
        }
        
        await db.collection('chats').doc(chatId).delete();
        console.log('✅ Chat deleted successfully');
        
        window.closeChat();
        await window.loadChats();
        
    } catch (error) {
        console.error('❌ Error deleting chat:', error);
        alert('Failed to delete chat: ' + error.message);
    }
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
        const userDoc = await db.collection('users').doc(otherUsername).get();
        const otherDisplayName = userDoc.data()?.displayname || otherUsername;
        
        const chatDoc = await db.collection('chats').doc(chatId).get();
        
        if (!chatDoc.exists) {
            console.log('Creating new chat...');
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
        
        openChat(chatId);
        
    } catch (error) {
        console.error('❌ Error starting chat:', error);
        alert('Failed to start chat');
    }
};

// ==================== OPEN CHAT ====================
window.openChat = async function(chatId) {
    console.log('💬 Opening chat:', chatId);
    
    document.getElementById('chats-view').style.display = 'none';
    document.getElementById('chat-view').style.display = 'flex';
    
    document.getElementById('current-chat-id').value = chatId;
    
    try {
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (!chatDoc.exists) return;
        
        const chatData = chatDoc.data();
        const otherParticipants = chatData.participants.filter(p => p !== CONFIG.myUsername);
        
        const otherNames = otherParticipants.map(id => chatData.participantNames?.[id] || id).join(', ');
        document.getElementById('current-chat-name').textContent = otherNames;
        
        await markChatAsRead(chatId);
        await loadMessages(chatId);
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
            
            if (dateStr !== lastDate) {
                html += `<div class="message-date-separator">${msgDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>`;
                lastDate = dateStr;
                lastSender = null;
            }
            
            // Check if this is a call log message
            if (msg.type === 'call_log') {
                let callIcon = '';
                let callText = '';
                switch(msg.callType) {
                    case 'initiated': callIcon = '📞'; callText = 'Call initiated'; break;
                    case 'answered': callIcon = '✅'; callText = 'Call connected'; break;
                    case 'ended': 
                        callIcon = '⏱️'; 
                        callText = `Call ended (${formatDuration(msg.duration)})`;
                        break;
                    case 'rejected': callIcon = '❌'; callText = 'Call rejected'; break;
                    case 'missed': callIcon = '🔴'; callText = 'Missed call'; break;
                    case 'cancelled': callIcon = '📞'; callText = 'Call cancelled'; break;
                    default: callIcon = '📞'; callText = 'Call'; break;
                }
                
                html += `
                    <div class="message call-log-message">
                        <div class="call-log-bubble">
                            <span class="call-log-icon">${callIcon}</span>
                            <span class="call-log-text">${callText}</span>
                            <span class="call-log-time">${msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                `;
                lastSender = null;
                return;
            }
            
            // Regular text message
            const isMe = msg.senderId === CONFIG.myUsername;
            const showSender = !isMe && msg.senderId !== lastSender;
            
            html += `
                <div class="message ${isMe ? 'message-me' : 'message-other'}">
                    ${showSender ? `<div class="message-sender">${msg.senderName || msg.senderId}</div>` : ''}
                    <div class="message-bubble">
                        <div class="message-text">${makeLinksClickable(msg.text)}</div>
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
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (!chatDoc.exists) return;
        
        const chatData = chatDoc.data();
        
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
        
        await db.collection('chats').doc(chatId).update({
            lastMessage: text,
            lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
            lastMessageSender: CONFIG.myUsername,
            [`unreadCount.${CONFIG.myUsername}`]: 0,
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
            
            // Check if last message is a call log
            let lastMessageDisplay = data.lastMessage || 'No messages';
            if (lastMessageDisplay.includes('📞') || lastMessageDisplay.includes('✅') || 
                lastMessageDisplay.includes('⏱️') || lastMessageDisplay.includes('❌') || 
                lastMessageDisplay.includes('🔴')) {
                lastMessageDisplay = `<span style="opacity: 0.7;">${lastMessageDisplay}</span>`;
            }
            
            html += `
                <div class="chat-item" style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
                    <div onclick="openChat('${doc.id}')" style="display: flex; flex: 1; cursor: pointer;">
                        <div class="chat-avatar">${chatName.substring(0,2).toUpperCase()}</div>
                        <div class="chat-info">
                            <div class="chat-header">
                                <span class="chat-name">${escapeHtml(chatName)}</span>
                                <span class="chat-time">${timeStr}</span>
                            </div>
                            <div class="chat-preview">
                                <span class="chat-message">${lastMessageDisplay}</span>
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Load chats when user logs in
const chatOriginalLogin = window.login;
if (chatOriginalLogin) {
    window.login = async function() {
        await chatOriginalLogin.apply(this, arguments);
        await window.loadChats();
    };
}
