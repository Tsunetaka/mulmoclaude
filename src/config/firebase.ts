// Browser-side Firebase init for the remote-host settings page.
//
// Initializes the Firebase web app and exposes the Auth instance used by the
// SettingsRemoteHostTab to run the Google sign-in popup and extract the Google
// OAuth idToken (which is then POSTed to the server's /connect route).
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

import { firebaseConfig } from "./firebaseConfig";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
