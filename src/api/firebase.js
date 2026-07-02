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
