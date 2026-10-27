"""OpenAI-compatible server for Leo (POST /v1/chat/completions, streaming supported).

Needs only PyTorch. Protect it with an API key:  LEO_API_KEY=secret python serve.py
"""
import argparse
import hmac
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch

from leo.generate import generate_stream
from leo.model import Config, GPT
from leo.tokenizer import LeoTokenizer

MODEL_NAME = "leo"


class Handler(BaseHTTPRequestHandler):
    server_version = "LeoServe/0.1"

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        key = self.server.api_key
        if not key:
            return True
        return hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {key}")

    def do_GET(self):
        if self.path == "/health":
            return self._send_json(200, {"ok": True})
        if self.path == "/v1/models":
            if not self._authorized():
                return self._send_json(401, {"error": {"message": "Invalid API key."}})
            return self._send_json(200, {"object": "list", "data": [{"id": MODEL_NAME, "object": "model"}]})
        self._send_json(404, {"error": {"message": "Not found."}})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            return self._send_json(404, {"error": {"message": "Not found."}})
        if not self._authorized():
            return self._send_json(401, {"error": {"message": "Invalid API key."}})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 1_000_000:
                return self._send_json(413, {"error": {"message": "Request body too large or empty."}})
            body = json.loads(self.rfile.read(length))
            messages = body.get("messages")
            if not isinstance(messages, list) or not messages or not all(
                isinstance(m, dict) and isinstance(m.get("content"), str) for m in messages
            ):
                raise ValueError("messages must be a non-empty list of {role, content}")
        except (ValueError, json.JSONDecodeError) as error:
            return self._send_json(400, {"error": {"message": str(error)}})

        max_tokens = max(1, min(int(body.get("max_tokens") or 512), 2048))
        temperature = max(0.0, min(float(body.get("temperature", 0.7)), 2.0))
        top_p = max(0.05, min(float(body.get("top_p", 0.95)), 1.0))
        stream = bool(body.get("stream"))

        srv = self.server
        prompt = srv.tok.encode_chat(messages, add_generation_prompt=True)
        stop_ids = {srv.tok.ids["<|end|>"], srv.tok.ids["<|eos|>"]}
        completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        created = int(time.time())
        info = {}

        def chunk(delta, finish=None):
            return {"id": completion_id, "object": "chat.completion.chunk", "created": created,
                    "model": MODEL_NAME, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}

        with srv.lock:  # one generation at a time
            tokens = generate_stream(srv.model, prompt, max_tokens, temperature, 50, top_p,
                                     stop_ids, srv.device, info)
            if not stream:
                out = list(tokens)
                text = srv.tok.decode(out)
                return self._send_json(200, {
                    "id": completion_id, "object": "chat.completion", "created": created, "model": MODEL_NAME,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                                 "finish_reason": info.get("finish", "stop")}],
                    "usage": {"prompt_tokens": len(prompt), "completion_tokens": len(out),
                              "total_tokens": len(prompt) + len(out)},
                })

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True

            def emit(obj):
                self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
                self.wfile.flush()

            try:
                emit(chunk({"role": "assistant"}))
                produced, sent = [], ""
                for token in tokens:
                    produced.append(token)
                    text = srv.tok.decode(produced)
                    if text.endswith("�"):  # incomplete UTF-8 sequence, wait for more tokens
                        continue
                    if len(text) > len(sent):
                        emit(chunk({"content": text[len(sent):]}))
                        sent = text
                text = srv.tok.decode(produced)
                if len(text) > len(sent):
                    emit(chunk({"content": text[len(sent):]}))
                emit(chunk({}, info.get("finish", "stop")))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                tokens.close()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", default="sft_out/ckpt.pt")
    p.add_argument("--tokenizer", default="data/tokenizer.json")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    args = p.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    ckpt = torch.load(args.ckpt, map_location="cpu")
    model = GPT(Config(**ckpt["config"]))
    model.load_state_dict(ckpt["model"])
    model.to(device).eval()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.model, server.tok, server.device = model, LeoTokenizer(args.tokenizer), device
    server.lock = threading.Lock()
    server.api_key = os.environ.get("LEO_API_KEY", "")
    if not server.api_key:
        print("WARNING: LEO_API_KEY is not set; the server is open to anyone who can reach it.")
    print(f"Leo ({model.num_params() / 1e6:.1f}M params) serving on http://{args.host}:{args.port}/v1 [{device}]")
    server.serve_forever()


if __name__ == "__main__":
    main()
