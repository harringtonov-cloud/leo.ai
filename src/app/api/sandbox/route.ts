import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { enforceLimits, RateLimitError } from "@/lib/rate-limit";
import { MAX_CODE_LENGTH, runPython } from "@/lib/sandbox";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => null);
    const code = body?.code;

    if (typeof code !== "string" || !code.trim() || code.length > MAX_CODE_LENGTH) {
      return NextResponse.json({ error: `Code must be 1–${MAX_CODE_LENGTH} characters.` }, { status: 400 });
    }
    if (!process.env.E2B_API_KEY) {
      return NextResponse.json({ error: "E2B_API_KEY is not configured." }, { status: 503 });
    }

    await enforceLimits(user.uid, "sandbox");
    const result = await runPython(code);
    return NextResponse.json({ userId: user.uid, ...result });
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    const message = error instanceof Error ? error.message : "Sandbox failed";
    const status = /Sign in|ID token|Firebase|auth/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
