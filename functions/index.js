/**
 * Cloud Functions for WebRTC Communicator
 * Single Active Device: Only the last logged-in device receives notifications
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
        const callDoc = await db.collection('calls').doc(callId).get();
        if (!callDoc.exists) {
            logger.log(`📞 Call ${callId} ended, stopping Android ringing`);
            clearInterval(interval);
            activeCalls.delete(callId);
            return;
        }
        
        const callData = callDoc.data();
        // STOP immediately if call is no longer ringing
        if (callData.status !== 'ringing') {
            logger.log(`📞 Call ${callId} status changed to ${callData.status}, stopping Android ringing IMMEDIATELY`);
            clearInterval(interval);
            activeCalls.delete(callId);
            return;
        }
        
        await sendAndroidPush(userId, callerName, callId, callerId);
        
    }, 3000);
    
    activeCalls.set(callId, interval);
    
    // Safety timeout - stop after 60 seconds (fallback)
    setTimeout(() => {
        if (activeCalls.has(callId)) {
            logger.log(`⏰ Android ringing safety timeout for call ${callId}`);
            clearInterval(activeCalls.get(callId));
            activeCalls.delete(callId);
        }
    }, 60000);
}

// ==================== iOS (BARK) PUSH FUNCTIONS ====================

async function sendBarkPush(userId, callerName, callId, callerId) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return false;
    
    const userData = userDoc.data();
    if (!userData.barkDeviceKey) return false;
    
    const deviceKey = userData.barkDeviceKey;
    const encodedCallerName = encodeURIComponent(callerName);
    
    // Create the redirect URL to your WebRTC app
    const redirectUrl = `https://easosunov.github.io/webrtc_v0/?callId=${callId}&callerId=${callerId}`;
    const encodedUrl = encodeURIComponent(redirectUrl);
    
    // Bark URL with call=1 for continuous ringtone and url for redirect
    const barkUrl = `https://api.day.app/${deviceKey}/Incoming Call/${encodedCallerName}?call=1&group=call_${callId}&level=critical&sound=ringtone&url=${encodedUrl}`;
    
    try {
        const fetch = (await import('node-fetch')).default;
        await fetch(barkUrl);
        logger.log(`🍎 Bark notification sent to ${userId} for call ${callId}`);
        logger.log(`🔗 Redirect URL: ${redirectUrl}`);
        return true;
    } catch (error) {
        logger.error(`❌ Bark notification failed: ${error.message}`);
        return false;
    }
}

async function startBarkRinging(userId, callerName, callId, callerId) {
    const barkKey = `bark_${callId}`;
    
    // Clear any existing interval for this call
    if (activeCalls.has(barkKey)) {
        clearInterval(activeCalls.get(barkKey));
        activeCalls.delete(barkKey);
    }
    
    logger.log(`🔔 Starting Bark ringing for call ${callId} to ${userId}`);
    
    // Send first push immediately
    await sendBarkPush(userId, callerName, callId, callerId);
    
    let intervalRunning = true;
    
    // Set up interval for repeated pushes every 2 seconds
    const interval = setInterval(async () => {
        if (!intervalRunning) return;
        
        try {
            // Check call status BEFORE sending another notification
            const callDoc = await db.collection('calls').doc(callId).get();
            
            if (!callDoc.exists) {
                logger.log(`📞 Call ${callId} no longer exists, stopping Bark ringing`);
                intervalRunning = false;
                clearInterval(interval);
                activeCalls.delete(barkKey);
                return;
            }
            
            const callData = callDoc.data();
            const status = callData.status;
            
            // STOP if call is no longer ringing
            if (status !== 'ringing') {
                logger.log(`📞 Call ${callId} status changed to ${status}, stopping Bark ringing IMMEDIATELY`);
                intervalRunning = false;
                clearInterval(interval);
                activeCalls.delete(barkKey);
                return;
            }
            
            // Only send if still ringing
            await sendBarkPush(userId, callerName, callId, callerId);
            
        } catch (err) {
            logger.error(`Error in Bark interval: ${err.message}`);
        }
    }, 2000); // Every 2 seconds
    
    activeCalls.set(barkKey, interval);
    
    // Safety timeout - stop after 30 seconds (15 pushes max)
    setTimeout(() => {
        if (intervalRunning) {
            logger.log(`⏰ Bark ringing safety timeout for call ${callId}`);
            intervalRunning = false;
            clearInterval(interval);
            activeCalls.delete(barkKey);
        }
    }, 30000);
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
        logger.log(`🔍 User ${call.calleeId}: hasBark=${!!calleeData.barkDeviceKey}, hasFCM=${!!calleeData.fcmToken}, hasWebPush=${!!calleeData.webPushSubscription}`);
        
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

// Clean up intervals on call end
exports.onCallEnded = onDocumentUpdated('calls/{callId}', async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    
    const callId = event.params.callId;
    
    // If call status changed FROM 'ringing' TO any non-ringing status
    if (before.status === 'ringing' && after.status !== 'ringing') {
        logger.log(`📞 Call ${callId} changed from ${before.status} to ${after.status}, stopping all ringing IMMEDIATELY`);
        
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

exports.stopRinging = onRequest(async (req, res) => {
    const callId = req.query.callId;
    
    logger.log(`🛑 STOP RINGING requested for call ${callId}`);
    
    if (!callId) {
        res.status(400).json({ error: 'Missing callId' });
        return;
    }
    
    let stopped = false;
    
    // Clean up Android intervals
    if (activeCalls.has(callId)) {
        clearInterval(activeCalls.get(callId));
        activeCalls.delete(callId);
        logger.log(`✅ Stopped FCM ringing for call ${callId}`);
        stopped = true;
    }
    
    // Clean up Bark intervals
    const barkKey = `bark_${callId}`;
    if (activeCalls.has(barkKey)) {
        clearInterval(activeCalls.get(barkKey));
        activeCalls.delete(barkKey);
        logger.log(`✅ Stopped Bark ringing for call ${callId}`);
        stopped = true;
    }
    
    res.status(200).json({ success: true, stopped: stopped });
});

exports.cleanupStaleRingingCalls = onRequest(async (req, res) => {
    // ... existing code ...
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
                
                if (activeCalls.has(callId)) {
                    clearInterval(activeCalls.get(callId));
                    activeCalls.delete(callId);
                }
                const barkKey = `bark_${callId}`;
                if (activeCalls.has(barkKey)) {
                    clearInterval(activeCalls.get(barkKey));
                    activeCalls.delete(barkKey);
                }
                
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
