// src/common/NotificationQueueSync.jsx
// Closes the "offline at the moment of the action" gap. queueNotification()
// already fires an immediate trigger when the teacher is online at the
// moment they post/scan — this component handles the other case: if they
// were offline, that immediate call failed silently, and the queued
// notification would otherwise sit until the once-daily cron fallback.
//
// This listens for the browser's `online` event ANYWHERE in the app (it's
// mounted once in App.jsx, so it's active regardless of which role —
// admin/teacher/parent — happens to be the one reconnecting) and re-fires
// the same endpoint the moment connectivity returns, plus once on initial
// load in case something was left pending from a previous session.
//
// Renders nothing — purely a background effect.
import { useEffect, useRef } from "react";

const MIN_INTERVAL_MS = 5000; // avoid double-firing on flappy connections

export default function NotificationQueueSync() {
  const lastFiredRef = useRef(0);

  useEffect(() => {
    const trigger = () => {
      const now = Date.now();
      if (now - lastFiredRef.current < MIN_INTERVAL_MS) return;
      lastFiredRef.current = now;

      fetch("/api/process-notification-queue").catch(() => {
        // Still offline, or dev environment without /api — safe to ignore.
        // The once-daily cron remains the final fallback.
      });
    };

    // Catch anything left pending from a previous offline session.
    if (navigator.onLine) trigger();

    window.addEventListener("online", trigger);
    return () => window.removeEventListener("online", trigger);
  }, []);

  return null;
}
