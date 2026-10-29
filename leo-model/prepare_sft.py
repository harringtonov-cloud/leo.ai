"""Build a chat fine-tuning file (JSONL) from a Hugging Face conversation dataset.

Default: IlyaGusev/saiga_scored (mostly Russian, 'messages' with roles + quality scores).
CHECK THE DATASET LICENSE before using the resulting model commercially.

  python prepare_sft.py --out sft.jsonl --min-score 8 --limit 20000
"""
import argparse
import json

ROLE_MAP = {"user": "user", "human": "user", "assistant": "assistant", "bot": "assistant", "gpt": "assistant",
            "system": "system"}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", default="IlyaGusev/saiga_scored")
    p.add_argument("--split", default="train")
    p.add_argument("--out", default="sft.jsonl")
    p.add_argument("--min-score", type=int, default=8)
    p.add_argument("--languages", default="Russian,English")
    p.add_argument("--max-turns", type=int, default=6)
    p.add_argument("--max-chars", type=int, default=3000)
    p.add_argument("--limit", type=int, default=20000)
    args = p.parse_args()

    from datasets import load_dataset

    languages = {l.strip() for l in args.languages.split(",") if l.strip()}
    ds = load_dataset(args.dataset, split=args.split)
    kept = 0
    with open(args.out, "w", encoding="utf-8") as out:
        for row in ds:
            if kept >= args.limit:
                break
            if row.get("is_bad_by_regex"):
                continue
            score = row.get("opus_score")
            if score is not None and score < args.min_score:
                continue
            if languages and row.get("language") not in languages:
                continue
            messages = []
            for m in row.get("messages") or []:
                role = ROLE_MAP.get(str(m.get("role", "")).lower())
                text = m.get("content")
                if role and isinstance(text, str) and text.strip():
                    messages.append({"role": role, "content": text.strip()[: args.max_chars]})
            messages = messages[: args.max_turns * 2]
            while messages and messages[-1]["role"] != "assistant":
                messages.pop()  # end on an assistant reply
            if len(messages) >= 2 and any(m["role"] == "user" for m in messages):
                out.write(json.dumps({"messages": messages}, ensure_ascii=False) + "\n")
                kept += 1
    print(f"Wrote {kept} conversations to {args.out}")


if __name__ == "__main__":
    main()
