/**
 * Firebase Cloud Functions for WebRTC Communicator
 * Sends push notifications when incoming calls are created
 */

const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {onRequest} = require('firebase-functions/v2/https');
const {logger} = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
admin.initializeApp();

// Reference to Firestore
const db = admin.firestore();

/**
 * Send push notification when a new call is created
 * Triggered when a document is added to the 'calls' collection
 */
exports.onCallCreated = onDocumentCreated('calls/{callId}', async (event) => {
    const call = event.data.data();
    const callId = event.params.callId;
    
    logger.log(`📞 New call created: ${callId}`);
    logger.log(`   Caller: ${call.callerId}`);
    logger.log(`   Callee: ${call.calleeId}`);
    logger.log(`   Status: ${call.status}`);
    
    // Only send notification for ringing calls (incoming)
    if (call.status !== 'ringing') {
        logger.log(`⚠️ Call status is '${call.status}', not sending push notification`);
        return null;
    }
    
    // Don't send notification if the caller is the same as callee
    if (call.callerId === call.calleeId) {
        logger.log(`⚠️ Caller and callee are the same, skipping push`);
        return null;
    }
    
    try {
        // Get the callee's user document
        const userDoc = await db.collection('users').doc(call.calleeId).get();
        
        if (!userDoc.exists) {
            logger.log(`❌ User document not found for callee: ${call.calleeId}`);
            return null;
        }
        
        const userData = userDoc.data();
        
        // Check if user has a push subscription
        if (!userData.pushSubscription) {
            logger.log(`📱 No push subscription found for user: ${call.calleeId}`);
            return null;
        }
        
        // Get caller's display name
        const callerDoc = await db.collection('users').doc(call.callerId).get();
        const callerName = callerDoc.exists ? 
            (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId) : 
            call.callerId;
        
        const subscription = userData.pushSubscription;
        
        // Build the notification payload for web push
        const payload = {
            notification: {
                title: '📞 Incoming Call',
                body: `Call from ${callerName}`,
                icon: 'https://easosunov.github.io/favicon.ico',
                badge: 'https://easosunov.github.io/favicon.ico',
                vibrate: [200, 100, 200]
            },
            data: {
                callId: callId,
                callerId: call.callerId,
                callerName: callerName,
                url: 'https://easosunov.github.io/',
                timestamp: new Date().toISOString()
            },
            token: subscription.endpoint,
            webpush: {
                headers: {
                    Urgency: 'high'
                },
                notification: {
                    requireInteraction: true,
                    silent: false,
                    actions: [
                        {
                            action: 'answer',
                            title: 'Answer Call'
                        },
                        {
                            action: 'dismiss',
                            title: 'Dismiss'
                        }
                    ]
                }
            }
        };
        
        // Send the push notification
        logger.log(`📤 Sending push notification to ${call.calleeId}...`);
        const response = await admin.messaging().send(payload);
        logger.log(`✅ Push notification sent successfully: ${response}`);
        
        // Log the notification in Firestore for debugging
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            callerName: callerName,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'sent',
            response: response
        });
        
        return { success: true, messageId: response };
        
    } catch (error) {
        logger.error(`❌ Error sending push notification:`, error);
        
        // If token is invalid, remove it from the user document
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
            logger.log(`🗑️ Removing invalid push token for ${call.calleeId}`);
            await db.collection('users').doc(call.calleeId).update({
                pushSubscription: admin.firestore.FieldValue.delete(),
                pushInvalidAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
        // Log the error
        await db.collection('notifications').add({
            userId: call.calleeId,
            callId: callId,
            callerId: call.callerId,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'failed',
            error: error.message
        });
        
        return null;
    }
});

/**
 * Simple health check endpoint
 */
exports.healthCheck = onRequest((req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'webrtc-communicator-push'
    });
});
