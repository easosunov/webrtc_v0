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
        if (!userDoc.exists) {
            logger.log(`❌ User ${call.calleeId} not found`);
            return null;
        }
        
        const userData = userDoc.data();
        const subscription = userData.pushSubscription;
        
        if (!subscription) {
            logger.log(`📱 No push subscription for ${call.calleeId}`);
            return null;
        }
        
        // Debug: Log subscription details
        logger.log(`🔍 Subscription found for ${call.calleeId}`);
        logger.log(`🔍 Endpoint: ${subscription.endpoint.substring(0, 60)}...`);
        logger.log(`🔍 Keys present: ${!!subscription.keys}`);
        
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists ? 
            (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId) : 
            call.callerId;
        
        // Use the subscription directly
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
            token: subscription.endpoint
        };
        
        logger.log(`📤 Sending push to ${call.calleeId}...`);
        const response = await admin.messaging().send(payload);
        logger.log(`✅ Push sent successfully: ${response}`);
        
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'sent',
            response: response
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
            logger.log(`🗑️ Removing invalid token for ${call.calleeId}`);
            await db.collection('users').doc(call.calleeId).update({
                pushSubscription: admin.firestore.FieldValue.delete()
            });
        }
    }
    
    return null;
});
