// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBet7Sg-S5lOgEpNck0gj8obX19Se73M1I",
  authDomain: "bluebill-6e532.firebaseapp.com",
  projectId: "bluebill-6e532",
  storageBucket: "bluebill-6e532.firebasestorage.app",
  messagingSenderId: "134661952390",
  appId: "1:134661952390:web:34b8265c9406b8822e9207"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);