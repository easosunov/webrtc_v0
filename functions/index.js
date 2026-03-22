const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {logger} = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

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
        
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists ? 
            (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId) : 
            call.callerId;
        
        const subscription = userDoc.data().pushSubscription;
        
        // CORRECTED PAYLOAD - icon/badge/vibrate go INSIDE webpush, NOT in notification
        const payload = {
            notification: {
                title: '📞 Incoming Call',
                body: `Call from ${callerName}`
            },
            data: {
                callId: callId,
                callerId: call.callerId,
                callerName: callerName
            },
            token: subscription.endpoint,
            webpush: {
                notification: {
                    icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
                    badge: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
                    vibrate: [200, 100, 200],
                    requireInteraction: true,
                    actions: [
                        { action: 'answer', title: 'Answer Call' },
                        { action: 'dismiss', title: 'Dismiss' }
                    ]
                }
            }
        };
        
        const response = await admin.messaging().send(payload);
        logger.log(`✅ Push sent: ${response}`);
        
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
        
        if (error.code === 'messaging/invalid-registration-token') {
            await db.collection('users').doc(call.calleeId).update({
                pushSubscription: admin.firestore.FieldValue.delete()
            });
        }
    }
    
    return null;
});
