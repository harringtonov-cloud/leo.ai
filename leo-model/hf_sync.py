"""Save/restore training checkpoints on a Hugging Face model repo, so a reset Colab does not lose progress.

  HF_TOKEN=... python hf_sync.py push --repo NAME/leo-train --file out/ckpt.pt --file data/tokenizer.json
  HF_TOKEN=... python hf_sync.py pull --repo NAME/leo-train --dest .
Keep the repo PRIVATE.
"""
import argparse
import os
import shutil

from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.utils import EntryNotFoundError, RepositoryNotFoundError


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["push", "pull"])
    p.add_argument("--repo", required=True)
    p.add_argument("--file", action="append", default=[], help="local path (push); stored under the same path")
    p.add_argument("--dest", default=".")
    args = p.parse_args()
    token = os.environ["HF_TOKEN"]
    api = HfApi(token=token)

    if args.action == "push":
        api.create_repo(args.repo, repo_type="model", private=True, exist_ok=True)
        for path in args.file:
            api.upload_file(path_or_fileobj=path, path_in_repo=path, repo_id=args.repo)
            print("uploaded", path)
        return

    for path in ["out/ckpt.pt", "data/tokenizer.json", "data/train.bin", "data/val.bin"]:
        try:
            cached = hf_hub_download(args.repo, path, token=token)
        except (EntryNotFoundError, RepositoryNotFoundError):
            print("not found:", path)
            continue
        target = os.path.join(args.dest, path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy(cached, target)
        print("restored", target)


if __name__ == "__main__":
    main()
