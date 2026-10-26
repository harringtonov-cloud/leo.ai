import type { StreamEvent } from "@/lib/types";

/** Reads the newline-delimited JSON stream from /api/chat and calls `onEvent` for each event. */
export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as StreamEvent);
    } catch {
      /* ignore malformed line */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(flushLine);
  }
  buffer += decoder.decode();
  flushLine(buffer);
}
