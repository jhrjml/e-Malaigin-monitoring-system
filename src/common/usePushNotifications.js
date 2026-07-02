// src/common/usePushNotifications.js
// Fills in the exact spot already marked in ParentDashboard.jsx:
//   // usePushNotifications(); // ← This is the only change to this file
// Uncomment that line and add the import below it — that's the entire
// integration for the parent side.
import { useEffect } from "react";
import { subscribeToPush } from "./pushSubscribe";

export default function usePushNotifications() {
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    if (!("Notification" in window)) return;
    // Don't re-prompt every visit if the parent already said no —
    // browsers won't show the prompt again anyway, this just skips the
    // wasted subscribe attempt.
    if (Notification.permission === "denied") return;

    subscribeToPush(userId).catch((err) => {
      console.error("Push subscription failed:", err);
    });
  }, []);
}
