"""Byte-level BPE tokenizer (trained on your own data) plus the Leo chat format."""
from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers

SPECIALS = ["<|pad|>", "<|eos|>", "<|system|>", "<|user|>", "<|assistant|>", "<|end|>"]


def train_tokenizer(texts, vocab_size: int, out_path: str):
    tok = Tokenizer(models.BPE())
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    trainer = trainers.BpeTrainer(
        vocab_size=vocab_size,
        special_tokens=SPECIALS,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        show_progress=True,
    )
    tok.train_from_iterator(texts, trainer=trainer)
    tok.save(out_path)
    return tok


def _clean(text: str) -> str:
    # Stop user text from being parsed as control tokens.
    return text.replace("<|", "< |")


class LeoTokenizer:
    def __init__(self, path: str):
        self.tok = Tokenizer.from_file(path)
        self.ids = {s: self.tok.token_to_id(s) for s in SPECIALS}
        if any(v is None for v in self.ids.values()):
            raise ValueError("tokenizer file is missing Leo special tokens")

    @property
    def vocab_size(self) -> int:
        return self.tok.get_vocab_size()

    def encode(self, text: str):
        return self.tok.encode(_clean(text)).ids

    def decode(self, ids):
        return self.tok.decode(list(ids), skip_special_tokens=True)

    def encode_chat(self, messages, add_generation_prompt: bool = False):
        """Format: <|role|> text <|end|> ... and optionally a trailing <|assistant|> to ask for a reply."""
        ids = []
        for m in messages:
            role = m.get("role")
            if role not in ("system", "user", "assistant"):
                continue
            ids += [self.ids[f"<|{role}|>"]] + self.encode(str(m.get("content", ""))) + [self.ids["<|end|>"]]
        if add_generation_prompt:
            ids.append(self.ids["<|assistant|>"])
        return ids

    def encode_chat_with_labels(self, messages):
        """Token ids plus labels; only assistant text (and its <|end|>) is trained on, the rest is -100."""
        ids, labels = [], []
        for m in messages:
            role = m.get("role")
            if role not in ("system", "user", "assistant"):
                continue
            head = [self.ids[f"<|{role}|>"]]
            body = self.encode(str(m.get("content", ""))) + [self.ids["<|end|>"]]
            ids += head + body
            labels += [-100] * len(head) + (body if role == "assistant" else [-100] * len(body))
        return ids, labels
