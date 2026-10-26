"use client";

import { useState } from "react";
import {
  EmailAuthProvider, GoogleAuthProvider, createUserWithEmailAndPassword, linkWithCredential,
  linkWithPopup, signInWithCredential, signInWithEmailAndPassword, signInWithPopup, signOut,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "@/lib/firebase";

function readable(error: unknown) {
  const code = (error as { code?: string })?.code || "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with this email.",
    "auth/email-already-in-use": "This email is already registered. Use “Sign in”.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/popup-closed-by-user": "Sign-in window was closed.",
    "auth/popup-blocked": "The browser blocked the sign-in popup.",
    "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Console.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
  };
  return map[code] || (error instanceof Error ? error.message : "Sign-in failed.");
}

export function AuthModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const anonymous = !user || user.isAnonymous;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  }

  const google = () =>
    run(async () => {
      if (!auth) throw new Error("Firebase is not configured.");
      const provider = new GoogleAuthProvider();
      try {
        if (auth.currentUser?.isAnonymous) await linkWithPopup(auth.currentUser, provider);
        else await signInWithPopup(auth, provider);
      } catch (e) {
        // The Google account already exists: sign into it (guest chats stay in this browser only).
        if ((e as { code?: string }).code === "auth/credential-already-in-use") {
          const credential = GoogleAuthProvider.credentialFromError(e as never);
          if (credential) await signInWithCredential(auth, credential);
          else throw e;
        } else throw e;
      }
    });

  const emailSignUp = () =>
    run(async () => {
      if (!auth) throw new Error("Firebase is not configured.");
      if (auth.currentUser?.isAnonymous) {
        await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email.trim(), password));
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
    });

  const emailSignIn = () =>
    run(async () => {
      if (!auth) throw new Error("Firebase is not configured.");
      await signInWithEmailAndPassword(auth, email.trim(), password);
    });

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Account" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Account</strong>
          <button className="ghost" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!anonymous ? (
          <>
            <p>Signed in as <strong>{user?.email || user?.displayName || "your account"}</strong>. Your chats, projects and memory sync across devices.</p>
            <button className="secondary" disabled={busy} onClick={() => run(async () => { if (auth) await signOut(auth); })}>Sign out</button>
          </>
        ) : (
          <>
            <p className="small">You are using a guest session. Sign in to keep your chats, projects and memory across devices.</p>
            <button className="primary" disabled={busy} onClick={() => void google()}>Continue with Google</button>
            <div className="small" style={{ textAlign: "center", margin: "10px 0" }}>or use email</div>
            <input className="field" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="field" type="password" autoComplete="current-password" placeholder="Password (min. 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="actions">
              <button className="secondary" disabled={busy || !email || !password} onClick={() => void emailSignIn()}>Sign in</button>
              <button className="secondary" disabled={busy || !email || !password} onClick={() => void emailSignUp()}>Create account</button>
            </div>
          </>
        )}

        {error && <p className="small" style={{ color: "var(--err)" }} role="alert">{error}</p>}
      </div>
    </div>
  );
}
