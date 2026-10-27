"""Quick self-check. Run before training:  python smoke_test.py"""
import torch

from leo.generate import generate_stream, sample
from leo.model import Config, GPT


def main():
    torch.manual_seed(0)
    cfg = Config(vocab_size=300, block_size=64, n_layer=2, n_head=4, n_kv_head=2, n_embd=64)
    model = GPT(cfg).eval()
    print(f"params: {model.num_params():,}")
    idx = torch.randint(0, 300, (1, 24))

    # 1) KV-cache decoding must match a full forward pass.
    with torch.no_grad():
        for k in (1, 7, 24):
            full, _ = model(idx[:, :k])
            caches = [dict() for _ in model.blocks]
            logits, _ = model(idx[:, :1], caches=caches, start_pos=0)
            for pos in range(1, k):
                logits, _ = model(idx[:, pos:pos + 1], caches=caches, start_pos=pos)
            assert torch.allclose(full, logits, atol=1e-4), f"cache mismatch at length {k}"

        caches = [dict() for _ in model.blocks]
        model(idx[:, :10], caches=caches, start_pos=0)
        logits = None
        for pos in range(10, 24):
            logits, _ = model(idx[:, pos:pos + 1], caches=caches, start_pos=pos)
        full, _ = model(idx)
        assert torch.allclose(full, logits, atol=1e-4), "prefill+decode mismatch"
    print("OK  KV cache matches full forward")

    # 2) The model must be able to learn: memorise a repeating pattern.
    model.train()
    pattern = torch.arange(32).repeat(8)[: 4 * 33].view(4, 33) % 50
    x, y = pattern[:, :-1], pattern[:, 1:]
    optimizer = model.configure_optimizer(3e-3, 0.0)
    first = None
    for step in range(120):
        _, loss = model(x, targets=y)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        first = first if first is not None else loss.item()
    assert loss.item() < first * 0.5, f"loss did not drop: {first:.3f} -> {loss.item():.3f}"
    print(f"OK  training works (loss {first:.3f} -> {loss.item():.3f})")

    # 3) Generation runs and respects stop tokens / length.
    info = {}
    out = list(generate_stream(model, [1, 2, 3], max_new_tokens=10, temperature=0.8, info=info))
    assert 0 < len(out) <= 10 and all(0 <= t < 300 for t in out)
    assert isinstance(sample(torch.randn(300), 0.0, 0, 1.0), int)
    print("OK  generation works")

    # 4) Optional: tokenizer round trip (needs the `tokenizers` package).
    try:
        import os
        import tempfile

        from leo.tokenizer import LeoTokenizer, train_tokenizer

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tok.json")
            train_tokenizer(["hello world, this is Leo", "привет, мир! код на python"] * 50, 400, path)
            tok = LeoTokenizer(path)
            text = "hello Leo, привет!"
            assert tok.decode(tok.encode(text)) == text
            ids = tok.encode_chat([{"role": "user", "content": "hi"}], add_generation_prompt=True)
            assert ids[-1] == tok.ids["<|assistant|>"]
        print("OK  tokenizer round trip")
    except ImportError:
        print("SKIP tokenizer test (pip install tokenizers)")
    print("All checks passed.")


if __name__ == "__main__":
    main()
