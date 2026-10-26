
"use client";

import { useEffect, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { auth, firebaseConfigured } from "@/lib/firebase";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Mode = "chat" | "code";

type ProjectFile = {
  path: string;
  content: string;
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("chat");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [zipName, setZipName] = useState("");
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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
      throw new Error(
        "Firebase sign-in is not ready. Please try again."
      );
    }

    return currentUser.getIdToken();
  }

  async function send() {
    const text = prompt.trim();

    if (!text || busy) return;

    const next: Message[] = [
      ...messages,
      { role: "user", content: text },
    ];

    setMessages(next);
    setPrompt("");
    setBusy(true);
    setStatus("");

    try {
      const idToken = await token();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: next,
          mode,
          files: mode === "code" ? projectFiles.slice(0, 35) : [],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "The request failed.");
      }

      if (typeof data.content !== "string") {
        throw new Error("The server returned an invalid response.");
      }

      setMessages([
        ...next,
        { role: "assistant", content: data.content },
      ]);

      setStatus(
        typeof data.model === "string"
          ? `Selected model: ${data.model}`
          : "Response received."
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";

      setMessages([
        ...next,
        { role: "assistant", content: `Error: ${message}` },
      ]);
    } finally {
      setBusy(false);
    }
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

  function clearChat() {
    setMessages([]);
    setStatus("");
    setPrompt("");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          leo<span>·</span>ai
        </div>

        <button className="newbtn" onClick={clearChat}>
          ＋ New chat
        </button>

        <div className="small">WORKSPACE</div>

        <button
          className={`navbtn ${mode === "chat" ? "active" : ""}`}
          onClick={() => setMode("chat")}
        >
          ◌　Leo Chat
        </button>

        <button
          className={`navbtn ${mode === "code" ? "active" : ""}`}
          onClick={() => setMode("code")}
        >
          ⌘　Leo Code
        </button>

        <div className="sidebar-foot small">
          A calm workspace for thinking and building.
          <br />
          <br />
          Starter version · 0.1
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <span>{mode === "chat" ? "Leo Chat" : "Leo Code"}</span>

          <div className="actions">
            <span className="badge">Auto model</span>
            <span className="badge">
              {user ? "Signed in" : "Preview"}
            </span>
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
            </div>
          ) : (
            <div className="messages">
              {messages.map((message, index) => (
                <article
                  className={`msg ${message.role}`}
                  key={`${index}-${message.role}`}
                >
                  <div className="role">
                    {message.role === "user" ? "You" : "Leo"}
                  </div>
                  {message.content}
                </article>
              ))}
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
                  onChange={(event) =>
                    uploadZip(event.target.files?.[0])
                  }
                />
              </div>

              <div className="small" style={{ marginTop: 8 }}>
                Files are sent as context. This version does not execute
                uploaded code or automatically modify the ZIP archive.
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
                <span className="small">
                  Shift + Enter for new line
                </span>

                {mode === "chat" && (
                  <button
                    className="secondary"
                    onClick={() => setMode("code")}
                  >
                    Open Leo Code
                  </button>
                )}
              </div>

              <button
                className="primary"
                disabled={busy || !prompt.trim()}
                onClick={() => void send()}
              >
                {busy ? "Thinking…" : "Send ↑"}
              </button>
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
