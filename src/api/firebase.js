// firebase.js
// ─────────────────────────────────────────────────────────────────────────────
// Replace the placeholder values below with your actual Firebase project config.
// Get them from: Firebase Console → Project Settings → Your Apps → SDK setup
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics"; // Added missing import!

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCaNSjnSjXmckEy5XA68bKjamjXKKq3LwM",
  authDomain: "e-malaigin.firebaseapp.com",
  projectId: "e-malaigin",
  storageBucket: "e-malaigin.firebasestorage.app",
  messagingSenderId: "94818727115",
  appId: "1:94818727115:web:ca0b042acfe7f21df7974e",
  measurementId: "G-JHR9N88FSB",
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Analytics
const analytics = getAnalytics(app);

// Initialize and EXPORT Firestore Database instance
// export const db = getFirestore(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(), // Allows offline synchronization across multiple open tabs
  }),
});

// Messaging is only available in browsers that support service workers
export const messagingPromise = isSupported().then((supported) =>
  supported ? getMessaging(app) : null,
);

//New one
// 1. Safe App Initialization (prevents re-init crashes on HMR)
/*const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// 2. Safe Firestore Initialization with your Tab-Caching settings
let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (error) {
  // If Vite reloads and it's already initialized, gracefully fall back to the active instance
  dbInstance = getFirestore(app);
}

export const db = dbInstance;*/
