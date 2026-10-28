"""Builds a random tiny Leo in numpy, writes it in the leo.bin format and prints reference logits.
Used to check that src/lib/leo/engine.ts computes the same thing as leo/model.py (no PyTorch needed)."""
import json
import struct
import sys

import numpy as np

rng = np.random.default_rng(0)
cfg = dict(vocab_size=50, block_size=32, n_layer=2, n_head=4, n_kv_head=2, n_embd=32,
           ffn_mult=8 / 3, rope_theta=10000.0, dropout=0.0)
d, nh, nkv = cfg["n_embd"], cfg["n_head"], cfg["n_kv_head"]
hd = d // nh
hidden = (int(cfg["ffn_mult"] * d) + 63) // 64 * 64


def w(*shape, scale=0.2):
    return (rng.standard_normal(shape) * scale).astype(np.float32)


params = {"tok_emb.weight": w(cfg["vocab_size"], d, scale=0.5)}
for i in range(cfg["n_layer"]):
    p = f"blocks.{i}."
    params[p + "norm1.weight"] = (1 + 0.1 * rng.standard_normal(d)).astype(np.float32)
    params[p + "attn.q.weight"] = w(nh * hd, d)
    params[p + "attn.k.weight"] = w(nkv * hd, d)
    params[p + "attn.v.weight"] = w(nkv * hd, d)
    params[p + "attn.o.weight"] = w(d, nh * hd)
    params[p + "norm2.weight"] = (1 + 0.1 * rng.standard_normal(d)).astype(np.float32)
    params[p + "mlp.w1.weight"] = w(hidden, d)
    params[p + "mlp.w3.weight"] = w(hidden, d)
    params[p + "mlp.w2.weight"] = w(d, hidden)
params["norm_f.weight"] = (1 + 0.1 * rng.standard_normal(d)).astype(np.float32)

# Quantise to float16 exactly like export_web.py, and use the dequantised values for the reference.
tensors, chunks, off = {}, [], 0
for name, arr in params.items():
    h = np.ascontiguousarray(arr.astype("<f2"))
    params[name] = h.astype(np.float32)
    tensors[name] = {"shape": list(h.shape), "offset": off, "length": int(h.size)}
    chunks.append(h.tobytes())
    off += h.nbytes
header = json.dumps({"config": cfg, "tensors": tensors}).encode()
header += b" " * (-len(header) % 8)
with open(sys.argv[1], "wb") as f:
    f.write(b"LEO1" + struct.pack("<I", len(header)) + header)
    for c in chunks:
        f.write(c)


def rmsnorm(x, wt, eps=1e-5):
    return x / np.sqrt((x ** 2).mean(-1, keepdims=True) + eps) * wt


def rope(x, cos, sin):  # x: [H, T, hd]
    h = x.shape[-1] // 2
    x1, x2 = x[..., :h], x[..., h:]
    return np.concatenate([x1 * cos - x2 * sin, x1 * sin + x2 * cos], -1)


def forward(tokens):
    T = len(tokens)
    inv = 1.0 / (cfg["rope_theta"] ** (np.arange(0, hd, 2) / hd))
    freqs = np.outer(np.arange(T), inv)
    cos, sin = np.cos(freqs), np.sin(freqs)
    x = params["tok_emb.weight"][tokens]
    for i in range(cfg["n_layer"]):
        p = f"blocks.{i}."
        h = rmsnorm(x, params[p + "norm1.weight"])
        q = (h @ params[p + "attn.q.weight"].T).reshape(T, nh, hd).transpose(1, 0, 2)
        k = (h @ params[p + "attn.k.weight"].T).reshape(T, nkv, hd).transpose(1, 0, 2)
        v = (h @ params[p + "attn.v.weight"].T).reshape(T, nkv, hd).transpose(1, 0, 2)
        q, k = rope(q, cos, sin), rope(k, cos, sin)
        k, v = np.repeat(k, nh // nkv, axis=0), np.repeat(v, nh // nkv, axis=0)  # repeat_interleave
        scores = q @ k.transpose(0, 2, 1) / np.sqrt(hd)
        scores = np.where(np.tril(np.ones((T, T), bool)), scores, -np.inf)
        e = np.exp(scores - scores.max(-1, keepdims=True))
        att = (e / e.sum(-1, keepdims=True)) @ v
        x = x + att.transpose(1, 0, 2).reshape(T, nh * hd) @ params[p + "attn.o.weight"].T
        h = rmsnorm(x, params[p + "norm2.weight"])
        a, b = h @ params[p + "mlp.w1.weight"].T, h @ params[p + "mlp.w3.weight"].T
        x = x + ((a / (1 + np.exp(-a))) * b) @ params[p + "mlp.w2.weight"].T
    x = rmsnorm(x, params["norm_f.weight"])
    return x @ params["tok_emb.weight"].T


tokens = [3, 17, 4, 42, 9, 9, 0, 31, 12, 25, 7, 48]
logits = forward(tokens)
print(json.dumps({"tokens": tokens, "last_logits": logits[-1].tolist(), "all_last": [logits[i].tolist() for i in (0, 5)]}))
