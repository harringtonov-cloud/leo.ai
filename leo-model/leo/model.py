"""Leo language model: decoder-only transformer (RMSNorm, RoPE, SwiGLU, grouped-query attention).

Written from scratch in PyTorch. Supports a KV cache for fast generation.
"""
import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class Config:
    vocab_size: int = 16384
    block_size: int = 1024
    n_layer: int = 12
    n_head: int = 12
    n_kv_head: int = 4
    n_embd: int = 768
    ffn_mult: float = 8 / 3
    rope_theta: float = 10000.0
    dropout: float = 0.0


# head_dim is 64 in every preset. Parameter counts include a 16k vocabulary.
PRESETS = {
    "tiny": dict(block_size=512, n_layer=6, n_head=6, n_kv_head=2, n_embd=384),      # ~15M, trainable on CPU / free GPU
    "small": dict(block_size=1024, n_layer=12, n_head=12, n_kv_head=4, n_embd=768),  # ~110M
    "medium": dict(block_size=2048, n_layer=24, n_head=16, n_kv_head=4, n_embd=1024),  # ~370M
}


def make_config(preset: str, vocab_size: int, **overrides) -> Config:
    cfg = Config(vocab_size=vocab_size, **PRESETS[preset])
    for key, value in overrides.items():
        setattr(cfg, key, value)
    return cfg


class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x):
        xf = x.float()
        out = xf * torch.rsqrt(xf.pow(2).mean(-1, keepdim=True) + self.eps)
        return out.type_as(x) * self.weight


def precompute_rope(head_dim: int, max_len: int, theta: float):
    inv = 1.0 / (theta ** (torch.arange(0, head_dim, 2).float() / head_dim))
    freqs = torch.outer(torch.arange(max_len).float(), inv)  # [T, head_dim/2]
    return torch.cos(freqs), torch.sin(freqs)


def apply_rope(x, cos, sin):
    # x: [B, H, T, head_dim]; cos/sin: [T, head_dim/2]
    half = x.shape[-1] // 2
    x1, x2 = x[..., :half], x[..., half:]
    cos = cos.to(x.dtype)[None, None]
    sin = sin.to(x.dtype)[None, None]
    return torch.cat([x1 * cos - x2 * sin, x1 * sin + x2 * cos], dim=-1)


class Attention(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        assert c.n_embd % c.n_head == 0 and c.n_head % c.n_kv_head == 0
        self.n_head, self.n_kv_head = c.n_head, c.n_kv_head
        self.head_dim = c.n_embd // c.n_head
        self.dropout = c.dropout
        self.q = nn.Linear(c.n_embd, self.n_head * self.head_dim, bias=False)
        self.k = nn.Linear(c.n_embd, self.n_kv_head * self.head_dim, bias=False)
        self.v = nn.Linear(c.n_embd, self.n_kv_head * self.head_dim, bias=False)
        self.o = nn.Linear(self.n_head * self.head_dim, c.n_embd, bias=False)

    def forward(self, x, cos, sin, cache=None):
        B, T, _ = x.shape
        q = self.q(x).view(B, T, self.n_head, self.head_dim).transpose(1, 2)
        k = self.k(x).view(B, T, self.n_kv_head, self.head_dim).transpose(1, 2)
        v = self.v(x).view(B, T, self.n_kv_head, self.head_dim).transpose(1, 2)
        q, k = apply_rope(q, cos, sin), apply_rope(k, cos, sin)

        if cache is not None:
            if cache.get("k") is not None:
                assert T == 1, "with a non-empty cache only single-token steps are supported"
                k = torch.cat([cache["k"], k], dim=2)
                v = torch.cat([cache["v"], v], dim=2)
            cache["k"], cache["v"] = k, v

        if self.n_kv_head != self.n_head:
            rep = self.n_head // self.n_kv_head
            k = k.repeat_interleave(rep, dim=1)
            v = v.repeat_interleave(rep, dim=1)

        y = F.scaled_dot_product_attention(
            q, k, v, is_causal=(T > 1), dropout_p=self.dropout if self.training else 0.0
        )
        return self.o(y.transpose(1, 2).contiguous().view(B, T, -1))


class SwiGLU(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        hidden = (int(c.ffn_mult * c.n_embd) + 63) // 64 * 64
        self.w1 = nn.Linear(c.n_embd, hidden, bias=False)
        self.w3 = nn.Linear(c.n_embd, hidden, bias=False)
        self.w2 = nn.Linear(hidden, c.n_embd, bias=False)

    def forward(self, x):
        return self.w2(F.silu(self.w1(x)) * self.w3(x))


class Block(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        self.norm1, self.attn = RMSNorm(c.n_embd), Attention(c)
        self.norm2, self.mlp = RMSNorm(c.n_embd), SwiGLU(c)

    def forward(self, x, cos, sin, cache=None):
        x = x + self.attn(self.norm1(x), cos, sin, cache)
        return x + self.mlp(self.norm2(x))


class GPT(nn.Module):
    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self.tok_emb = nn.Embedding(config.vocab_size, config.n_embd)
        self.blocks = nn.ModuleList(Block(config) for _ in range(config.n_layer))
        self.norm_f = RMSNorm(config.n_embd)
        self.lm_head = nn.Linear(config.n_embd, config.vocab_size, bias=False)
        self.lm_head.weight = self.tok_emb.weight  # tied embeddings

        cos, sin = precompute_rope(config.n_embd // config.n_head, config.block_size, config.rope_theta)
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)

        self.apply(self._init)
        scale = 0.02 / math.sqrt(2 * config.n_layer)
        for name, p in self.named_parameters():
            if name.endswith("attn.o.weight") or name.endswith("mlp.w2.weight"):
                nn.init.normal_(p, mean=0.0, std=scale)

    @staticmethod
    def _init(module):
        if isinstance(module, (nn.Linear, nn.Embedding)):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def forward(self, idx, targets=None, caches=None, start_pos: int = 0):
        """idx: [B, T] token ids. With targets returns (logits, loss); otherwise logits of the last position only."""
        B, T = idx.shape
        assert start_pos + T <= self.config.block_size, "sequence longer than block_size"
        x = self.tok_emb(idx)
        cos = self.rope_cos[start_pos:start_pos + T]
        sin = self.rope_sin[start_pos:start_pos + T]
        for i, block in enumerate(self.blocks):
            x = block(x, cos, sin, None if caches is None else caches[i])
        x = self.norm_f(x)
        if targets is not None:
            logits = self.lm_head(x)
            loss = F.cross_entropy(
                logits.view(-1, logits.size(-1)), targets.reshape(-1), ignore_index=-100
            )
            return logits, loss
        return self.lm_head(x[:, -1:, :]), None

    def configure_optimizer(self, lr: float, weight_decay: float, betas=(0.9, 0.95)):
        decay = [p for p in self.parameters() if p.requires_grad and p.dim() >= 2]
        no_decay = [p for p in self.parameters() if p.requires_grad and p.dim() < 2]
        groups = [
            {"params": decay, "weight_decay": weight_decay},
            {"params": no_decay, "weight_decay": 0.0},
        ]
        return torch.optim.AdamW(groups, lr=lr, betas=betas)
