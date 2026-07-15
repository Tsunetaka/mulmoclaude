// Firebase credential exchange for the remote-host runner.
//
// The host authenticates to Firestore *as the user* (Option B) using the
// Firebase JS SDK's signInWithCredential with a browser-minted Google OAuth ID
// token — no Admin SDK, no project service account. Security rules keep the host
// scoped to that user's own users/{uid}/… subtree.
//
// Extracted into core from MulmoClaude's server/remoteHost/auth.ts. The `auth`
// instance is a parameter so each host binds its own Firebase init; the factory
// returns the low-level credential primitives (the connect/disconnect lifecycle
// that starts/stops the host runner lives in createRemoteHost).
import { Auth, GoogleAuthProvider, signInWithCredential, signOut } from "firebase/auth";

export interface RemoteHostAuth {
  // Establish the Firebase session from a browser-minted Google OAuth ID token.
  // The token is used once here; the JS SDK then holds its own refresh token for
  // the process lifetime. Resolves to the authenticated uid.
  signInHost: (idToken: string) => Promise<string>;
  // Tear down the Firebase session (in-memory persistence → re-login on restart).
  signOutHost: () => Promise<void>;
  // The currently signed-in uid, or null when disconnected.
  currentUid: () => string | null;
}

export const createRemoteHostAuth = (auth: Auth): RemoteHostAuth => ({
  signInHost: async (idToken: string): Promise<string> => {
    const credential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, credential);
    return userCredential.user.uid;
  },
  signOutHost: (): Promise<void> => signOut(auth),
  currentUid: (): string | null => auth.currentUser?.uid ?? null,
});
