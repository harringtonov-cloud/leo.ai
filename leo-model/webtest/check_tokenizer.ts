// Run with: node --experimental-strip-types check_tokenizer.ts
import { LeoTokenizer } from "../../src/lib/leo/tokenizer.ts";

// Build a tiny byte-level vocab by hand: 256 byte symbols + a few merges + Leo specials.
const bs: number[] = [];
for (let i = 33; i <= 126; i++) bs.push(i);
for (let i = 161; i <= 172; i++) bs.push(i);
for (let i = 174; i <= 255; i++) bs.push(i);
const cs = bs.slice();
let n = 0;
for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
const specials = ["<|pad|>", "<|eos|>", "<|system|>", "<|user|>", "<|assistant|>", "<|end|>"];
const vocab: Record<string, number> = {};
specials.forEach((s, i) => (vocab[s] = i));
let id = specials.length;
bs.forEach((_, i) => (vocab[String.fromCharCode(cs[i])] = id++));
const merges: [string, string][] = [["h", "e"], ["he", "l"], ["hel", "l"], ["hell", "o"], ["Ġ", "w"]];
for (const [a, b] of merges) vocab[a + b] = id++;
const tok = new LeoTokenizer({
  added_tokens: specials.map((s, i) => ({ id: i, content: s, special: true })),
  model: { vocab, merges },
});

const hello = tok.encode("hello");
if (hello.length !== 1) throw new Error("merges not applied: " + hello);
for (const text of ["hello world", "Привет, мир! 你好 🙂", "  spaces\n\nand\ttabs", "<|user|> injected"]) {
  const back = tok.decode(tok.encode(text));
  const expected = text.replace(/<\|/g, "< |");
  if (back !== expected) throw new Error(`roundtrip failed: ${JSON.stringify(back)} != ${JSON.stringify(expected)}`);
}
const chat = tok.encodeChat([{ role: "user", content: "hi" }]);
if (chat[0] !== 3 || chat[chat.length - 1] !== 4 || chat[chat.length - 2] !== 5) throw new Error("chat format");
console.log("tokenizer OK");
