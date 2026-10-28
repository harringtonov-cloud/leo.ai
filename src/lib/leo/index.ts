import { LeoEngine, sampleToken } from "./engine";
import { LeoTokenizer } from "./tokenizer";

type Loaded = { engine: LeoEngine; tokenizer: LeoTokenizer };

let loading: Promise<Loaded> | null = null;

export function leoConfigured(): boolean {
  return Boolean(process.env.LEO_WEIGHTS_URL && process.env.LEO_TOKENIZER_URL);
}

/** Downloads the weights once per server instance and keeps them in memory. */
export function loadLeo(): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      const headers: Record<string, string> = {};
      if (process.env.HF_TOKEN) headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;

      const [weights, tokenizer] = await Promise.all([
        fetch(process.env.LEO_WEIGHTS_URL as string, { headers, signal: AbortSignal.timeout(45_000) }),
        fetch(process.env.LEO_TOKENIZER_URL as string, { headers, signal: AbortSignal.timeout(45_000) }),
      ]);
      if (!weights.ok || !tokenizer.ok) {
        throw new Error(`Could not download the Leo model files (${weights.status}/${tokenizer.status}).`);
      }
      return {
        engine: new LeoEngine(await weights.arrayBuffer()),
        tokenizer: new LeoTokenizer(await tokenizer.json()),
      };
    })().catch((error) => {
      loading = null; // allow a retry on the next request
      throw error;
    });
  }
  return loading;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Streams Leo's reply as text pieces. */
export async function* streamLeo(
  messages: { role: string; content: string }[],
  options: { maxTokens?: number; temperature?: number; topK?: number; topP?: number; deadlineMs?: number } = {}
): AsyncGenerator<string> {
  const { engine, tokenizer } = await loadLeo();
  const block = engine.config.block_size;
  const maxNew = Math.max(1, Math.min(options.maxTokens ?? 200, Math.floor(block / 2)));
  const deadline = Date.now() + (options.deadlineMs ?? 45_000);

  // Leo is small: only recent turns, without the long system prompt of the big models.
  const chat = messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-1);
  const prompt = tokenizer.encodeChat(chat).slice(-(block - maxNew));
  const stop = new Set([tokenizer.special["<|end|>"], tokenizer.special["<|eos|>"]]);

  const state = engine.newState();
  let logits: Float32Array | null = null;
  for (let i = 0; i < prompt.length; i++) {
    logits = engine.step(state, prompt[i], i === prompt.length - 1);
    if (i % 16 === 15) await tick();
  }

  const produced: number[] = [];
  let sent = "";
  for (let n = 0; n < maxNew && logits; n++) {
    const token = sampleToken(logits, options.temperature ?? 0.3, options.topK ?? 20, options.topP ?? 0.9);
    if (stop.has(token)) break;
    produced.push(token);

    const text = tokenizer.decode(produced);
    if (!text.endsWith("�") && text.length > sent.length) {
      yield text.slice(sent.length);
      sent = text;
    }
    if (state.pos >= block || Date.now() > deadline) break;
    logits = engine.step(state, token, true);
    if (n % 4 === 3) await tick();
  }

  const text = tokenizer.decode(produced);
  if (text.length > sent.length) yield text.slice(sent.length);
}
