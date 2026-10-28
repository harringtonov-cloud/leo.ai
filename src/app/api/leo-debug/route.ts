import { NextResponse } from "next/server";
import { loadLeo } from "@/lib/leo";
import { sampleToken } from "@/lib/leo/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

// Temporary diagnostic: runs a fixed prompt greedily so the output can be compared with PyTorch.
export async function GET() {
  try {
    const { engine, tokenizer } = await loadLeo();
    const ids = tokenizer.encode("Once upon a time there was a little girl named Lily");
    const state = engine.newState();
    let logits: Float32Array | null = null;
    for (let i = 0; i < ids.length; i++) logits = engine.step(state, ids[i], i === ids.length - 1);
    if (!logits) throw new Error("no logits");
    const last: Float32Array = logits;

    const firstLogits = Array.from(last.slice(0, 5));
    const top5 = Array.from({ length: last.length }, (_, i) => i)
      .sort((a, b) => last[b] - last[a])
      .slice(0, 5);

    const greedy: number[] = [];
    let cur: Float32Array | null = last;
    for (let n = 0; n < 20 && cur; n++) {
      const t = sampleToken(cur, 0, 0, 1);
      greedy.push(t);
      cur = engine.step(state, t, true);
    }

    return NextResponse.json({
      weightsUrl: process.env.LEO_WEIGHTS_URL,
      tokenizerUrl: process.env.LEO_TOKENIZER_URL,
      config: engine.config,
      ids,
      firstLogits,
      top5,
      greedyIds: greedy,
      greedyText: tokenizer.decode(greedy),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
