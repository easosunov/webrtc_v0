/**
 * Cloud Functions for WebRTC Communicator
 * Dual Push System: FCM for Android, Bark for iOS, Web Push for other browsers
 * iOS: Repeated Bark pushes every 3 seconds to simulate ringing
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

// Store active call intervals to avoid duplicates
const activeCalls = new Map();

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

// Send repeated pushes for ringing calls (Android only)
async function startRinging(userId, callerName, callId, callerId) {
    // Clear any existing interval for this call
    if (activeCalls.has(callId)) {
        clearInterval(activeCalls.get(callId));
        activeCalls.delete(callId);
    }
    
    logger.log(`🔔 Starting Android ringing for call ${callId} to ${userId}`);
    
    // Send first push immediately
    await sendAndroidPush(userId, callerName, callId, callerId);
    
    // Set up interval for repeated pushes every 3 seconds
    const interval = setInterval(async () => {
        // Check if call still exists and is still ringing
        const callDoc = await db.collection('calls').doc(callId).get();
        if (!callDoc.exists) {
            logger.log(`📞 Call ${callId} ended, stopping Android ringing`);
            clearInterval(interval);
            activeCalls.delete(callId);
            return;
        }
        
        const callData = callDoc.data();
        // Stop if call is no longer ringing (answered, cancelled, rejected, timeout)
        if (callData.status !== 'ringing') {
            logger.log(`📞 Call ${callId} status changed to ${callData.status}, stopping Android ringing`);
            clearInterval(interval);
            activeCalls.delete(callId);
            return;
        }
        
        // Send another push
        await sendAndroidPush(userId, callerName, callId, callerId);
        
    }, 3000);
    
    activeCalls.set(callId, interval);
    
    // Auto-stop after 120 seconds (40 pushes max)
    setTimeout(() => {
        if (activeCalls.has(callId)) {
            logger.log(`⏰ Android ringing timeout for call ${callId}`);
            clearInterval(activeCalls.get(callId));
            activeCalls.delete(callId);
            
            // Update call status to timeout
            db.collection('calls').doc(callId).update({
                status: 'timeout',
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => logger.error(`Failed to update timeout status: ${err.message}`));
        }
    }, 120000);
}

// ==================== iOS (BARK) PUSH FUNCTIONS ====================

// Send a single Bark notification
async function sendBarkPush(userId, callerName, callId, callerId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return false;
    
    const userData = userDoc.data();
    if (!userData.barkDeviceKey) return false;
    
    const deviceKey = userData.barkDeviceKey;
    const encodedCallerName = encodeURIComponent(callerName);
    const barkUrl = `https://api.day.app/${deviceKey}/Incoming Call/${encodedCallerName}?call=1&group=call_${callId}&level=critical&sound=ringtone`;
    
    try {
        const response = await fetch(barkUrl);
        logger.log(`🍎 Bark notification sent to ${userId} for call ${callId}`);
        return true;
    } catch (error) {
        logger.error(`❌ Bark notification failed: ${error.message}`);
        return false;
    }
}

// Send repeated Bark pushes for ringing calls (iOS only)
async function startBarkRinging(userId, callerName, callId, callerId) {
    // Clear any existing interval for this call
    const barkKey = `bark_${callId}`;
    if (activeCalls.has(barkKey)) {
        clearInterval(activeCalls.get(barkKey));
        activeCalls.delete(barkKey);
    }
    
    logger.log(`🔔 Starting Bark ringing for call ${callId} to ${userId}`);
    
    // Send first push immediately
    await sendBarkPush(userId, callerName, callId, callerId);
    
    // Set up interval for repeated pushes every 3 seconds
    const interval = setInterval(async () => {
        // Check if call still exists and is still ringing
        const callDoc = await db.collection('calls').doc(callId).get();
        if (!callDoc.exists) {
            logger.log(`📞 Call ${callId} ended, stopping Bark ringing`);
            clearInterval(interval);
            activeCalls.delete(barkKey);
            return;
        }
        
        const callData = callDoc.data();
        // Stop if call is no longer ringing (answered, cancelled, rejected, timeout)
        if (callData.status !== 'ringing') {
            logger.log(`📞 Call ${callId} status changed to ${callData.status}, stopping Bark ringing`);
            clearInterval(interval);
            activeCalls.delete(barkKey);
            return;
        }
        
        // Send another Bark push
        await sendBarkPush(userId, callerName, callId, callerId);
        
    }, 3000);
    
    activeCalls.set(barkKey, interval);
    
    // Auto-stop after 120 seconds (40 pushes max)
    setTimeout(() => {
        if (activeCalls.has(barkKey)) {
            logger.log(`⏰ Bark ringing timeout for call ${callId}`);
            clearInterval(activeCalls.get(barkKey));
            activeCalls.delete(barkKey);
            
            // Update call status to timeout
            db.collection('calls').doc(callId).update({
                status: 'timeout',
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            }).catch(err => logger.error(`Failed to update timeout status: ${err.message}`));
        }
    }, 120000);
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
        
        // Get callee's user data
        const calleeDoc = await db.collection('users').doc(call.calleeId).get();
        const calleeData = calleeDoc.data() || {};
        
        const hasFCM = !!calleeData.fcmToken;
        const hasBark = !!calleeData.barkDeviceKey;
        
        if (hasFCM) {
            // Android: start repeated ringing via FCM
            logger.log(`📱 Android user detected, starting FCM ringing for ${call.calleeId}`);
            await startRinging(call.calleeId, callerName, callId, call.callerId);
        } else if (hasBark) {
            // iOS: start repeated ringing via Bark
            logger.log(`🍎 iOS user detected, starting Bark ringing for ${call.calleeId}`);
            await startBarkRinging(call.calleeId, callerName, callId, call.callerId);
        } else {
            // Fallback to Web Push (single push)
            if (calleeData?.webPushSubscription) {
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
                logger.log(`✅ Web Push sent to ${call.calleeId}`);
            } else {
                logger.log(`⚠️ No push method available for ${call.calleeId}`);
            }
        }
        
        // Log notification
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            callerName: callerName,
            method: hasFCM ? 'fcm_ringing' : (hasBark ? 'bark_ringing' : 'webpush'),
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
    
    const callId = event.params.callId;
    
    // Check if call status changed FROM 'ringing' TO any non-ringing status
    const wasRinging = before.status === 'ringing';
    const isEnded = after.status !== 'ringing';  // includes: answered, ended, cancelled, rejected, timeout
    
    if (wasRinging && isEnded) {
        logger.log(`📞 Call ${callId} changed from ${before.status} to ${after.status}, stopping all ringing`);
        
        // Clean up Android intervals
        if (activeCalls.has(callId)) {
            logger.log(`🛑 Stopping FCM ringing for call ${callId}`);
            clearInterval(activeCalls.get(callId));
            activeCalls.delete(callId);
        }
        
        // Clean up Bark intervals
        const barkKey = `bark_${callId}`;
        if (activeCalls.has(barkKey)) {
            logger.log(`🍎 Stopping Bark ringing for call ${callId}`);
            clearInterval(activeCalls.get(barkKey));
            activeCalls.delete(barkKey);
        }
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

// Debug endpoint to see active intervals
exports.debugActiveCalls = onRequest((req, res) => {
    const active = Array.from(activeCalls.keys());
    res.json({ 
        activeIntervals: active,
        count: active.length 
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
        
        // Only reject if call is still ringing
        if (call.status === 'ringing') {
            await db.collection('calls').doc(callId).update({
                status: 'rejected',
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Clean up intervals immediately
            if (activeCalls.has(callId)) {
                clearInterval(activeCalls.get(callId));
                activeCalls.delete(callId);
            }
            const barkKey = `bark_${callId}`;
            if (activeCalls.has(barkKey)) {
                clearInterval(activeCalls.get(barkKey));
                activeCalls.delete(barkKey);
            }
            
            logger.log(`📞 Call ${callId} rejected via notification dismiss`);
            res.status(200).json({ success: true, status: 'rejected' });
        } else {
            res.status(200).json({ success: true, status: call.status });
        }
        
    } catch (error) {
        logger.error('Reject call error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Clean up stale ringing calls (can be triggered by cron job)
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
                
                // Clean up intervals
                if (activeCalls.has(callId)) {
                    clearInterval(activeCalls.get(callId));
                    activeCalls.delete(callId);
                }
                const barkKey = `bark_${callId}`;
                if (activeCalls.has(barkKey)) {
                    clearInterval(activeCalls.get(barkKey));
                    activeCalls.delete(barkKey);
                }
                
                // Update call status
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
