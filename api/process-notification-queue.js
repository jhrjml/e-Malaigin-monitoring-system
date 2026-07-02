// api/process-notification-queue.js
import webpush from "web-push";
// Modular firebase-admin API (sub-path imports) instead of the classic
// `import admin from "firebase-admin"` default import — the default-import
// style doesn't reliably resolve `.apps` in Vercel's Node ESM runtime due
// to a CommonJS/ESM interop quirk in how the package is bundled. The
// modular API sidesteps that entirely and is Firebase's own recommended
// pattern for serverless/ESM environments.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

let initError = null;
let db = null;

try {
  const REQUIRED_ENV = [
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "FIREBASE_SERVICE_ACCOUNT",
  ];
  const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingEnv.join(", ")}`,
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (parseErr) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${parseErr.message}. ` +
        `Make sure the ENTIRE contents of the downloaded service account ` +
        `JSON file were pasted as-is into the Vercel env var.`,
    );
  }

  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  db = getFirestore();

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
} catch (err) {
  initError = err.message;
  console.error("process-notification-queue init error:", err);
}

export default async function handler(req, res) {
  if (initError) {
    return res
      .status(500)
      .json({ error: "Initialization failed", detail: initError });
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
        processedAt: FieldValue.serverTimestamp(),
      });
      processed++;
    }

    return res.status(200).json({ processed, sent, failed });
  } catch (err) {
    console.error("process-notification-queue runtime error:", err);
    return res.status(500).json({ error: err.message });
  }
}
