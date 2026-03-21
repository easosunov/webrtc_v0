// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Send push notification when a new call is created
exports.onCallCreated = functions.firestore
    .document('calls/{callId}')
    .onCreate(async (snap, context) => {
        const call = snap.data();
        const callId = context.params.callId;
        
        console.log(`📞 New call created: ${callId} from ${call.callerId} to ${call.calleeId}`);
        
        // Only send notification for ringing calls (incoming)
        if (call.status !== 'ringing') {
            console.log('Not a ringing call, skipping push');
            return null;
        }
        
        // Get the callee's user document to find their push subscription
        const userDoc = await admin.firestore().collection('users').doc(call.calleeId).get();
        const userData = userDoc.data();
        
        if (!userData || !userData.pushSubscription) {
            console.log(`❌ No push subscription found for user: ${call.calleeId}`);
            return null;
        }
        
        // Get caller's display name
        const callerDoc = await admin.firestore().collection('users').doc(call.callerId).get();
        const callerName = callerDoc.data()?.displayname || call.callerId;
        
        const subscription = userData.pushSubscription;
        
        const payload = {
            notification: {
                title: '📞 Incoming Call',
                body: `Call from ${callerName}`,
                sound: 'default'
            },
            data: {
                callId: callId,
                callerId: call.callerId,
                callerName: callerName,
                url: '/'
            },
            token: subscription.endpoint
        };
        
        try {
            // Send via FCM (which handles both FCM and APNs)
            const response = await admin.messaging().send(payload);
            console.log(`✅ Push notification sent to ${call.calleeId}:`, response);
        } catch (error) {
            console.error(`❌ Failed to send push to ${call.calleeId}:`, error);
            
            // If token is invalid, remove it
            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                await admin.firestore().collection('users').doc(call.calleeId).update({
                    pushSubscription: admin.firestore.FieldValue.delete()
                });
                console.log(`🗑️ Removed invalid push token for ${call.calleeId}`);
            }
        }
        
        return null;
    });
