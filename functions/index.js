const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {logger} = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// Get FCM legacy server key from environment
// You'll need to add this in Firebase Console -> Project Settings -> Cloud Messaging
// Look for "Server key" under Cloud Messaging API (Legacy)

exports.onCallCreated = onDocumentCreated('calls/{callId}', async (event) => {
    const call = event.data.data();
    const callId = event.params.callId;
    
    logger.log(`📞 New call created: ${callId}`);
    logger.log(`   Caller: ${call.callerId}`);
    logger.log(`   Callee: ${call.calleeId}`);
    
    if (call.status !== 'ringing') return null;
    if (call.callerId === call.calleeId) return null;
    
    try {
        const userDoc = await db.collection('users').doc(call.calleeId).get();
        if (!userDoc.exists || !userDoc.data().pushSubscription) {
            logger.log(`📱 No push subscription for ${call.calleeId}`);
            return null;
        }
        
        const subscription = userDoc.data().pushSubscription;
        logger.log(`🔍 Endpoint: ${subscription.endpoint.substring(0, 80)}...`);
        
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists ? 
            (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId) : 
            call.callerId;
        
        // Try using the legacy FCM API
        const fcmUrl = 'https://fcm.googleapis.com/fcm/send';
        const serverKey = 'YOUR_LEGACY_SERVER_KEY'; // Get this from Firebase Console
        
        const payload = {
            to: subscription.endpoint.split('/send/')[1]?.split(':')[0] || subscription.endpoint,
            priority: 'high',
            notification: {
                title: '📞 Incoming Call',
                body: `Call from ${callerName}`,
                icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
                click_action: 'https://easosunov.github.io/webrtc_v0/'
            },
            data: {
                callId: callId,
                callerId: call.callerId,
                callerName: callerName,
                url: 'https://easosunov.github.io/webrtc_v0/'
            }
        };
        
        const response = await axios.post(fcmUrl, payload, {
            headers: {
                'Authorization': `key=${serverKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        logger.log(`✅ Push sent via legacy API: ${response.data}`);
        
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'sent'
        });
        
    } catch (error) {
        logger.error(`❌ Error:`, error.message);
        
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'failed',
            error: error.message
        });
    }
    
    return null;
});
