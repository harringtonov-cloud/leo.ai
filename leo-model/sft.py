"""Teach a pre-trained Leo to chat (supervised fine-tuning on conversations).

Data: JSONL, one conversation per line:
  {"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
Only the assistant's replies are trained on.
"""
import argparse
import contextlib
import json
import os
import random

import torch

from leo.model import Config, GPT
from leo.tokenizer import LeoTokenizer


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="out/ckpt.pt")
    p.add_argument("--tokenizer", default="data/tokenizer.json")
    p.add_argument("--data", required=True, help="JSONL with conversations")
    p.add_argument("--out", default="sft_out")
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--lr", type=float, default=5e-5)
    p.add_argument("--seed", type=int, default=1337)
    args = p.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tok = LeoTokenizer(args.tokenizer)

    ckpt = torch.load(args.base, map_location="cpu")
    config = Config(**ckpt["config"])
    model = GPT(config)
    model.load_state_dict(ckpt["model"])
    model.to(device).train()
    block = config.block_size

    examples = []
    with open(args.data, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            ids, labels = tok.encode_chat_with_labels(json.loads(line)["messages"])
            ids, labels = ids[:block], labels[:block]
            if len(ids) > 1 and any(l != -100 for l in labels[1:]):
                examples.append((ids, labels))
    if not examples:
        raise SystemExit("No usable conversations found.")
    print(f"{len(examples)} conversations, model {model.num_params() / 1e6:.1f}M params, device={device}")

    optimizer = model.configure_optimizer(args.lr, 0.0)
    ctx = torch.autocast("cuda", dtype=torch.bfloat16) if (
        device == "cuda" and torch.cuda.is_bf16_supported()) else contextlib.nullcontext()
    pad = tok.ids["<|pad|>"]
    steps_per_epoch = (len(examples) + args.batch_size - 1) // args.batch_size
    total_steps, step = steps_per_epoch * args.epochs, 0

    for epoch in range(args.epochs):
        random.shuffle(examples)
        for start in range(0, len(examples), args.batch_size):
            batch = examples[start:start + args.batch_size]
            width = max(len(ids) for ids, _ in batch)
            x = torch.full((len(batch), width - 1), pad, dtype=torch.long)
            y = torch.full((len(batch), width - 1), -100, dtype=torch.long)
            for row, (ids, labels) in enumerate(batch):
                n = len(ids) - 1
                x[row, :n] = torch.tensor(ids[:-1])
                y[row, :n] = torch.tensor(labels[1:])
            x, y = x.to(device), y.to(device)

            for group in optimizer.param_groups:
                group["lr"] = args.lr * max(0.1, 1 - step / total_steps)
            with ctx:
                _, loss = model(x, targets=y)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            step += 1
            if step % 10 == 0 or step == total_steps:
                print(f"epoch {epoch + 1} step {step}/{total_steps} loss {loss.item():.4f}")

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "ckpt.pt")
    torch.save({"model": model.state_dict(), "config": config.__dict__, "step": step}, out_path)
    print(f"Saved chat model to {out_path}")


if __name__ == "__main__":
    main()
