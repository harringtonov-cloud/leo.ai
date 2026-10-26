export type ArtifactType = "html" | "svg" | "markdown" | "code";

export type Artifact = {
  id: string; // stable within a message: "<messageIndex>-<n>"
  type: ArtifactType;
  title: string;
  language: string;
  content: string;
  complete: boolean; // false while it is still streaming
};

export type Segment = { kind: "text"; text: string } | { kind: "artifact"; artifact: Artifact };

const OPEN_TAG = /<artifact\b([^>]*)>/i;

function attr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) || attrs.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
  return match ? match[1] : "";
}

function normaliseType(value: string): ArtifactType {
  const v = value.toLowerCase();
  if (v === "html" || v === "svg" || v === "markdown" || v === "code") return v;
  if (v === "md") return "markdown";
  return "code";
}

/** Strips a single wrapping ``` fence if the model added one inside the artifact despite instructions. */
function unfence(content: string) {
  const match = content.trim().match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : content;
}

/** Splits assistant text into plain-text and artifact segments; tolerates an unfinished trailing artifact while streaming. */
export function splitArtifacts(text: string, messageKey: string | number): Segment[] {
  const segments: Segment[] = [];
  let rest = text;
  let n = 0;

  while (rest.length > 0) {
    const open = rest.match(OPEN_TAG);
    if (!open || open.index === undefined) {
      // A partial "<artifact" at the very end of the stream should not flash on screen.
      const partial = rest.search(/<(?:a(?:r(?:t(?:i(?:f(?:a(?:c(?:t[^>]*)?)?)?)?)?)?)?)?$/i);
      const visible = partial >= 0 ? rest.slice(0, partial) : rest;
      if (visible) segments.push({ kind: "text", text: visible });
      break;
    }

    if (open.index > 0) segments.push({ kind: "text", text: rest.slice(0, open.index) });
    const afterOpen = rest.slice(open.index + open[0].length);
    const close = afterOpen.search(/<\/artifact>/i);
    const complete = close >= 0;
    const raw = complete ? afterOpen.slice(0, close) : afterOpen;
    const attrs = open[1] || "";

    segments.push({
      kind: "artifact",
      artifact: {
        id: `${messageKey}-${n++}`,
        type: normaliseType(attr(attrs, "type")),
        title: attr(attrs, "title") || "Untitled",
        language: attr(attrs, "language") || attr(attrs, "lang") || "",
        content: unfence(raw.replace(/^\n/, "")),
        complete,
      },
    });

    if (!complete) break;
    rest = afterOpen.slice(close).replace(/^<\/artifact>/i, "");
  }

  return segments;
}

export function artifactFilename(a: Artifact) {
  const base = a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "artifact";
  const ext =
    a.type === "html" ? "html" : a.type === "svg" ? "svg" : a.type === "markdown" ? "md"
    : ({ python: "py", javascript: "js", typescript: "ts", tsx: "tsx", jsx: "jsx", json: "json", css: "css", bash: "sh", sql: "sql", go: "go", rust: "rs", java: "java" } as Record<string, string>)[a.language.toLowerCase()] || "txt";
  return `${base}.${ext}`;
}

/** Wraps an artifact for sandboxed preview in an iframe (srcdoc). */
export function previewDocument(a: Artifact): string | null {
  if (a.type === "html") return a.content;
  if (a.type === "svg") {
    return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh}</style>${a.content}`;
  }
  return null;
}
