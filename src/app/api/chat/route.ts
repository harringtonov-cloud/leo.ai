import { NextResponse } from "next/server";
import { leoConfigured, loadLeo, streamLeo } from "@/lib/leo";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  try {
    await requireUser(request);

    let body: { messages?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const messages = body.messages as ChatMessage[];
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) {
      return NextResponse.json({ error: "Send between 1 and 30 messages." }, { status: 400 });
    }
    if (messages.some(m => !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 20_000)) {
      return NextResponse.json({ error: "Invalid message format or message too long." }, { status: 400 });
    }

    // Leo is the only model: our own weights running inside this server (see leo-model/).
    if (!leoConfigured()) {
      return NextResponse.json({ error: "Leo model is not configured (LEO_WEIGHTS_URL and LEO_TOKENIZER_URL)." }, { status: 503 });
    }
    try {
      await loadLeo();
    } catch (loadError) {
      return NextResponse.json({ error: loadError instanceof Error ? loadError.message : "Could not load the Leo model." }, { status: 502 });
    }

    const encoder = new TextEncoder();
    const leoStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const piece of streamLeo(messages)) controller.enqueue(encoder.encode(piece));
        } catch (streamError) {
          controller.enqueue(encoder.encode(`\n\n[Error: ${streamError instanceof Error ? streamError.message : "Leo failed"}]`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(leoStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Leo-Model": "leo (own model)",
        "X-Leo-Task": "chat"
      }
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return NextResponse.json({ error: "The model took too long to respond. Please try again." }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    const status = /not configured/.test(message) ? 503 : /Sign in|ID token|Firebase/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
