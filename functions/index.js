/**
 * Cloud Functions for WebRTC Communicator
 * Dual Push System: FCM for Android, Web Push for iOS/Windows
 * Android: Repeated pushes every 3 seconds to simulate ringing
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// VAPID Keys (for Web Push) - REPLACE WITH YOUR ACTUAL PRIVATE KEY
const VAPID_PUBLIC_KEY = 'BH33WjtMVo0Y_bml_nke0gtVqahGcPd6m-yjh__LBHp6Ahvfq-vN-m25D2MzMB3e1jbTGwQRGt5ufKEhSyj6Yv0';
const VAPID_PRIVATE_KEY = 'lULaLKgEB47Ab9p8FDr5_NqbusivicVHnDvkdC6TJYA';  // ⚠️ REPLACE THIS!

webpush.setVapidDetails(
    'mailto:webrtc@easosunov.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// Store active call intervals to avoid duplicates
const activeCalls = new Map();

async function sendAndroidPush(userId, callerName, callId, callerId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return false;
    
    const userData = userDoc.data();
    if (!userData.fcmToken) return false;
    
    const payload = {
        data: {
            title: '📞 Incoming Call',
            body: `Call from ${callerName}`,
            callId: callId,
            callerId: callerId,
            callerName: callerName,
            url: 'https://easosunov.github.io/webrtc_v0/',
            timestamp: Date.now().toString()
        },
        token: userData.fcmToken,
        android: {
            priority: 'high',
            ttl: 30 * 1000,
            notification: {
                channelId: 'incoming_calls',
                priority: 'high',
                defaultSound: true,
                defaultVibrateTimings: true,
                sticky: true
            }
        }
    };
    
    try {
        await admin.messaging().send(payload);
        logger.log(`📱 Android push sent to ${userId}`);
        return true;
    } catch (error) {
        logger.error(`❌ Android push failed: ${error.message}`);
        return false;
    }
}

// Send repeated pushes for ringing calls (Android only)
async function startRinging(userId, callerName, callId, callerId) {
    // Clear any existing interval for this call
    if (activeCalls.has(callId)) {
        clearInterval(activeCalls.get(callId));
        activeCalls.delete(callId);
    }
    
    logger.log(`🔔 Starting ringing for call ${callId} to ${userId}`);
    
    // Send first push immediately
    await sendAndroidPush(userId, callerName, callId, callerId);
    
    // Set up interval for repeated pushes every 3 seconds
    const interval = setInterval(async () => {
        // Check if call still exists and is still ringing
        const callDoc = await db.collection('calls').doc(callId).get();
        if (!callDoc.exists) {
            logger.log(`📞 Call ${callId} ended, stopping ringing`);
            clearInterval(interval);
            activeCalls.delete(callId);
            return;
        }
        
        const callData = callDoc.data();
        if (callData.status !== 'ringing') {
            logger.log(`📞 Call ${callId} status changed to ${callData.status}, stopping ringing`);
            clearInterval(interval);
            activeCalls.delete(callId);
            return;
        }
        
        // Send another push
        await sendAndroidPush(userId, callerName, callId, callerId);
        
    }, 3000);
    
    activeCalls.set(callId, interval);
    
    // Auto-stop after 60 seconds (20 pushes max)
    setTimeout(() => {
        if (activeCalls.has(callId)) {
            logger.log(`⏰ Ringing timeout for call ${callId}`);
            clearInterval(activeCalls.get(callId));
            activeCalls.delete(callId);
        }
    }, 60000);
}

exports.onCallCreated = onDocumentCreated('calls/{callId}', async (event) => {
    const call = event.data.data();
    const callId = event.params.callId;

    logger.log(`📞 New call: ${callId}`);

    if (call.status !== 'ringing') return null;
    if (call.callerId === call.calleeId) return null;

    try {
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists
            ? (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId)
            : call.callerId;
        
        // Check if callee has FCM token (Android)
        const calleeDoc = await db.collection('users').doc(call.calleeId).get();
        const hasFCM = calleeDoc.exists && calleeDoc.data()?.fcmToken;
        
        if (hasFCM) {
            // Android: start repeated ringing
            await startRinging(call.calleeId, callerName, callId, call.callerId);
        } else {
            // Fallback to Web Push (single push)
            const userData = calleeDoc.data();
            if (userData?.webPushSubscription) {
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
            }
        }
        
        // Log notification
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            callerName: callerName,
            method: hasFCM ? 'fcm_ringing' : 'webpush',
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
    } catch (error) {
        logger.error(`❌ Push error:`, error.message);
    }
    
    return null;
});

// Clean up intervals on call end
exports.onCallEnded = onDocumentUpdated('calls/{callId}', async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    
    // If call status changed from ringing to something else
    if (before.status === 'ringing' && after.status !== 'ringing') {
        const callId = event.params.callId;
        if (activeCalls.has(callId)) {
            logger.log(`📞 Call ${callId} ended, stopping ringing`);
            clearInterval(activeCalls.get(callId));
            activeCalls.delete(callId);
        }
    }
    
    return null;
});

exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({
        status: 'ok',
        time: new Date().toISOString(),
        service: 'webrtc-communicator-push'
    });
});
