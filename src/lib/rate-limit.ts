import { adminDb } from "@/lib/auth-server";

/**
 * Two layers of protection:
 *  1. Per-instance sliding window (cheap, stops bursts).
 *  2. Per-user daily counter in Firestore (survives serverless restarts).
 * Both are configurable through env vars. If Firestore is unreachable the daily check is skipped
 * (fail-open) so a database hiccup does not take the whole app down; the burst limiter still applies.
 */

const windows = new Map<string, number[]>();

function intEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export class RateLimitError extends Error {
  status = 429;
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export async function enforceLimits(uid: string, bucket: "chat" | "sandbox" | "title" = "chat") {
  const perMinute = bucket === "chat" ? intEnv("RATE_LIMIT_PER_MINUTE", 20) : bucket === "sandbox" ? intEnv("SANDBOX_LIMIT_PER_MINUTE", 6) : 15;
  const perDay = bucket === "chat" ? intEnv("RATE_LIMIT_PER_DAY", 300) : bucket === "sandbox" ? intEnv("SANDBOX_LIMIT_PER_DAY", 60) : 300;

  const now = Date.now();
  const key = `${bucket}:${uid}`;
  const recent = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= perMinute) {
    throw new RateLimitError("Too many requests. Please wait a minute and try again.");
  }
  recent.push(now);
  windows.set(key, recent);

  // Keep the map from growing without bound on long-lived instances.
  if (windows.size > 5000) {
    for (const [k, v] of windows) {
      if (!v.some((t) => now - t < 60_000)) windows.delete(k);
    }
  }

  try {
    const day = new Date(now).toISOString().slice(0, 10);
    const ref = adminDb().collection("usage").doc(`${bucket}_${uid}_${day}`);
    const db = adminDb();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.exists ? (snap.data()?.count as number) : 0) || 0;
      if (count >= perDay) {
        throw new RateLimitError("Daily request limit reached. Try again tomorrow.");
      }
      tx.set(ref, { uid, bucket, day, count: count + 1, updatedAt: now }, { merge: true });
    });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    console.error("Daily limit check skipped:", error instanceof Error ? error.message : error);
  }
}
