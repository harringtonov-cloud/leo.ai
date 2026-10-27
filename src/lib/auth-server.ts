import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export function adminApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase server authentication is not configured.");
  const serviceAccount = JSON.parse(raw);
  return getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
}

function adminAuth() {
  return getAuth(adminApp());
}

export async function requireUser(request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Sign in required.");
  return adminAuth().verifyIdToken(token);
}
