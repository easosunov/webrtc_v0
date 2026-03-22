/**
 * Cloud Functions for WebRTC Communicator
 * Sends push notifications using web-push library
 */

const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {onRequest} = require('firebase-functions/v2/https');
const {logger} = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// ==================== VAPID KEYS ====================
// Replace with your actual private key!
const VAPID_PUBLIC_KEY = 'BH33WjtMVo0Y_bml_nke0gtVqahGcPd6m-yjh__LBHp6Ahvfq-vN-m25D2MzMB3e1jbTGwQRGt5ufKEhSyj6Yv0';
const VAPID_PRIVATE_KEY = 'lULaLKgEB47Ab9p8FDr5_NqbusivicVHnDvkdC6TJYA';  // ⚠️ PUT YOUR ACTUAL PRIVATE KEY HERE!

// Configure web-push with VAPID keys
webpush.setVapidDetails(
    'mailto:webrtc@easosunov.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

/**
 * Send push notification when a new call is created
 */
exports.onCallCreated = onDocumentCreated('calls/{callId}', async (event) => {
    const call = event.data.data();
    const callId = event.params.callId;
    
    logger.log(`📞 New call created: ${callId}`);
    logger.log(`   Caller: ${call.callerId}`);
    logger.log(`   Callee: ${call.calleeId}`);
    
    if (call.status !== 'ringing') {
        logger.log(`⚠️ Call status is '${call.status}', not sending push`);
        return null;
    }
    
    if (call.callerId === call.calleeId) {
        logger.log(`⚠️ Caller and callee are the same, skipping push`);
        return null;
    }
    
    try {
        const userDoc = await db.collection('users').doc(call.calleeId).get();
        
        if (!userDoc.exists) {
            logger.log(`❌ User not found: ${call.calleeId}`);
            return null;
        }
        
        const userData = userDoc.data();
        
        if (!userData.pushSubscription) {
            logger.log(`📱 No push subscription for ${call.calleeId}`);
            return null;
        }
        
        const subscription = userData.pushSubscription;
        logger.log(`🔍 Endpoint: ${subscription.endpoint.substring(0, 80)}...`);
        
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists ? 
            (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId) : 
            call.callerId;
        
        const payload = JSON.stringify({
            notification: {
                title: '📞 Incoming Call',
                body: `Call from ${callerName}`,
                icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
                badge: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
                vibrate: [200, 100, 200],
                requireInteraction: true,
                actions: [
                    { action: 'answer', title: 'Answer Call' },
                    { action: 'dismiss', title: 'Dismiss' }
                ]
            },
            data: {
                callId: callId,
                callerId: call.callerId,
                callerName: callerName,
                url: 'https://easosunov.github.io/webrtc_v0/'
            }
        });
        
        logger.log(`📤 Sending push to ${call.calleeId}...`);
        await webpush.sendNotification(subscription, payload);
        logger.log(`✅ Push sent successfully`);
        
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            callerName: callerName,
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
        
        // Remove invalid subscription
        if (error.statusCode === 410 || error.statusCode === 404) {
            logger.log(`🗑️ Removing invalid subscription for ${call.calleeId}`);
            await db.collection('users').doc(call.calleeId).update({
                pushSubscription: admin.firestore.FieldValue.delete()
            });
        }
    }
    
    return null;
});

/**
 * Health check endpoint
 */
exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'webrtc-communicator-push'
    });
});
