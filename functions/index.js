/**
 * Cloud Functions for WebRTC Communicator
 * Uses recursive setTimeout instead of setInterval to prevent overlapping notifications
 * Stops immediately when call status changes
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// VAPID Keys (for Web Push)
const VAPID_PUBLIC_KEY = 'BH33WjtMVo0Y_bml_nke0gtVqahGcPd6m-yjh__LBHp6Ahvfq-vN-m25D2MzMB3e1jbTGwQRGt5ufKEhSyj6Yv0';
const VAPID_PRIVATE_KEY = 'lULaLKgEB47Ab9p8FDr5_NqbusivicVHnDvkdC6TJYA';

webpush.setVapidDetails(
    'mailto:webrtc@easosunov.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// ==================== ANDROID (FCM) PUSH FUNCTIONS ====================

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

// Android ringing using recursive setTimeout
async function startRinging(userId, callerName, callId, callerId) {
    logger.log(`🔔 Starting Android ringing for call ${callId} to ${userId}`);
    
    // Send first push immediately
    await sendAndroidPush(userId, callerName, callId, callerId);
    
    // Recursive notification loop
    async function notificationLoop() {
        try {
            const callDoc = await db.collection('calls').doc(callId).get();
            
            if (!callDoc.exists) {
                logger.log(`📞 Call ${callId} no longer exists, stopping Android ringing`);
                return;
            }
            
            const status = callDoc.data().status;
            if (status !== 'ringing') {
                logger.log(`📞 Call ${callId} status = ${status}, stopping Android ringing`);
                return;
            }
            
            // Still ringing - send another notification
            await sendAndroidPush(userId, callerName, callId, callerId);
            
            // Schedule next notification only after this one completes
            setTimeout(notificationLoop, 3000);
            
        } catch (err) {
            logger.error(`Android notification loop error: ${err.message}`);
        }
    }
    
    // Start the recursive loop after 3 seconds
    setTimeout(notificationLoop, 3000);
    
    // Safety timeout: stop after 30 seconds
    setTimeout(async () => {
        const callDoc = await db.collection('calls').doc(callId).get();
        if (callDoc.exists && callDoc.data().status === 'ringing') {
            logger.log(`⏰ Safety timeout for Android call ${callId}, forcing stop`);
            // Update status to timeout
            await callDoc.ref.update({
                status: 'timeout',
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => logger.error(`Failed to update timeout status: ${err.message}`));
        }
    }, 30000);
}

// ==================== iOS (BARK) PUSH FUNCTIONS ====================

async function sendBarkPush(userId, callerName, callId, callerId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return false;
    
    const userData = userDoc.data();
    if (!userData.barkDeviceKey) return false;
    
    const deviceKey = userData.barkDeviceKey;
    const encodedCallerName = encodeURIComponent(callerName);
    const redirectUrl = `https://easosunov.github.io/webrtc_v0/?callId=${callId}&callerId=${callerId}`;
    const encodedUrl = encodeURIComponent(redirectUrl);
    
    const barkUrl = `https://api.day.app/${deviceKey}/Incoming Call/${encodedCallerName}?call=1&group=call_${callId}&level=critical&sound=ringtone&url=${encodedUrl}`;
    
    try {
        const fetch = (await import('node-fetch')).default;
        await fetch(barkUrl);
        logger.log(`🍎 Bark sent to ${userId}`);
        return true;
    } catch (error) {
        logger.error(`❌ Bark failed: ${error.message}`);
        return false;
    }
}

// iOS Bark ringing using recursive setTimeout (no setInterval)
async function startBarkRinging(userId, callerName, callId, callerId) {
    logger.log(`🔔 Starting Bark ringing for call ${callId} to ${userId}`);
    
    // Send first notification immediately
    await sendBarkPush(userId, callerName, callId, callerId);
    
    // Recursive notification loop - prevents overlapping executions
    async function notificationLoop() {
        try {
            // Check call status before sending next notification
            const callDoc = await db.collection('calls').doc(callId).get();
            
            if (!callDoc.exists) {
                logger.log(`📞 Call ${callId} no longer exists, stopping Bark ringing`);
                return;
            }
            
            const status = callDoc.data().status;
            if (status !== 'ringing') {
                logger.log(`📞 Call ${callId} status = ${status}, stopping Bark ringing`);
                return;
            }
            
            // Still ringing - send another notification
            await sendBarkPush(userId, callerName, callId, callerId);
            
            // Schedule next notification only after this one completes
            setTimeout(notificationLoop, 3000);
            
        } catch (err) {
            logger.error(`Bark notification loop error: ${err.message}`);
        }
    }
    
    // Start the recursive loop after 3 seconds
    setTimeout(notificationLoop, 3000);
    
    // Safety timeout: stop after 30 seconds max
    setTimeout(async () => {
        const callDoc = await db.collection('calls').doc(callId).get();
        if (callDoc.exists && callDoc.data().status === 'ringing') {
            logger.log(`⏰ Safety timeout for Bark call ${callId}, forcing stop`);
            // Update status to timeout
            await callDoc.ref.update({
                status: 'timeout',
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => logger.error(`Failed to update timeout status: ${err.message}`));
        }
    }, 60000);
}

// ==================== CLOUD FUNCTIONS ====================

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
        
        const calleeDoc = await db.collection('users').doc(call.calleeId).get();
        const calleeData = calleeDoc.data() || {};
        
        // Log available data for debugging
        logger.log(`🔍 User ${call.calleeId}: hasBark=${!!calleeData.barkDeviceKey}, hasFCM=${!!calleeData.fcmToken}`);
        
        // Check for Bark FIRST (iOS)
        if (calleeData.barkDeviceKey) {
            logger.log(`🍎 Sending Bark to iOS device for ${call.calleeId}`);
            await startBarkRinging(call.calleeId, callerName, callId, call.callerId);
        } 
        else if (calleeData.fcmToken) {
            logger.log(`📱 Sending FCM to Android device for ${call.calleeId}`);
            await startRinging(call.calleeId, callerName, callId, call.callerId);
        } 
        else if (calleeData.webPushSubscription) {
            logger.log(`💻 Sending Web Push to desktop for ${call.calleeId}`);
            const webPayload = JSON.stringify({
                title: '📞 Incoming Call',
                body: `Call from ${callerName}`,
                icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
                callId: callId,
                callerId: call.callerId,
                callerName: callerName,
                url: '/webrtc_v0/'
            });
            await webpush.sendNotification(calleeData.webPushSubscription, webPayload);
        }
        else {
            logger.log(`⚠️ No push method available for ${call.calleeId}`);
        }
        
        // Log notification
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            callerName: callerName,
            method: calleeData.barkDeviceKey ? 'bark' : (calleeData.fcmToken ? 'fcm' : (calleeData.webPushSubscription ? 'webpush' : 'none')),
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
    } catch (error) {
        logger.error(`❌ Push error:`, error.message);
    }
    
    return null;
});

// Clean up when call status changes
exports.onCallEnded = onDocumentUpdated('calls/{callId}', async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const callId = event.params.callId;
    
    // If status changed from ringing to something else
    if (before.status === 'ringing' && after.status !== 'ringing') {
        logger.log(`📞 Call ${callId} changed from ${before.status} to ${after.status}, notifications will stop on next check`);
        // The recursive loops will stop on their next iteration when they see the status change
    }
    
    return null;
});

// Health check endpoint
exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({
        status: 'ok',
        time: new Date().toISOString(),
        service: 'webrtc-communicator-push'
    });
});

// Reject call endpoint
exports.rejectCall = onRequest(async (req, res) => {
    const callId = req.query.callId;
    
    if (!callId) {
        res.status(400).json({ error: 'Missing callId' });
        return;
    }
    
    try {
        const callDoc = await db.collection('calls').doc(callId).get();
        
        if (!callDoc.exists) {
            res.status(404).json({ error: 'Call not found' });
            return;
        }
        
        const call = callDoc.data();
        
        if (call.status === 'ringing') {
            await db.collection('calls').doc(callId).update({
                status: 'rejected',
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            logger.log(`📞 Call ${callId} rejected`);
            res.status(200).json({ success: true, status: 'rejected' });
        } else {
            res.status(200).json({ success: true, status: call.status });
        }
        
    } catch (error) {
        logger.error('Reject call error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Clean up stale ringing calls
exports.cleanupStaleRingingCalls = onRequest(async (req, res) => {
    try {
        const staleTime = Date.now() - 120000; // 2 minutes ago
        const staleCalls = await db.collection('calls')
            .where('status', '==', 'ringing')
            .get();
        
        let cleaned = 0;
        for (const doc of staleCalls.docs) {
            const callData = doc.data();
            const callTime = callData.timestamp?.toMillis?.() || 0;
            
            if (callTime < staleTime) {
                const callId = doc.id;
                logger.log(`🧹 Cleaning up stale call: ${callId}`);
                
                await doc.ref.update({
                    status: 'timeout',
                    endedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                cleaned++;
            }
        }
        
        res.status(200).json({ 
            success: true, 
            cleaned: cleaned,
            message: `Cleaned up ${cleaned} stale calls`
        });
    } catch (error) {
        logger.error('Cleanup error:', error);
        res.status(500).json({ error: error.message });
    }
});
