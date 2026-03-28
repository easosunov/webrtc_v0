/**
 * Cloud Functions for WebRTC Communicator
 * Dual Push System: FCM for Android, Web Push for iOS/Windows
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// ==================== VAPID KEYS (for Web Push) ====================
const VAPID_PUBLIC_KEY = 'BH33WjtMVo0Y_bml_nke0gtVqahGcPd6m-yjh__LBHp6Ahvfq-vN-m25D2MzMB3e1jbTGwQRGt5ufKEhSyj6Yv0';
const VAPID_PRIVATE_KEY = 'lULaLKgEB47Ab9p8FDr5_NqbusivicVHnDvkdC6TJYA';  // ⚠️ REPLACE WITH YOUR ACTUAL PRIVATE KEY!

webpush.setVapidDetails(
    'mailto:webrtc@easosunov.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// ==================== PUSH ON CALL ====================
exports.onCallCreated = onDocumentCreated('calls/{callId}', async (event) => {
    const call = event.data.data();
    const callId = event.params.callId;

    logger.log(`📞 New call: ${callId}`);

    if (call.status !== 'ringing') return null;
    if (call.callerId === call.calleeId) return null;

    try {
        const userDoc = await db.collection('users').doc(call.calleeId).get();
        if (!userDoc.exists) {
            logger.log(`❌ User not found: ${call.calleeId}`);
            return null;
        }

        const userData = userDoc.data();
        
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists
            ? (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId)
            : call.callerId;

        let pushSent = false;

        // ========== METHOD 1: FCM (Android) ==========
        if (userData.fcmToken) {
            try {
// In the FCM section, replace the payload with:
const fcmPayload = {
    data: {
        title: '📞 Incoming Call',
        body: `Call from ${callerName}`,
        callId: callId,
        callerId: call.callerId,
        callerName: callerName,
        url: 'https://easosunov.github.io/webrtc_v0/'
    },
    token: userData.fcmToken,
    android: {
        priority: 'high',
        notification: {
            sound: 'default',
            channelId: 'incoming_calls',
            priority: 'high',
            sticky: true
        }
    }
};
                
                await admin.messaging().send(fcmPayload);
                logger.log(`✅ FCM push sent to ${call.calleeId}`);
                pushSent = true;
                
                await db.collection('notifications').add({
                    userId: call.calleeId,
                    callId: callId,
                    method: 'fcm',
                    status: 'sent',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                
            } catch (fcmError) {
                logger.error(`❌ FCM failed: ${fcmError.message}`);
                
                if (fcmError.code === 'messaging/invalid-registration-token') {
                    await db.collection('users').doc(call.calleeId).update({
                        fcmToken: admin.firestore.FieldValue.delete()
                    });
                }
            }
        }

        // ========== METHOD 2: Web Push (iOS, Windows, Desktop) ==========
        if (!pushSent && userData.webPushSubscription) {
            try {
                const webPayload = JSON.stringify({
                    title: '📞 Incoming Call',
                    body: `Call from ${callerName}`,
                    icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
                    callId: callId,
                    callerId: call.callerId,
                    callerName: callerName,
                    url: '/webrtc_v0/'
                });
                
                await webpush.sendNotification(userData.webPushSubscription, webPayload);
                logger.log(`✅ Web Push sent to ${call.calleeId}`);
                pushSent = true;
                
                await db.collection('notifications').add({
                    userId: call.calleeId,
                    callId: callId,
                    method: 'webpush',
                    status: 'sent',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                
            } catch (webError) {
                logger.error(`❌ Web Push failed: ${webError.message}`);
                
                if (webError.statusCode === 410 || webError.statusCode === 404) {
                    await db.collection('users').doc(call.calleeId).update({
                        webPushSubscription: admin.firestore.FieldValue.delete()
                    });
                }
            }
        }

        if (!pushSent) {
            logger.log(`📱 No push method available for ${call.calleeId}`);
            await db.collection('notifications').add({
                userId: call.calleeId,
                callId: callId,
                status: 'no_method',
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }

    } catch (error) {
        logger.error(`❌ Push error:`, error.message);
        
        await db.collection('notifications').add({
            callId: callId,
            error: error.message,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    
    return null;
});

// ==================== HEALTH CHECK ====================
exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({
        status: 'ok',
        time: new Date().toISOString(),
        service: 'webrtc-communicator-push'
    });
});
