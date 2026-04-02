/**
 * Cloud Functions for WebRTC Communicator
 * Simple working version - stops notifications immediately when call ends
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Store active intervals (simple Map - works for single instance)
const activeIntervals = new Map();

// ==================== BARK PUSH FUNCTION ====================

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

// ==================== MAIN FUNCTION ====================

exports.onCallCreated = onDocumentCreated('calls/{callId}', async (event) => {
    const call = event.data.data();
    const callId = event.params.callId;

    logger.log(`📞 New call: ${callId}`);

    if (call.status !== 'ringing') return;
    if (call.callerId === call.calleeId) return;

    try {
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists ? (callerDoc.data().displayname || call.callerId) : call.callerId;
        
        const calleeDoc = await db.collection('users').doc(call.calleeId).get();
        const calleeData = calleeDoc.data() || {};
        
        // Only Bark for now
        if (!calleeData.barkDeviceKey) {
            logger.log(`⚠️ No Bark key for ${call.calleeId}`);
            return;
        }
        
        logger.log(`🍎 Starting Bark ringing for ${call.calleeId}`);
        
        // Send first notification immediately
        await sendBarkPush(call.calleeId, callerName, callId, call.callerId);
        
        // Set up interval (every 3 seconds)
        let isActive = true;
        const interval = setInterval(async () => {
            if (!isActive) return;
            
            try {
                // Check call status
                const currentCall = await db.collection('calls').doc(callId).get();
                if (!currentCall.exists) {
                    logger.log(`📞 Call ${callId} gone, stopping`);
                    isActive = false;
                    clearInterval(interval);
                    activeIntervals.delete(callId);
                    return;
                }
                
                const status = currentCall.data().status;
                if (status !== 'ringing') {
                    logger.log(`📞 Call ${callId} status = ${status}, stopping`);
                    isActive = false;
                    clearInterval(interval);
                    activeIntervals.delete(callId);
                    return;
                }
                
                // Still ringing - send another notification
                await sendBarkPush(call.calleeId, callerName, callId, call.callerId);
                
            } catch (err) {
                logger.error(`Interval error: ${err.message}`);
            }
        }, 3000);
        
        activeIntervals.set(callId, interval);
        
        // Safety timeout: stop after 30 seconds
        setTimeout(() => {
            if (isActive) {
                logger.log(`⏰ Timeout for call ${callId}`);
                isActive = false;
                clearInterval(interval);
                activeIntervals.delete(callId);
            }
        }, 30000);
        
    } catch (error) {
        logger.error(`❌ Error: ${error.message}`);
    }
});

// Clean up when call status changes
exports.onCallEnded = onDocumentUpdated('calls/{callId}', async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const callId = event.params.callId;
    
    // If status changed from ringing to something else
    if (before.status === 'ringing' && after.status !== 'ringing') {
        logger.log(`📞 Call ${callId} changed to ${after.status}, stopping notifications`);
        
        const interval = activeIntervals.get(callId);
        if (interval) {
            clearInterval(interval);
            activeIntervals.delete(callId);
        }
    }
});

// Health check
exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({ status: 'ok' });
});
