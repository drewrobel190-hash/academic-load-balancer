// Firebase SDK imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firebase config
 const firebaseConfig = {
    apiKey: "AIzaSyBPf1LA9kOun-QiNakgtP0cq5j7wJMf2dQ",
    authDomain: "academic-load-balancer.firebaseapp.com",
    projectId: "academic-load-balancer",
    storageBucket: "academic-load-balancer.firebasestorage.app",
    messagingSenderId: "620526341303",
    appId: "1:620526341303:web:13ff7a022ae699cf019132"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);