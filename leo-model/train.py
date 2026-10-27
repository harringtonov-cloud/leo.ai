"""Pre-train Leo from scratch on tokenized text (data/train.bin, data/val.bin)."""
import argparse
import contextlib
import math
import os
import time

import numpy as np
import torch

from leo.model import PRESETS, Config, GPT, make_config
from leo.tokenizer import LeoTokenizer


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="data")
    p.add_argument("--out", default="out")
    p.add_argument("--preset", default="tiny", choices=list(PRESETS))
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--grad-accum", type=int, default=4)
    p.add_argument("--max-steps", type=int, default=5000)
    p.add_argument("--lr", type=float, default=6e-4)
    p.add_argument("--min-lr-ratio", type=float, default=0.1)
    p.add_argument("--warmup", type=int, default=200)
    p.add_argument("--weight-decay", type=float, default=0.1)
    p.add_argument("--eval-interval", type=int, default=250)
    p.add_argument("--eval-batches", type=int, default=20)
    p.add_argument("--compile", action="store_true")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--seed", type=int, default=1337)
    args = p.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(args.seed)
    os.makedirs(args.out, exist_ok=True)
    ckpt_path = os.path.join(args.out, "ckpt.pt")

    tok = LeoTokenizer(os.path.join(args.data, "tokenizer.json"))
    data = {
        "train": np.memmap(os.path.join(args.data, "train.bin"), dtype=np.uint16, mode="r"),
        "val": np.memmap(os.path.join(args.data, "val.bin"), dtype=np.uint16, mode="r"),
    }

    resumed = args.resume and os.path.exists(ckpt_path)
    if resumed:
        ckpt = torch.load(ckpt_path, map_location="cpu")
        config = Config(**ckpt["config"])
    else:
        config = make_config(args.preset, tok.vocab_size)
    block = config.block_size
    for split, arr in data.items():
        if len(arr) <= block + 1:
            raise SystemExit(f"{split} data is too small for block size {block}. Add more text.")

    model = GPT(config).to(device)
    optimizer = model.configure_optimizer(args.lr, args.weight_decay)
    step = 0
    if resumed:
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        step = ckpt["step"]
    print(f"Leo {args.preset}: {model.num_params() / 1e6:.1f}M parameters, device={device}, step={step}")

    if device == "cuda":
        amp_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        ctx = torch.autocast(device_type="cuda", dtype=amp_dtype)
        scaler = torch.amp.GradScaler("cuda", enabled=(amp_dtype == torch.float16))
    else:
        ctx, scaler = contextlib.nullcontext(), torch.amp.GradScaler("cuda", enabled=False)
    run_model = torch.compile(model) if args.compile else model

    def get_batch(split):
        arr = data[split]
        ix = torch.randint(len(arr) - block - 1, (args.batch_size,)).tolist()
        x = torch.stack([torch.from_numpy(arr[i:i + block].astype(np.int64)) for i in ix])
        y = torch.stack([torch.from_numpy(arr[i + 1:i + 1 + block].astype(np.int64)) for i in ix])
        return x.to(device), y.to(device)

    def lr_at(s):
        if s < args.warmup:
            return args.lr * (s + 1) / args.warmup
        progress = min(1.0, (s - args.warmup) / max(1, args.max_steps - args.warmup))
        floor = args.lr * args.min_lr_ratio
        return floor + 0.5 * (1 + math.cos(math.pi * progress)) * (args.lr - floor)

    @torch.no_grad()
    def evaluate():
        model.eval()
        losses = []
        for _ in range(args.eval_batches):
            x, y = get_batch("val")
            with ctx:
                _, loss = model(x, targets=y)
            losses.append(loss.item())
        model.train()
        return sum(losses) / len(losses)

    def save():
        tmp = ckpt_path + ".tmp"
        torch.save({"model": model.state_dict(), "optimizer": optimizer.state_dict(),
                    "config": config.__dict__, "step": step}, tmp)
        os.replace(tmp, ckpt_path)

    model.train()
    t0 = time.time()
    while step < args.max_steps:
        for group in optimizer.param_groups:
            group["lr"] = lr_at(step)
        optimizer.zero_grad(set_to_none=True)
        total = 0.0
        for _ in range(args.grad_accum):
            x, y = get_batch("train")
            with ctx:
                _, loss = run_model(x, targets=y)
                loss = loss / args.grad_accum
            scaler.scale(loss).backward()
            total += loss.item()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer)
        scaler.update()
        step += 1

        if step % 10 == 0:
            dt = time.time() - t0
            tps = 10 * args.batch_size * args.grad_accum * block / dt
            print(f"step {step} | loss {total:.4f} | lr {lr_at(step):.2e} | {tps:,.0f} tok/s")
            t0 = time.time()
        if step % args.eval_interval == 0 or step == args.max_steps:
            val_loss = evaluate()
            print(f"== step {step}: val loss {val_loss:.4f} (perplexity {math.exp(val_loss):.1f})")
            save()
            t0 = time.time()
    print(f"Finished. Checkpoint: {ckpt_path}")


if __name__ == "__main__":
    main()
