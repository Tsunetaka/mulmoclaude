// Firebase web-app config for the remote-host command channel.
//
// These are the *public* Firebase web-config values for the shared `mulmoserver`
// project (apiKey et al. are not secrets — they identify the project to the
// client SDK; access is gated by Firestore security rules, not by this key).
// Safe to commit. Kept as a pure, side-effect-free constant so both the browser
// init (src/config/firebase.ts) and the Node host init
// (server/remoteHost/firebase.ts) can import it without pulling in either
// runtime's SDK initialization.
export const firebaseConfig = {
  apiKey: "AIzaSyC5IrhcCtfVQ4nZeI89Owa7da_D-It0b9s",
  authDomain: "mulmoserver.firebaseapp.com",
  projectId: "mulmoserver",
  storageBucket: "mulmoserver.firebasestorage.app",
  messagingSenderId: "830257137330",
  appId: "1:830257137330:web:5cb8db01ae61b5d161abab",
  measurementId: "G-Y75JGK1G4T",
} as const;
