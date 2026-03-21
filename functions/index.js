const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {onRequest} = require('firebase-functions/v2/https');
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
    }
    
    return null;
});

exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
