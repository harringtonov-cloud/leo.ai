"""Export a trained Leo checkpoint to leo.bin (float16) for the in-browser/server TypeScript engine.

  python export_web.py --ckpt sft_out/ckpt.pt --out leo.bin
"""
import argparse
import json
import struct

import numpy as np
import torch

LAYER_TENSORS = ["norm1.weight", "attn.q.weight", "attn.k.weight", "attn.v.weight", "attn.o.weight",
                 "norm2.weight", "mlp.w1.weight", "mlp.w3.weight", "mlp.w2.weight"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", default="sft_out/ckpt.pt")
    p.add_argument("--out", default="leo.bin")
    args = p.parse_args()

    ckpt = torch.load(args.ckpt, map_location="cpu")
    config, state = ckpt["config"], ckpt["model"]

    names = ["tok_emb.weight"]
    for i in range(config["n_layer"]):
        names += [f"blocks.{i}.{n}" for n in LAYER_TENSORS]
    names.append("norm_f.weight")  # lm_head is tied to tok_emb

    tensors, chunks, offset = {}, [], 0
    for name in names:
        arr = np.ascontiguousarray(state[name].detach().float().numpy().astype("<f2"))  # little-endian float16
        data = arr.tobytes()
        tensors[name] = {"shape": list(arr.shape), "offset": offset, "length": int(arr.size)}
        chunks.append(data)
        offset += len(data)

    header = json.dumps({"config": config, "tensors": tensors}).encode()
    header += b" " * (-len(header) % 8)
    with open(args.out, "wb") as f:
        f.write(b"LEO1")
        f.write(struct.pack("<I", len(header)))
        f.write(header)
        for chunk in chunks:
            f.write(chunk)
    print(f"Wrote {args.out}: {(8 + len(header) + offset) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
