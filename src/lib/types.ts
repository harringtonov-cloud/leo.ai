export type Source = { title: string; url: string };

/** Sent to the server with a user message. `data` is a data: URL for images/PDFs and plain text for text files. */
export type Attachment = {
  kind: "image" | "pdf" | "text";
  name: string;
  mime: string;
  data: string;
};

/** What is kept in chat history (no heavy payloads). */
export type AttachmentInfo = { kind: Attachment["kind"]; name: string };

export type ToolEvent = {
  id: string;
  name: string;
  label: string;
  status: "running" | "done" | "error";
};

export type Message = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  attachments?: AttachmentInfo[];
  tools?: ToolEvent[];
  sources?: Source[];
  images?: string[]; // base64 PNG produced by the sandbox (session only, not persisted)
};

export type Mode = "chat" | "code";

export type KnowledgeFile = { name: string; content: string };

export type Project = {
  id: string;
  name: string;
  instructions: string;
  files: KnowledgeFile[];
  updatedAt: number;
};

export type Chat = {
  id: string;
  title: string;
  messages: Message[];
  mode: Mode;
  projectId?: string;
  updatedAt: number;
};

export type MemoryItem = { id: string; text: string; createdAt: number };

/** Newline-delimited JSON events streamed by /api/chat. */
export type StreamEvent =
  | { t: "meta"; model: string; task: string }
  | { t: "text"; d: string }
  | { t: "tool"; id: string; name: string; label: string; status: ToolEvent["status"] }
  | { t: "sources"; items: Source[] }
  | { t: "images"; items: string[] }
  | { t: "error"; message: string }
  | { t: "done" };
