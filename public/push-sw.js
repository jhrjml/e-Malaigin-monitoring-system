// public/push-sw.js
// Pulled into the auto-generated service worker via Workbox's
// `importScripts` option (see vite.config.js patch). Must be plain,
// non-module JS — importScripts doesn't support ES modules.

self.addEventListener("push", (event) => {
  let data = { title: "New notification", body: "", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    // payload wasn't JSON — fall back to defaults
  }

  const options = {
    body: data.body,
    icon: "/school-logo-192x192.png",
    badge: "/school-logo-192x192.png",
    data: { url: data.url || "/" },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
