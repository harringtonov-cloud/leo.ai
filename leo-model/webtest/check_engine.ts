// Run with: node --experimental-strip-types check_engine.ts leo_test.bin expected.json
import { readFileSync } from "node:fs";
import { LeoEngine } from "../../src/lib/leo/engine.ts";

const bin = readFileSync(process.argv[2]);
const expected = JSON.parse(readFileSync(process.argv[3], "utf8"));
const engine = new LeoEngine(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
const state = engine.newState();
let maxDiff = 0;
let last: Float32Array | null = null;
expected.tokens.forEach((t: number, i: number) => {
  const logits = engine.step(state, t, true) as Float32Array;
  last = logits;
  const ref: number[] | null = i === 0 ? expected.all_last[0] : i === 5 ? expected.all_last[1] : i === expected.tokens.length - 1 ? expected.last_logits : null;
  if (ref) for (let j = 0; j < ref.length; j++) maxDiff = Math.max(maxDiff, Math.abs(ref[j] - logits[j]));
});
console.log("max |js - reference| =", maxDiff.toExponential(2));
if (!(maxDiff < 2e-3)) { console.error("MISMATCH"); process.exit(1); }
console.log("engine OK, vocab", (last as unknown as Float32Array).length);
