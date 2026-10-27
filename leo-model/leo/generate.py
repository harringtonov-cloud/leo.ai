"""Token sampling with a KV cache."""
import torch


def sample(logits, temperature: float, top_k: int, top_p: float) -> int:
    if temperature <= 0:
        return int(torch.argmax(logits))
    logits = logits.float() / temperature
    if top_k and top_k > 0:
        values, _ = torch.topk(logits, min(top_k, logits.size(-1)))
        logits = logits.masked_fill(logits < values[-1], float("-inf"))
    probs = torch.softmax(logits, dim=-1)
    if top_p < 1.0:
        sorted_probs, sorted_idx = torch.sort(probs, descending=True)
        cumulative = torch.cumsum(sorted_probs, dim=-1)
        sorted_probs = sorted_probs.masked_fill(cumulative - sorted_probs > top_p, 0.0)
        sorted_probs = sorted_probs / sorted_probs.sum()
        return int(sorted_idx[torch.multinomial(sorted_probs, 1)])
    return int(torch.multinomial(probs, 1))


@torch.no_grad()
def generate_stream(model, prompt_ids, max_new_tokens=256, temperature=0.8, top_k=50,
                    top_p=0.95, stop_ids=(), device="cpu", info=None):
    """Yield generated token ids one by one. info['finish'] is set to 'stop' or 'length'."""
    if info is None:
        info = {}
    info["finish"] = "length"
    model.eval()
    block = model.config.block_size
    max_new_tokens = max(1, min(max_new_tokens, block // 2))
    prompt_ids = list(prompt_ids)[-(block - max_new_tokens):]

    caches = [dict() for _ in model.blocks]
    idx = torch.tensor([prompt_ids], dtype=torch.long, device=device)
    logits, _ = model(idx, caches=caches, start_pos=0)
    pos = idx.shape[1]

    for _ in range(max_new_tokens):
        token = sample(logits[0, -1], temperature, top_k, top_p)
        if token in stop_ids:
            info["finish"] = "stop"
            return
        yield token
        if pos >= block:
            return
        logits, _ = model(torch.tensor([[token]], dtype=torch.long, device=device), caches=caches, start_pos=pos)
        pos += 1
