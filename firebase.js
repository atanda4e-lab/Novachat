import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import {
    getStorage
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";


const firebaseConfig = {
    apiKey: "AIzaSyCziviF8fY-eSx4QHbEpTBLw9bHTBPdaj8",
    authDomain: "novachat-app-d4c1a.firebaseapp.com",
    projectId: "novachat-app-d4c1a",
    storageBucket: "novachat-app-d4c1a.firebasestorage.app",
    messagingSenderId: "141566433737",
    appId: "1:141566433737:web:67130c4dd27ddcfae6f018"
};


// Start Firebase
const app = initializeApp(firebaseConfig);


// Authentication
const auth = getAuth(app);


// Database
const db = getFirestore(app);


// Profile image storage
const storage = getStorage(app);


// Export everything for script.js
export {
    app,
    auth,
    db,
    storage
};