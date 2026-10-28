// Leo language model inference in plain TypeScript (no native dependencies).
// Mirrors leo-model/leo/model.py: RMSNorm, RoPE (half-split), grouped-query attention, SwiGLU, tied embeddings.
// Weights file (leo.bin, written by leo-model/export_web.py):
//   "LEO1" | uint32 headerLen (multiple of 8) | JSON header | float16 tensor data

export type LeoConfig = {
  vocab_size: number;
  block_size: number;
  n_layer: number;
  n_head: number;
  n_kv_head: number;
  n_embd: number;
  ffn_mult: number;
  rope_theta: number;
};

type TensorInfo = { shape: number[]; offset: number; length: number };

type LayerWeights = {
  norm1: Float32Array;
  q: Float32Array;
  k: Float32Array;
  v: Float32Array;
  o: Float32Array;
  norm2: Float32Array;
  w1: Float32Array;
  w3: Float32Array;
  w2: Float32Array;
};

let halfTable: Float32Array | null = null;

function getHalfTable(): Float32Array {
  if (halfTable) return halfTable;
  const table = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    let value: number;
    if (exp === 0) value = sign * Math.pow(2, -14) * (frac / 1024);
    else if (exp === 31) value = frac ? NaN : sign * Infinity;
    else value = sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
    table[h] = value;
  }
  halfTable = table;
  return table;
}

/** y[o] = sum_i W[o*inDim + i] * x[i]  (PyTorch Linear layout: weight is [out, in]). */
function matvec(W: Float32Array, x: Float32Array, out: Float32Array, outDim: number, inDim: number) {
  for (let o = 0; o < outDim; o++) {
    let sum = 0;
    const base = o * inDim;
    for (let i = 0; i < inDim; i++) sum += W[base + i] * x[i];
    out[o] = sum;
  }
}

function rmsnorm(x: Float32Array, weight: Float32Array, out: Float32Array, eps = 1e-5) {
  let ss = 0;
  for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const scale = 1 / Math.sqrt(ss / x.length + eps);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * scale * weight[i];
}

export class LeoEngine {
  readonly config: LeoConfig;
  private emb: Float32Array;
  private normF: Float32Array;
  private layers: LayerWeights[] = [];
  private ropeCos: Float32Array;
  private ropeSin: Float32Array;
  private headDim: number;
  private hidden: number;

