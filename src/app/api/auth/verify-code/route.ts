import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { adminApp } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_ATTEMPTS = 5;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(request: Request) {
  try {
    let body: { email?: unknown; code?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!email || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
    }

    const app = adminApp();
    const db = getFirestore(app);
    const ref = db.collection("loginCodes").doc(sha(email));

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "invalid" as const;

      const data = snap.data() as {
        hash: string;
        salt: string;
        expiresAt: number;
        attempts: number;
      };

      if (Date.now() > data.expiresAt) {
        tx.delete(ref);
        return "expired" as const;
      }

      if (data.attempts >= MAX_ATTEMPTS) {
        tx.delete(ref);
        return "locked" as const;
      }

      if (!safeEqual(sha(`${data.salt}:${code}`), data.hash)) {
        tx.update(ref, { attempts: data.attempts + 1 });
        return "invalid" as const;
      }

      tx.delete(ref);
      return "ok" as const;
    });

    if (outcome === "expired") {
      return NextResponse.json({ error: "The code expired. Request a new one." }, { status: 400 });
    }
    if (outcome === "locked") {
      return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
    }
    if (outcome === "invalid") {
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    const auth = getAuth(app);
    let uid: string;
    try {
      uid = (await auth.getUserByEmail(email)).uid;
    } catch (error) {
      if ((error as { code?: string })?.code === "auth/user-not-found") {
        uid = (await auth.createUser({ email, emailVerified: true })).uid;
      } else {
        throw error;
      }
    }

    const token = await auth.createCustomToken(uid);
    return NextResponse.json({ token, uid });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    if (/not configured/.test(message)) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    if (/NOT_FOUND|PERMISSION_DENIED|Cloud Firestore API/i.test(message)) {
      return NextResponse.json(
        { error: "Firestore is not enabled for this Firebase project. Create a Firestore database in the Firebase console." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not verify the code." }, { status: 500 });
  }
}
