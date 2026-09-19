// Copy to firebase.js and fill in. firebase.js is gitignored.
//
// Get these from: Firebase console -> Project settings -> General
// -> Your apps -> Web app -> "SDK setup and configuration" -> Config.
//
// These values are NOT secret; they ship in the JS bundle by design.
// firestore.rules is what protects the data.
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Every Firestore rule requires request.auth, so sign in before anything else.
// Anonymous sign-in must be enabled in the console:
//   Authentication -> Sign-in method -> Anonymous -> Enable
signInAnonymously(auth).catch((e) => {
  console.error('Anonymous sign-in failed - Firestore will deny everything.', e);
});

// Local emulator only. Requires Java. Set REACT_APP_USE_EMULATOR=true in
// .env.development.local, never in a file that a production build reads.
if (process.env.REACT_APP_USE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export { db, auth };
