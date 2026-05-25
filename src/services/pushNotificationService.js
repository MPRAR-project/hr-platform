/**
 * pushNotificationService.js — Web Push Subscription Manager
 *
 * Usage (call once after login, e.g. in AuthContext):
 *   import { initPushNotifications } from '../services/pushNotificationService';
 *   await initPushNotifications();
 *
 * Requirements (backend):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL env vars must be set.
 *   Install: npm install web-push (in hr-backend)
 *
 * Generate VAPID keys once:
 *   npx web-push generate-vapid-keys
 */

import hrApiClient from '../lib/hrApiClient';

const SW_PATH = '/sw.js';

// ── Register the service worker ───────────────────────────────────────────────
async function _registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH);
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.warn('[push] Service worker registration failed:', err.message);
    return null;
  }
}

// ── Fetch VAPID public key from the backend ───────────────────────────────────
async function _getVapidKey() {
  try {
    const { data } = await hrApiClient.get('/hr/billing/push/vapid-key');
    return data.publicKey;
  } catch {
    return null;
  }
}

// ── Convert URL-safe base64 to Uint8Array (required by pushManager.subscribe) ─
function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Send the PushSubscription to the backend ──────────────────────────────────
async function _saveSubscription(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  await hrApiClient.post('/hr/billing/push/subscribe', { endpoint, keys });
}

// ── Remove the PushSubscription from the backend ─────────────────────────────
async function _removeSubscription(subscription) {
  const { endpoint } = subscription.toJSON();
  await hrApiClient.delete('/hr/billing/push/subscribe', { data: { endpoint } }).catch(() => {});
}

// ── Main entry point — call after login ──────────────────────────────────────
export async function initPushNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) return;

  const vapidKey = await _getVapidKey();
  if (!vapidKey) return; // Push not configured on this server

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const reg = await _registerSW();
  if (!reg) return;

  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: _urlBase64ToUint8Array(vapidKey),
      });
    }
    await _saveSubscription(sub);
    console.log('[push] Push notifications enabled');
  } catch (err) {
    console.warn('[push] Failed to subscribe:', err.message);
  }
}

// ── Unsubscribe (call on logout) ──────────────────────────────────────────────
export async function disablePushNotifications() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await _removeSubscription(sub);
      await sub.unsubscribe();
    }
  } catch (err) {
    console.warn('[push] Failed to unsubscribe:', err.message);
  }
}
