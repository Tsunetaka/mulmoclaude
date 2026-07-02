// Firebase credential exchange for the remote-host runner.
//
// The server authenticates to Firestore *as the user* (Option B) using the
// Firebase JS SDK's signInWithCredential with a browser-minted Google OAuth ID
// token — no Admin SDK, no project service account. Security rules keep the
// server scoped to that user's own users/{uid}/… subtree.
//
// This module is the low-level credential primitive; the connect/disconnect
// lifecycle (which also starts/stops the host runner) lives in index.ts.
import { GoogleAuthProvider, signInWithCredential, signOut } from "firebase/auth";

import { auth } from "./firebase.js";

/**
 * Establish the Firebase session from a browser-minted Google OAuth ID token.
 * The token is used once here; the JS SDK then holds its own refresh token for
 * the process lifetime. Returns the authenticated uid.
 */
export const signInHost = async (idToken: string): Promise<string> => {
  const credential = GoogleAuthProvider.credential(idToken);
  const userCredential = await signInWithCredential(auth, credential);
  return userCredential.user.uid;
};

/** Tear down the Firebase session (in-memory persistence → re-login on restart). */
export const signOutHost = (): Promise<void> => signOut(auth);

/** The currently signed-in uid, or null when disconnected. */
export const currentUid = (): string | null => auth.currentUser?.uid ?? null;
