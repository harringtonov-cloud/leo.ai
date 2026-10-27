"""Train the tokenizer (if needed) and turn raw text into train.bin / val.bin token files.

Examples:
  python prepare.py --input my_texts/ --out data
  python prepare.py --hf roneneldan/TinyStories --text-field text --max-docs 300000 --out data
"""
import argparse
import glob
import os

import numpy as np

from leo.tokenizer import LeoTokenizer, train_tokenizer


def iter_docs(args):
    if args.hf:
        from datasets import load_dataset

        ds = load_dataset(args.hf, args.hf_config, split=args.split, streaming=True)
        for i, example in enumerate(ds):
            if args.max_docs and i >= args.max_docs:
                break
            text = example.get(args.text_field)
            if isinstance(text, str) and text.strip():
                yield text
        return

    paths = []
    for pattern in args.input:
        if os.path.isdir(pattern):
            paths += glob.glob(os.path.join(pattern, "**", "*"), recursive=True)
        else:
            paths += glob.glob(pattern)
    paths = sorted(p for p in paths if os.path.isfile(p))
    if not paths:
        raise SystemExit("No input files found. Use --input or --hf.")
    for path in paths:
        with open(path, encoding="utf-8", errors="ignore") as f:
            while True:
                chunk = f.read(4_000_000)
                if not chunk:
                    break
                yield chunk


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", nargs="*", default=[], help="text files, globs or folders")
    p.add_argument("--hf", help="Hugging Face dataset name (streamed)")
    p.add_argument("--hf-config", default=None)
    p.add_argument("--split", default="train")
    p.add_argument("--text-field", default="text")
    p.add_argument("--max-docs", type=int, default=0)
    p.add_argument("--out", default="data")
    p.add_argument("--vocab-size", type=int, default=16384)
    p.add_argument("--tokenizer-docs", type=int, default=200000, help="documents used to train the tokenizer")
    args = p.parse_args()

    if not args.input and not args.hf:
        raise SystemExit("Provide --input or --hf")
    os.makedirs(args.out, exist_ok=True)
    tok_path = os.path.join(args.out, "tokenizer.json")

    if not os.path.exists(tok_path):
        print("Training tokenizer...")

        def limited():
            for i, doc in enumerate(iter_docs(args)):
                if i >= args.tokenizer_docs:
                    break
                yield doc

        train_tokenizer(limited(), args.vocab_size, tok_path)

    tok = LeoTokenizer(tok_path)
    assert tok.vocab_size < 65536, "vocab must fit in uint16"
    eos = tok.ids["<|eos|>"]

    train_path, val_path = os.path.join(args.out, "train.bin"), os.path.join(args.out, "val.bin")
    n_train = n_val = 0
    batch = []

    def flush(out_train, out_val, docs, start_index):
        nonlocal n_train, n_val
        encodings = tok.tok.encode_batch(docs)
        for offset, enc in enumerate(encodings):
            arr = np.array(enc.ids + [eos], dtype=np.uint16)
            if (start_index + offset) % 100 == 99:
                out_val.write(arr.tobytes())
                n_val += len(arr)
            else:
                out_train.write(arr.tobytes())
                n_train += len(arr)

    print("Tokenizing...")
    count = 0
    with open(train_path, "wb") as out_train, open(val_path, "wb") as out_val:
        for doc in iter_docs(args):
            batch.append(doc.replace("<|", "< |"))
            if len(batch) == 64:
                flush(out_train, out_val, batch, count)
                count += len(batch)
                batch = []
        if batch:
            flush(out_train, out_val, batch, count)

    if n_val < 2048:  # too few documents for a document-level split: carve validation off the end
        arr = np.fromfile(train_path, dtype=np.uint16)
        k = max(len(arr) // 50, 2048)
        if len(arr) < 4 * k:
            raise SystemExit("Not enough data. Add more text.")
        arr[:-k].tofile(train_path)
        arr[-k:].tofile(val_path)
        n_train, n_val = len(arr) - k, k

    print(f"Done: {n_train:,} train tokens, {n_val:,} validation tokens, vocab {tok.vocab_size}")


if __name__ == "__main__":
    main()