  constructor(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (magic !== "LEO1") throw new Error("Invalid Leo weights file.");
    const headerLen = view.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLen)));
    const dataStart = 8 + headerLen;
    const table = getHalfTable();
    const tensors = header.tensors as Record<string, TensorInfo>;

    const load = (name: string): Float32Array => {
      const info = tensors[name];
      if (!info) throw new Error(`Missing tensor ${name}`);
      const half = new Uint16Array(buffer, dataStart + info.offset, info.length);
      const out = new Float32Array(info.length);
      for (let i = 0; i < info.length; i++) out[i] = table[half[i]];
      return out;
    };

    this.config = header.config as LeoConfig;
    const c = this.config;
    this.headDim = c.n_embd / c.n_head;
    this.hidden = tensors["blocks.0.mlp.w1.weight"].shape[0];
    this.emb = load("tok_emb.weight");
    this.normF = load("norm_f.weight");
    for (let l = 0; l < c.n_layer; l++) {
      const p = `blocks.${l}.`;
      this.layers.push({
        norm1: load(p + "norm1.weight"),
        q: load(p + "attn.q.weight"),
        k: load(p + "attn.k.weight"),
        v: load(p + "attn.v.weight"),
        o: load(p + "attn.o.weight"),
        norm2: load(p + "norm2.weight"),
        w1: load(p + "mlp.w1.weight"),
        w3: load(p + "mlp.w3.weight"),
        w2: load(p + "mlp.w2.weight"),
      });
    }

    const half = this.headDim / 2;
    this.ropeCos = new Float32Array(c.block_size * half);
    this.ropeSin = new Float32Array(c.block_size * half);
    for (let t = 0; t < c.block_size; t++) {
      for (let i = 0; i < half; i++) {
        const freq = 1 / Math.pow(c.rope_theta, (2 * i) / this.headDim);
        this.ropeCos[t * half + i] = Math.cos(t * freq);
        this.ropeSin[t * half + i] = Math.sin(t * freq);
      }
    }
  }

  /** Create an empty KV cache for one conversation. */
  newState() {
    const c = this.config;
    const size = c.block_size * c.n_kv_head * this.headDim;
    return {
      pos: 0,
      k: Array.from({ length: c.n_layer }, () => new Float32Array(size)),
      v: Array.from({ length: c.n_layer }, () => new Float32Array(size)),
    };
  }

  /** Feed one token at the state's position. Returns logits (or null when wantLogits is false). */
  step(state: ReturnType<LeoEngine["newState"]>, token: number, wantLogits: boolean): Float32Array | null {
    const c = this.config;
    const d = c.n_embd;
    const hd = this.headDim;
    const nh = c.n_head;
    const nkv = c.n_kv_head;
    const rep = nh / nkv;
    const half = hd / 2;
    const pos = state.pos;
    if (pos >= c.block_size) throw new Error("Context is full.");

    const x = this.emb.slice(token * d, (token + 1) * d);
    const h = new Float32Array(d);
    const q = new Float32Array(nh * hd);
    const k = new Float32Array(nkv * hd);
    const v = new Float32Array(nkv * hd);
    const att = new Float32Array(nh * hd);
    const proj = new Float32Array(d);
    const a = new Float32Array(this.hidden);
    const b = new Float32Array(this.hidden);
    const scores = new Float32Array(pos + 1);
    const cosRow = pos * half;
    const scale = 1 / Math.sqrt(hd);

    for (let l = 0; l < c.n_layer; l++) {
      const W = this.layers[l];
      rmsnorm(x, W.norm1, h);
      matvec(W.q, h, q, nh * hd, d);
      matvec(W.k, h, k, nkv * hd, d);
      matvec(W.v, h, v, nkv * hd, d);

      for (let head = 0; head < nh; head++) this.rope(q, head * hd, cosRow, half);
      for (let head = 0; head < nkv; head++) this.rope(k, head * hd, cosRow, half);

      const kc = state.k[l];
      const vc = state.v[l];
      const stride = nkv * hd;
      kc.set(k, pos * stride);
      vc.set(v, pos * stride);

      for (let head = 0; head < nh; head++) {
        const kvh = Math.floor(head / rep);
        const qo = head * hd;
        let max = -Infinity;
        for (let t = 0; t <= pos; t++) {
          const ko = t * stride + kvh * hd;
          let dot = 0;
          for (let i = 0; i < hd; i++) dot += q[qo + i] * kc[ko + i];
          dot *= scale;
          scores[t] = dot;
          if (dot > max) max = dot;
        }
        let sum = 0;
        for (let t = 0; t <= pos; t++) {
          scores[t] = Math.exp(scores[t] - max);
          sum += scores[t];
        }
        for (let i = 0; i < hd; i++) att[qo + i] = 0;
        for (let t = 0; t <= pos; t++) {
          const w = scores[t] / sum;
          const vo = t * stride + kvh * hd;
          for (let i = 0; i < hd; i++) att[qo + i] += w * vc[vo + i];
        }
      }

      matvec(W.o, att, proj, d, nh * hd);
      for (let i = 0; i < d; i++) x[i] += proj[i];

      rmsnorm(x, W.norm2, h);
      matvec(W.w1, h, a, this.hidden, d);
      matvec(W.w3, h, b, this.hidden, d);
      for (let i = 0; i < this.hidden; i++) a[i] = (a[i] / (1 + Math.exp(-a[i]))) * b[i];
      matvec(W.w2, a, proj, d, this.hidden);
      for (let i = 0; i < d; i++) x[i] += proj[i];
    }

    state.pos++;
    if (!wantLogits) return null;
    rmsnorm(x, this.normF, h);
    const logits = new Float32Array(c.vocab_size);
    matvec(this.emb, h, logits, c.vocab_size, d);
    return logits;
  }

  private rope(vec: Float32Array, offset: number, cosRow: number, half: number) {
    for (let i = 0; i < half; i++) {
      const x1 = vec[offset + i];
      const x2 = vec[offset + half + i];
      const cos = this.ropeCos[cosRow + i];
      const sin = this.ropeSin[cosRow + i];
      vec[offset + i] = x1 * cos - x2 * sin;
      vec[offset + half + i] = x1 * sin + x2 * cos;
    }
  }
}

export function sampleToken(logits: Float32Array, temperature: number, topK: number, topP: number): number {
  if (temperature <= 0) {
    let best = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
    return best;
  }
  const n = logits.length;
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i++) scaled[i] = logits[i] / temperature;

  let order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scaled[b] - scaled[a]);
  if (topK > 0 && topK < n) order = order.slice(0, topK);

  const max = scaled[order[0]];
  let sum = 0;
  const probs = order.map((i) => {
    const p = Math.exp(scaled[i] - max);
    sum += p;
    return p;
  });

  // Nucleus (top-p) cut-off on normalised probabilities.
  let cumulative = 0;
  let keep = order.length;
  for (let i = 0; i < order.length; i++) {
    const before = cumulative;
    cumulative += probs[i] / sum;
    if (before > topP) {
      keep = i;
      break;
    }
  }
  let total = 0;
  for (let i = 0; i < keep; i++) total += probs[i];
  let r = Math.random() * total;
  for (let i = 0; i < keep; i++) {
    r -= probs[i];
    if (r <= 0) return order[i];
  }
  return order[0];
}
