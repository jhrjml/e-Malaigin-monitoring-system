// api/process-notification-queue.js
// Runs on a schedule (see vercel.json). Reads pending docs from the
// "NotificationQueue" Firestore collection, sends a Web Push notification
// to every subscribed device for each target parent, then marks the doc
// as processed. Uses the standard Web Push protocol (VAPID) — NOT the
// Firebase Cloud Messaging SDK, so no Blaze plan or billing is involved.
import webpush from "web-push";
import admin from "firebase-admin";

// ── Init firebase-admin once per cold start ────────────────────────────────
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// ── Init web-push with your VAPID keys ──────────────────────────────────────
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

export default async function handler(req, res) {
  // Optional: protect against random public hits if you're not relying
  // solely on Vercel Cron's built-in auth. Vercel Cron requests already
  // carry a special header you can check if you want extra safety:
  // if (req.headers["x-vercel-cron"] !== "1") return res.status(401).end();

  try {
    const queueSnap = await db
      .collection("NotificationQueue")
      .where("status", "==", "pending")
      .limit(50) // safety cap per run
      .get();

    if (queueSnap.empty) {
      return res.status(200).json({ processed: 0 });
    }

    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const queueDoc of queueSnap.docs) {
      const notif = queueDoc.data();
      const parentIds = notif.parentIds || [];

      // Firestore 'in' queries accept at most 10 values — chunk if needed.
      const chunks = [];
      for (let i = 0; i < parentIds.length; i += 10) {
        chunks.push(parentIds.slice(i, i + 10));
      }
      const subDocsArrays = await Promise.all(
        chunks.map((chunk) =>
          db
            .collection("PushSubscriptions")
            .where("parentId", "in", chunk)
            .get()
            .then((snap) => snap.docs),
        ),
      );
      const subDocs = subDocsArrays.flat();

      const sendResults = await Promise.allSettled(
        subDocs.map((subDoc) => {
          const sub = subDoc.data();
          const payload = JSON.stringify({
            title: notif.title,
            body: notif.body,
            url: notif.url || "/",
          });
          return webpush
            .sendNotification(sub.subscription, payload)
            .catch(async (err) => {
              // 410/404 = subscription is dead (user revoked, uninstalled, etc.)
              if (err.statusCode === 410 || err.statusCode === 404) {
                await subDoc.ref.delete();
              }
              throw err;
            });
        }),
      );

      sendResults.forEach((r) =>
        r.status === "fulfilled" ? sent++ : failed++,
      );

      await queueDoc.ref.update({
        status: "sent",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      processed++;
    }

    return res.status(200).json({ processed, sent, failed });
  } catch (err) {
    console.error("process-notification-queue error:", err);
    return res.status(500).json({ error: err.message });
  }
}
