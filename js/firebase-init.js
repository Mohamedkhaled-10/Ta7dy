// js/firebase-init.js
// تهيئة Firebase - استخدم النسخة المودولار من Firebase (v9+)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDMMu-QNPL6RlGYdGGQVJLzZqCC_hsLa8I",
  authDomain: "night-ac2a0.firebaseapp.com",
  databaseURL: "https://night-ac2a0-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "night-ac2a0",
  storageBucket: "night-ac2a0.firebasestorage.app",
  messagingSenderId: "202751732517",
  appId: "1:202751732517:web:5d458d19aac8d7135848cc"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// Export objects for app.js
export { app, db, auth, signInAnonymously };
