importScripts(
  "https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js",
);

firebase.initializeApp({
  apiKey: "AIzaSyCaNSjnSjXmckEy5XA68bKjamjXKKq3LwM",
  authDomain: "e-malaigin.firebaseapp.com",
  projectId: "e-malaigin",
  storageBucket: "e-malaigin.firebasestorage.app",
  messagingSenderId: "94818727115",
  appId: "1:94818727115:web:ca0b042acfe7f21df7974e",
  measurementId: "G-JHR9N88FSB",
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: "/logo-circle.png",
    badge: "/logo-circle.png", // small icon on Android status bar
    vibrate: [200, 100, 200], // vibration pattern on mobile
    tag: "e-malaigin", // replaces previous notification instead of stacking
  });
});
