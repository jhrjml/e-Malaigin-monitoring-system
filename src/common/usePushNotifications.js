import { useEffect } from "react";
import { subscribeToPush } from "./pushSubscribe";

export default function usePushNotifications() {
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    const role = localStorage.getItem("role"); // ADD

    if (!userId) return;
    if (role !== "Parent") return; // ADD — teachers/admins never subscribe
    if (!("Notification" in window)) return;
    if (Notification.permission === "denied") return;

    subscribeToPush(userId).catch((err) => {
      console.error("Push subscription failed:", err);
    });
  }, []);
}
