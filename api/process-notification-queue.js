// api/process-notification-queue.js
import webpush from "web-push";
import admin from "firebase-admin";

// ── Validate required env vars up front with a CLEAR error ─────────────────
// Prevents cryptic "Cannot read properties of undefined" crashes further
// down — if something's missing, this tells you exactly what and where.
const REQUIRED_ENV = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "FIREBASE_SERVICE_ACCOUNT",
];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

// ── Init firebase-admin once per cold start ────────────────────────────────
if (!admin.apps.length && missingEnv.length === 0) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = missingEnv.length === 0 ? admin.firestore() : null;

// ── Init web-push with your VAPID keys ──────────────────────────────────────
if (missingEnv.length === 0) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export default async function handler(req, res) {
  // Fail loudly and clearly instead of crashing on an undefined value later.
  if (missingEnv.length > 0) {
    console.error(
      `process-notification-queue: missing env var(s): ${missingEnv.join(", ")}. ` +
        `Check Vercel → Settings → Environment Variables and confirm each is ` +
        `set for the Production environment, then redeploy.`,
    );
    return res.status(500).json({
      error: "Missing required environment variable(s)",
      missing: missingEnv,
    });
  }

  try {
    const queueSnap = await db
      .collection("NotificationQueue")
      .where("status", "==", "pending")
      .limit(50)
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
