// Node-side Firebase init for the remote-host runner.
//
// The MulmoClaude server acts as a *host*: it signs in to Firebase as the user
// (via signInWithCredential, see auth.ts) and listens to that user's command
// queue in Firestore. The modular firebase/firestore + firebase/auth SDKs run
// in Node, so this mirrors the browser init but also exposes Firestore (default
// database, which must be in Native mode).
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

import { firebaseConfig } from "../../src/config/firebaseConfig.js";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
