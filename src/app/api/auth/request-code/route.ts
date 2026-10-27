import { NextResponse } from "next/server";
import { createHash, randomBytes, randomInt } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(request: Request) {
  try {
    let body: { email?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "Email sending is not configured (RESEND_API_KEY is missing)." }, { status: 503 });
    }

    const db = getFirestore(adminApp());
    const ref = db.collection("loginCodes").doc(sha(email));
    const existing = await ref.get();
    const now = Date.now();

    if (existing.exists && now - Number(existing.data()?.sentAt ?? 0) < RESEND_COOLDOWN_MS) {
      return NextResponse.json({ error: "Please wait a minute before requesting another code." }, { status: 429 });
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const salt = randomBytes(16).toString("hex");

    await ref.set({
      hash: sha(`${salt}:${code}`),
      salt,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      sentAt: now,
    });

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Leo AI <onboarding@resend.dev>",
        to: [email],
        subject: `Your Leo AI sign-in code: ${code}`,
        text: `Your Leo AI sign-in code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:420px"><h2 style="margin:0 0 12px">Leo AI</h2><p>Your sign-in code:</p><p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:8px 0">${code}</p><p style="color:#666">It expires in 10 minutes. If you did not request it, ignore this email.</p></div>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      await ref.delete().catch(() => {});
      const data = await response.json().catch(() => null);
      return NextResponse.json(
        { error: data?.message || "Could not send the email. Check the email provider settings." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
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
    return NextResponse.json({ error: "Could not send the code." }, { status: 500 });
  }
}
