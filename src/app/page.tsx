"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth, firebaseConfigured } from "@/lib/firebase";
import { CopyButton, Markdown } from "@/lib/markdown";

type Message = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
};

type Mode = "chat" | "code";
type Theme = "dark" | "light";
type Preference = "auto" | "fast" | "reasoning" | "coding";

type ProjectFile = {
  path: string;
  content: string;
};

type Chat = {
  id: string;
  title: string;
  messages: Message[];
  mode: Mode;
  updatedAt: number;
};

const CHATS_KEY = "leo.chats.v1";
const THEME_KEY = "leo.theme";
const PREF_KEY = "leo.pref";

const PREFERENCES: { id: Preference; label: string }[] = [
  { id: "auto", label: "Auto model" },
  { id: "fast", label: "Fast" },
  { id: "reasoning", label: "Reasoning" },
  { id: "coding", label: "Coding" },
];

const CHAT_SUGGESTIONS = [
  "Explain a difficult topic in simple words",
  "Help me plan my week",
  "Write a polite email declining an invitation",
  "Compare two approaches and recommend one",
];

const CODE_SUGGESTIONS = [
  "Explain what this project does",
  "Review the code and list the biggest problems",
  "Suggest tests I should add",
  "Find security issues in these files",
];

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isChat(value: unknown): value is Chat {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Chat>;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    Array.isArray(c.messages) &&
    c.messages.every(
      (m) =>
        m &&
        typeof m.content === "string" &&
        (m.role === "user" || m.role === "assistant")
    )
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("chat");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [zipName, setZipName] = useState("");
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState(newId);
  const [theme, setTheme] = useState<Theme>("dark");
  const [preference, setPreference] = useState<Preference>("auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore saved settings and chat history (browser only).
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
      }

      const savedPref = localStorage.getItem(PREF_KEY);
      if (PREFERENCES.some((p) => p.id === savedPref)) {
        setPreference(savedPref as Preference);
      }

      const raw = localStorage.getItem(CHATS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setChats(parsed.filter(isChat));
      }
    } catch {
      // Storage unavailable or corrupted: start fresh.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!loaded) return;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PREF_KEY, preference);
    } catch {}
  }, [preference, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    } catch {}
  }, [chats, loaded]);

  // Keep the current conversation in the history list.
  useEffect(() => {
    if (!loaded || messages.length === 0) return;

    setChats((previous) => {
      const existing = previous.find((c) => c.id === chatId);
      if (existing && existing.messages === messages) return previous;

      const first =
        messages.find((m) => m.role === "user")?.content || "New chat";

      const entry: Chat = {
        id: chatId,
        title: first.replace(/\s+/g, " ").slice(0, 48),
        messages,
        mode,
        updatedAt: Date.now(),
      };

      return [entry, ...previous.filter((c) => c.id !== chatId)].slice(0, 50);
    });
  }, [messages, chatId, mode, loaded]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    const firebaseAuth = auth;

    if (!firebaseConfigured || !firebaseAuth) {
      setStatus(
        "Firebase is not configured. Check your environment variables."
      );
      return;
    }

    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          return;
        }

        try {
          const credential = await signInAnonymously(firebaseAuth);
          setUser(credential.user);
          setStatus("");
        } catch (error) {
          console.error("Firebase sign-in failed:", error);
          setStatus(
            "Firebase sign-in failed. Check Firebase configuration and enable Anonymous sign-in."
          );
        }
      }
    );

    return () => unsubscribe();
  }, []);

  async function token(): Promise<string> {
    if (!firebaseConfigured || !auth) {
      return "";
    }

    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error("Firebase sign-in is not ready. Please try again.");
    }

    return currentUser.getIdToken();
  }

  async function runChat(history: Message[]) {
    setMessages(history);
    setBusy(true);
    setStatus("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const idToken = await token();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const payload = history
        .filter((m) => !m.error)
        .slice(-30)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 20_000) }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          messages: payload,
          mode,
          preference,
          files: mode === "code" ? projectFiles.slice(0, 35) : [],
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "The request failed.");
      }

      if (!data || typeof data.content !== "string") {
        throw new Error("The server returned an invalid response.");
      }

      setMessages([...history, { role: "assistant", content: data.content }]);

      setStatus(
        typeof data.model === "string"
          ? `Selected model: ${data.model}`
          : "Response received."
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setStatus("Stopped.");
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unknown error";

      setMessages([
        ...history,
        { role: "assistant", content: `Error: ${message}`, error: true },
      ]);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function send() {
    const text = prompt.trim();

    if (!text || busy) return;

    setPrompt("");
    await runChat([...messages, { role: "user", content: text }]);
  }

  async function regenerate() {
    if (busy || messages.length === 0) return;

    const last = messages[messages.length - 1];
    const history = last.role === "assistant" ? messages.slice(0, -1) : messages;

    if (history.length === 0) return;
    await runChat(history);
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function uploadZip(file?: File) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".zip")) {
      setStatus("Choose a .zip archive.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setStatus("ZIP limit is 10 MB.");
      return;
    }

    setStatus("Reading archive locally…");

    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file, {
        checkCRC32: true,
      });

      const output: ProjectFile[] = [];
      let totalCharacters = 0;

      for (const [path, entry] of Object.entries(zip.files)) {
        if (
          entry.dir ||
          path.startsWith("/") ||
          path.split("/").includes("..")
        ) {
          continue;
        }

        if (
          /\.(png|jpe?g|gif|webp|ico|pdf|zip|exe|dll|so|dylib|mp4|mp3|woff2?)$/i.test(
            path
          )
        ) {
          continue;
        }

        if (
          /(^|\/)(node_modules|\.git|\.next|dist|build)\//.test(path) ||
          /(^|\/)\.env($|\.(?!example))/.test(path)
        ) {
          continue;
        }

        if (output.length >= 80) break;

        const content = await entry.async("string");

        if (totalCharacters + content.length > 300_000) {
          break;
        }

        totalCharacters += content.length;

        output.push({
          path,
          content: content.slice(0, 20_000),
        });
      }

      setProjectFiles(output);
      setZipName(file.name);
      setMode("code");
      setStatus(
        `Loaded ${output.length} text files. Files are provided as context only.`
      );
    } catch (error) {
      console.error("ZIP loading failed:", error);
      setStatus("Could not read ZIP. Check that the archive is valid.");
    } finally {
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setChatId(newId());
    setMessages([]);
    setStatus("");
    setPrompt("");
    setMenuOpen(false);
  }

  function openChat(chat: Chat) {
    abortRef.current?.abort();
    setChatId(chat.id);
    setMessages(chat.messages);
    setMode(chat.mode);
    setStatus("");
    setMenuOpen(false);
  }

  function deleteChat(id: string) {
    setChats((previous) => previous.filter((c) => c.id !== id));
    if (id === chatId) newChat();
  }

  function exportChat() {
    if (messages.length === 0) {
      setStatus("Nothing to export yet.");
      return;
    }

    const markdown = messages
      .map((m) => `### ${m.role === "user" ? "You" : "Leo"}\n\n${m.content}`)
      .join("\n\n---\n\n");

    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "leo-chat.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  const suggestions = mode === "chat" ? CHAT_SUGGESTIONS : CODE_SUGGESTIONS;

  return (
    <div className="shell">
      {menuOpen && (
        <div className="backdrop" onClick={() => setMenuOpen(false)} />
      )}

      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          leo<span>·</span>ai
        </div>

        <button className="newbtn" onClick={newChat}>
          ＋ New chat
        </button>

        <div className="small">WORKSPACE</div>

        <button
          className={`navbtn ${mode === "chat" ? "active" : ""}`}
          onClick={() => {
            setMode("chat");
            setMenuOpen(false);
          }}
        >
          ◌　Leo Chat
        </button>

        <button
          className={`navbtn ${mode === "code" ? "active" : ""}`}
          onClick={() => {
            setMode("code");
            setMenuOpen(false);
          }}
        >
          ⌘　Leo Code
        </button>

        <div className="small">HISTORY</div>

        <div className="history">
          {chats.length === 0 && (
            <div className="small">Your conversations will appear here.</div>
          )}

          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`hrow ${chat.id === chatId ? "active" : ""}`}
            >
              <button
                className="htitle"
                onClick={() => openChat(chat)}
                title={chat.title}
              >
                {chat.mode === "code" ? "⌘ " : "◌ "}
                {chat.title}
              </button>
              <button
                className="hdel"
                aria-label="Delete chat"
                onClick={() => deleteChat(chat.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-foot small">
          <div className="actions" style={{ marginBottom: 10 }}>
            <button
              className="secondary"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
            <button className="secondary" onClick={exportChat}>
              ⇩ Export
            </button>
          </div>
          A calm workspace for thinking and building.
          <br />
          Starter version · 0.2
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="actions">
            <button
              className="secondary mobile-only"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
            >
              ☰
            </button>
            <span>{mode === "chat" ? "Leo Chat" : "Leo Code"}</span>
          </div>

          <div className="actions">
            <button
              className="secondary mobile-only"
              onClick={() => setMode(mode === "chat" ? "code" : "chat")}
            >
              {mode === "chat" ? "Leo Code" : "Leo Chat"}
            </button>

            <select
              className="select"
              aria-label="Model preference"
              value={preference}
              onChange={(event) =>
                setPreference(event.target.value as Preference)
              }
            >
              {PREFERENCES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            <span className="badge">{user ? "Signed in" : "Preview"}</span>
          </div>
        </header>

        <section className="workspace">
          {messages.length === 0 ? (
            <div className="welcome">
              <h1>
                {mode === "chat"
                  ? "What can I help you with?"
                  : "Let's build something."}
              </h1>

              <div className="subtitle">
                {mode === "chat"
                  ? "Ask questions, explore ideas, or work through a difficult problem."
                  : "Upload a project ZIP and ask Leo to explain, review, or propose code changes."}
              </div>

              <div className="chips">
                {suggestions.map((text) => (
                  <button
                    key={text}
                    className="chip"
                    onClick={() => setPrompt(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((message, index) => {
                const isLast = index === messages.length - 1;

                return (
                  <article
                    className={`msg ${message.role} ${
                      message.error ? "err" : ""
                    }`}
                    key={`${index}-${message.role}`}
                  >
                    <div className="role">
                      {message.role === "user" ? "You" : "Leo"}
                    </div>

                    {message.role === "assistant" && !message.error ? (
                      <Markdown text={message.content} />
                    ) : (
                      message.content
                    )}

                    {message.role === "assistant" && (
                      <div className="msg-actions">
                        {!message.error && (
                          <CopyButton text={message.content} />
                        )}
                        {isLast && !busy && (
                          <button
                            className="ghost"
                            onClick={() => void regenerate()}
                          >
                            ↻ {message.error ? "Retry" : "Regenerate"}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              {busy && (
                <div className="msg assistant typing">
                  <div className="role">Leo</div>
                  Thinking…
                </div>
              )}

              <div ref={endRef} />
            </div>
          )}

          {mode === "code" && (
            <div className="notice" style={{ marginBottom: 14 }}>
              <strong>Project workspace</strong>
              <br />

              {zipName
                ? `${zipName} · ${projectFiles.length} text files available as context`
                : "Upload a ZIP archive to let Leo inspect text files."}

              <div className="actions" style={{ marginTop: 10 }}>
                <button
                  className="secondary"
                  onClick={() => fileRef.current?.click()}
                >
                  ＋ Upload ZIP
                </button>

                {zipName && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setZipName("");
                      setProjectFiles([]);
                      setStatus("Project removed.");
                    }}
                  >
                    Remove project
                  </button>
                )}

                <input
                  ref={fileRef}
                  hidden
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => uploadZip(event.target.files?.[0])}
                />
              </div>

              <div className="small" style={{ marginTop: 8 }}>
                Files are sent as context. This version does not execute
                uploaded code or automatically modify the ZIP archive.
                Project files are not saved in chat history.
              </div>
            </div>
          )}

          <div className="composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={
                mode === "chat"
                  ? "Message Leo…"
                  : "Ask Leo to review or change your project…"
              }
            />

            <div className="compose-bottom">
              <div className="actions">
                <span className="small">Shift + Enter for new line</span>

                {mode === "chat" && (
                  <button
                    className="secondary"
                    onClick={() => setMode("code")}
                  >
                    Open Leo Code
                  </button>
                )}
              </div>

              {busy ? (
                <button className="secondary" onClick={stop}>
                  ■ Stop
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!prompt.trim()}
                  onClick={() => void send()}
                >
                  Send ↑
                </button>
              )}
            </div>
          </div>

          {status && (
            <p className="small" role="status">
              {status}
            </p>
          )}

          <p
            className="small"
            style={{ textAlign: "center", marginTop: 12 }}
          >
            Leo can make mistakes. Review generated code before using it.
          </p>
        </section>
      </main>
    </div>
  );
}
