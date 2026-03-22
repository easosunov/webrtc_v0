/**
 * Cloud Functions for WebRTC Communicator
 * Sends push notifications using web-push library
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// ==================== VAPID KEYS ====================
// These MUST match the keys used in your web app config.js
const VAPID_PUBLIC_KEY = 'BH33WjtMVo0Y_bml_nke0gtVqahGcPd6m-yjh__LBHp6Ahvfq-vN-m25D2MzMB3e1jbTGwQRGt5ufKEhSyj6Yv0';
const VAPID_PRIVATE_KEY = 'lULaLKgEB47Ab9p8FDr5_NqbusivicVHnDvkdC6TJYA';  // ⚠️ You need to add this!

// Configure web-push with VAPID keys
webpush.setVapidDetails(
    'mailto:webrtc@easosunov.com',  // Change to your email
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

/**
 * Send push notification when a new call is created
 */
exports.onCallCreated = functions.firestore
    .document('calls/{callId}')
    .onCreate(async (snap, context) => {
        const call = snap.data();
        const callId = context.params.callId;
        
        console.log(`📞 New call created: ${callId}`);
        console.log(`   Caller: ${call.callerId}`);
        console.log(`   Callee: ${call.calleeId}`);
        
        // Only send notification for ringing calls (incoming)
        if (call.status !== 'ringing') {
            console.log(`⚠️ Call status is '${call.status}', not sending push notification`);
            return null;
        }
        
        // Don't send notification if the caller is the same as callee
        if (call.callerId === call.calleeId) {
            console.log(`⚠️ Caller and callee are the same, skipping push`);
            return null;
        }
        
        try {
            // Get the callee's user document
            const userDoc = await db.collection('users').doc(call.calleeId).get();
            
            if (!userDoc.exists) {
                console.log(`❌ User document not found for callee: ${call.calleeId}`);
                return null;
            }
            
            const userData = userDoc.data();
            
            // Check if user has a push subscription
            if (!userData.pushSubscription) {
                console.log(`📱 No push subscription found for user: ${call.calleeId}`);
                return null;
            }
            
            const subscription = userData.pushSubscription;
            
            // Log subscription details
            console.log(`🔍 Endpoint: ${subscription.endpoint.substring(0, 80)}...`);
            console.log(`🔍 Keys present: ${!!subscription.keys}`);
            
            // Get caller's display name
            const callerDoc = await db.collection('users').doc(call.callerId).get();
            const callerName = callerDoc.exists ? 
                (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId) : 
                call.callerId;
            
            // Build the payload (what the service worker will receive)
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
            
            // Send the push notification
            console.log(`📤 Sending push to ${call.calleeId}...`);
            await webpush.sendNotification(subscription, payload);
            console.log(`✅ Push sent successfully`);
            
            // Log success in Firestore
            await db.collection('notifications').add({
                userId: call.calleeId,
                callId: callId,
                callerId: call.callerId,
                callerName: callerName,
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'sent'
            });
            
            return { success: true };
            
        } catch (error) {
            console.error(`❌ Error sending push:`, error.message);
            
            // Log the error in Firestore
            await db.collection('notifications').add({
                userId: call.calleeId,
                callId: callId,
                callerId: call.callerId,
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'failed',
                error: error.message
            });
            
            // If subscription is invalid (410 Gone or 404 Not Found), remove it
            if (error.statusCode === 410 || error.statusCode === 404) {
                console.log(`🗑️ Removing invalid subscription for ${call.calleeId}`);
                await db.collection('users').doc(call.calleeId).update({
                    pushSubscription: admin.firestore.FieldValue.delete()
                });
            }
            
            return null;
        }
    });

/**
 * Simple health check endpoint
 */
exports.healthCheck = functions.https.onRequest((req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'webrtc-communicator-push'
    });
});
