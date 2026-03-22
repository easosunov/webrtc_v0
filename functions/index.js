/**
 * Cloud Functions for WebRTC Communicator
 * Sends Web Push notifications using web-push (VAPID)
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

// ==================== VAPID KEYS ====================
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
    if (!userDoc.exists) return null;

    const userData = userDoc.data();
    if (!userData.pushSubscription) return null;

    const subscription = userData.pushSubscription;

    const callerDoc = await db.collection('users').doc(call.callerId).get();
    const callerName = callerDoc.exists
      ? (callerDoc.data().displayname || callerDoc.data().displayName || call.callerId)
      : call.callerId;

    // ✅ IMPORTANT: FLAT PAYLOAD (NO "notification" WRAPPER)
    const payload = JSON.stringify({
      title: '📞 Incoming Call',
      body: `Call from ${callerName}`,
      icon: 'https://easosunov.github.io/webrtc_v0/favicon.ico',
      callId: callId,
      callerId: call.callerId,
      callerName: callerName,
      url: '/webrtc_v0/'
    });

    logger.log('📤 Sending push...');

    await webpush.sendNotification(subscription, payload);

    logger.log('✅ Push sent');

    // Log success
    await db.collection('notifications').add({
      userId: call.calleeId,
      callId: callId,
      callerId: call.callerId,
      callerName: callerName,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'sent'
    });

  } catch (error) {
    logger.error('❌ Push error:', error.message);

    // Log error
    await db.collection('notifications').add({
      userId: call.calleeId,
      callId: callId,
      callerId: call.callerId,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'failed',
      error: error.message
    });

    // Remove invalid subscriptions
    if (error.statusCode === 410 || error.statusCode === 404) {
      await db.collection('users').doc(call.calleeId).update({
        pushSubscription: admin.firestore.FieldValue.delete()
      });
    }
  }

  return null;
});

// ==================== HEALTH CHECK ====================
exports.healthCheck = onRequest((req, res) => {
  res.status(200).json({
    status: 'ok',
    time: new Date().toISOString()
  });
});
