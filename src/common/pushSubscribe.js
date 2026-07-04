// src/common/pushSubscribe.js
import { savePushSubscription } from "../api/firebaseApi";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(parentId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "denied" };
  }

  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        import.meta.env.VITE_VAPID_PUBLIC_KEY,
      ),
    });
  }

  await savePushSubscription(parentId, subscription.toJSON());
  return { ok: true };
}

export async function isPushSubscribed() {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

// ADD this function to src/common/pushSubscribe.js, alongside your existing
// subscribeToPush() and isPushSubscribed() functions.
//
// Also add `deletePushSubscription` to your imports from "../api/firebaseApi"
// at the top of the file:
//
//   import { savePushSubscription, deletePushSubscription } from "../api/firebaseApi";

export async function unsubscribeFromPush() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return; // nothing to unsubscribe

    const endpoint = subscription.endpoint;

    // Unsubscribe at the browser level first — this is what actually stops
    // the browser's push service from delivering anything further.
    await subscription.unsubscribe();

    // Then remove the matching Firestore record so the server stops
    // trying to send to a subscription that no longer exists.
    await deletePushSubscription(endpoint);
  } catch (err) {
    console.error("Failed to unsubscribe from push:", err);
    // Don't let this block logout even if it fails.
  }
}
