// Byte-level BPE tokenizer compatible with tokenizers.json files written by leo-model/leo/tokenizer.py.

type TokenizerJson = {
  added_tokens?: { id: number; content: string; special?: boolean }[];
  model: { vocab: Record<string, number>; merges: (string | [string, string])[] };
};

function bytesToUnicode(): { enc: string[]; dec: Map<string, number> } {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const enc: string[] = new Array(256);
  const dec = new Map<string, number>();
  bs.forEach((b, i) => {
    const ch = String.fromCharCode(cs[i]);
    enc[b] = ch;
    dec.set(ch, b);
  });
  return { enc, dec };
}

// GPT-2 style pre-tokenisation (same pattern the Rust `tokenizers` ByteLevel pre-tokenizer uses).
const SPLIT = new RegExp(
  "'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+",
  "gu"
);

export class LeoTokenizer {
  private vocab: Map<string, number>;
  private idToToken: string[] = [];
  private ranks = new Map<string, number>();
  private byteEnc: string[];
  private byteDec: Map<string, number>;
  private cache = new Map<string, number[]>();
  readonly special: Record<string, number> = {};
  private specialIds = new Set<number>();

  constructor(json: TokenizerJson) {
    this.vocab = new Map(Object.entries(json.model.vocab));
    for (const [token, id] of this.vocab) this.idToToken[id] = token;
    json.model.merges.forEach((m, rank) => {
      const pair = Array.isArray(m) ? `${m[0]} ${m[1]}` : m;
      this.ranks.set(pair, rank);
    });
    for (const t of json.added_tokens ?? []) {
      this.special[t.content] = t.id;
      this.idToToken[t.id] = t.content;
      if (t.special) this.specialIds.add(t.id);
    }
    const { enc, dec } = bytesToUnicode();
    this.byteEnc = enc;
    this.byteDec = dec;
  }

  private bpe(word: string): number[] {
    const hit = this.cache.get(word);
    if (hit) return hit;
    let symbols = Array.from(word);
    while (symbols.length > 1) {
      let bestRank = Infinity;
      let bestIndex = -1;
      for (let i = 0; i < symbols.length - 1; i++) {
        const rank = this.ranks.get(`${symbols[i]} ${symbols[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          bestIndex = i;
        }
      }
      if (bestIndex < 0) break;
      const a = symbols[bestIndex];
      const b = symbols[bestIndex + 1];
      const merged: string[] = [];
      for (let i = 0; i < symbols.length; i++) {
        if (i < symbols.length - 1 && symbols[i] === a && symbols[i + 1] === b) {
          merged.push(a + b);
          i++;
        } else {
          merged.push(symbols[i]);
        }
      }
      symbols = merged;
    }
    const ids = symbols.map((s) => this.vocab.get(s)).filter((id): id is number => id !== undefined);
    if (this.cache.size < 20000) this.cache.set(word, ids);
    return ids;
  }

  encode(text: string): number[] {
    const safe = text.replace(/<\|/g, "< |"); // never parse user text as control tokens
    const ids: number[] = [];
    const bytes = new TextEncoder();
    for (const match of safe.matchAll(SPLIT)) {
      const piece = Array.from(bytes.encode(match[0]), (b) => this.byteEnc[b]).join("");
      ids.push(...this.bpe(piece));
    }
    return ids;
  }

  decode(ids: number[]): string {
    const bytes: number[] = [];
    for (const id of ids) {
      if (this.specialIds.has(id)) continue;
      const token = this.idToToken[id];
      if (!token) continue;
      for (const ch of token) {
        const b = this.byteDec.get(ch);
        if (b !== undefined) bytes.push(b);
      }
    }
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }

  /** Leo chat format: <|role|> text <|end|> ... ending with <|assistant|> to request a reply. */
  encodeChat(messages: { role: string; content: string }[]): number[] {
    const ids: number[] = [];
    for (const m of messages) {
      if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") continue;
      ids.push(this.special[`<|${m.role}|>`], ...this.encode(m.content), this.special["<|end|>"]);
    }
    ids.push(this.special["<|assistant|>"]);
    return ids;
  }
}
