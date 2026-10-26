"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth, db, firebaseConfigured } from "@/lib/firebase";
import {
  addMemory, removeChat, removeMemory, removeProject, saveChat, saveProject,
  subscribeChats, subscribeMemory, subscribeProjects,
} from "@/lib/db";
import { splitArtifacts } from "@/lib/artifacts";
import type { Artifact } from "@/lib/artifacts";
import { fileToAttachment, MAX_ATTACHMENTS } from "@/lib/files";
import type { RunOutput } from "@/lib/markdown";
import { readEventStream } from "@/lib/stream";
import type { Attachment, Chat, MemoryItem, Message, Mode, Project, ToolEvent } from "@/lib/types";
import { ArtifactPanel } from "@/components/ArtifactPanel";
import { AuthModal } from "@/components/AuthModal";
import { MessageView } from "@/components/MessageView";
import { ProjectModal } from "@/components/ProjectModal";
import { SettingsModal } from "@/components/SettingsModal";

type Theme = "dark" | "light";
type Preference = "auto" | "fast" | "reasoning" | "coding";
type ProjectFile = { path: string; content: string };

// Minimal typing for the browser Web Speech API (not in lib.dom for all TS versions).
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const CHATS_KEY = "leo.chats.v1";
const PROJECTS_KEY = "leo.projects.v1";
const ACTIVE_PROJECT_KEY = "leo.project";
const THEME_KEY = "leo.theme";
const PREF_KEY = "leo.pref";
const WEB_KEY = "leo.web";

const PREFERENCES: { id: Preference; label: string }[] = [
  { id: "auto", label: "Auto model" },
  { id: "fast", label: "Fast" },
  { id: "reasoning", label: "Reasoning" },
  { id: "coding", label: "Coding" },
];

const CHAT_SUGGESTIONS = [
  "Find the latest news about electric cars and summarise it",
  "Build a small interactive Pomodoro timer as a web page",
  "Explain a difficult topic in simple words",
  "Write a polite email declining an invitation",
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
    c.messages.every((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
  );
}

function stripHeavy(messages: Message[]): Message[] {
  return messages.map(({ images: _images, ...rest }) => rest);
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

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<Project | null>(null);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [synced, setSynced] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const prevUid = useRef<string | null>(null);
  // Attachment payloads live only in memory for this session (not in history).
  const attachmentData = useRef(new WeakMap<Message, Attachment[]>());

  const canSync = Boolean(user && db && synced);
  chatsRef.current = chats;

  const activeProject = useMemo(() => projects.find((p) => p.id === activeProjectId) ?? null, [projects, activeProjectId]);

  /* ---------- restore local settings ---------- */
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
      const savedPref = localStorage.getItem(PREF_KEY);
      if (PREFERENCES.some((p) => p.id === savedPref)) setPreference(savedPref as Preference);
      if (localStorage.getItem(WEB_KEY) === "off") setWebSearch(false);
      setActiveProjectId(localStorage.getItem(ACTIVE_PROJECT_KEY));

      const raw = localStorage.getItem(CHATS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setChats(parsed.filter(isChat));
      }
      const rawProjects = localStorage.getItem(PROJECTS_KEY);
      if (rawProjects) {
        const parsed: unknown = JSON.parse(rawProjects);
        if (Array.isArray(parsed)) setProjects(parsed as Project[]);
      }
    } catch {
      // Storage unavailable or corrupted: start fresh.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!loaded) return;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(PREF_KEY, preference); } catch {}
  }, [preference, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(WEB_KEY, webSearch ? "on" : "off"); } catch {}
  }, [webSearch, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
      else localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {}
  }, [activeProjectId, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats.map((c) => ({ ...c, messages: stripHeavy(c.messages) })))); } catch {}
  }, [chats, loaded]);

  useEffect(() => {
    if (!loaded || canSync) return; // synced projects live in Firestore
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); } catch {}
  }, [projects, loaded, canSync]);

  /* ---------- authentication ---------- */
  useEffect(() => {
    const firebaseAuth = auth;
    if (!firebaseConfigured || !firebaseAuth) {
      setStatus("Firebase is not configured. Check your environment variables.");
      return;
    }
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        return;
      }
      setUser(null);
      try {
        const credential = await signInAnonymously(firebaseAuth);
        setUser(credential.user);
        setStatus("");
      } catch (error) {
        console.error("Firebase sign-in failed:", error);
        setStatus("Firebase sign-in failed. Check Firebase configuration and enable Anonymous sign-in.");
      }
    });
    return () => unsubscribe();
  }, []);

  /* ---------- cloud sync (chats, projects, memory) ---------- */
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid || !db) { setSynced(false); return; }

    // Switching accounts: leave the previous user's open conversation.
    if (prevUid.current && prevUid.current !== uid) {
      setMessages([]);
      setChats([]);
      setProjects([]);
      setActiveProjectId(null);
      setChatId(newId());
    }
    prevUid.current = uid;

    const onError = (error: Error) => {
      console.error("Firestore sync failed:", error);
      setSynced(false);
      setStatus("Cloud sync is unavailable (check Firestore rules). Using this browser only.");
    };

    const unsubChats = subscribeChats(uid, (remote) => { setSynced(true); setChats(remote); }, onError);
    const unsubProjects = subscribeProjects(uid, (remote) => { setProjects(remote); }, onError);
    const unsubMemory = subscribeMemory(uid, setMemory, () => {});
    return () => { unsubChats(); unsubProjects(); unsubMemory(); };
  }, [uid]);

  /* ---------- keep the current conversation in the history list ---------- */
  useEffect(() => {
    if (!loaded || busy || messages.length === 0) return;
    const existing = chatsRef.current.find((c) => c.id === chatId);
    if (existing && existing.messages === messages) return;

    const first = messages.find((m) => m.role === "user")?.content || "New chat";
    const entry: Chat = {
      id: chatId,
      // Keep a title the user renamed; only derive one for new chats.
      title: existing?.title || first.replace(/\s+/g, " ").slice(0, 48),
      messages,
      mode,
      projectId: activeProjectId ?? undefined,
      pinned: existing?.pinned,
      updatedAt: Date.now(),
    };
    setChats((previous) => [entry, ...previous.filter((c) => c.id !== chatId)].slice(0, 100));
    if (canSync && uid) saveChat(uid, entry).catch((e) => console.error("Saving chat failed:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, chatId, mode, loaded, busy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  /* ---------- artifacts ---------- */
  const artifacts = useMemo(() => {
    const found: Artifact[] = [];
    messages.forEach((m, i) => {
      if (m.role !== "assistant" || m.error) return;
      for (const s of splitArtifacts(m.content, i)) if (s.kind === "artifact") found.push(s.artifact);
    });
    return found;
  }, [messages]);
  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId) ?? null;

  // Open a new artifact automatically as soon as the model starts writing it.
  const knownArtifacts = useRef(new Set<string>());
  useEffect(() => {
    for (const a of artifacts) {
      if (!knownArtifacts.current.has(a.id)) {
        knownArtifacts.current.add(a.id);
        if (busy) setActiveArtifactId(a.id);
      }
    }
  }, [artifacts, busy]);

  /* ---------- helpers ---------- */
  async function token(): Promise<string> {
    if (!firebaseConfigured || !auth) return "";
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("Firebase sign-in is not ready. Please try again.");
    return currentUser.getIdToken();
  }

  async function authHeaders() {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const idToken = await token();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    return headers;
  }

  async function runChat(history: Message[]) {
    setMessages(history);
    setBusy(true);
    setStatus("");

    const controller = new AbortController();
    abortRef.current = controller;

    let content = "";
    let tools: ToolEvent[] = [];
    let sources: NonNullable<Message["sources"]> = [];
    let images: string[] = [];
    let failure = "";

    const snapshot = (): Message => ({
      role: "assistant",
      content: failure && !content ? `Error: ${failure}` : content + (failure && content ? `\n\n[Error: ${failure}]` : ""),
      error: Boolean(failure && !content),
      tools: tools.length ? tools : undefined,
      sources: sources.length ? sources : undefined,
      images: images.length ? images : undefined,
    });

    try {
      const headers = await authHeaders();
      const lastUserIndex = history.map((m) => m.role).lastIndexOf("user");

      const payload = history
        .filter((m) => !m.error)
        .slice(-30)
        .map((m) => {
          const data = attachmentData.current.get(m);
          const isLastUser = history.indexOf(m) === lastUserIndex;
          return {
            role: m.role,
            content: m.content.slice(0, 20_000),
            ...(isLastUser && data?.length ? { attachments: data } : {}),
          };
        });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          messages: payload,
          mode,
          preference,
          webSearch,
          files: mode === "code" ? projectFiles.slice(0, 35) : [],
          project: activeProject
            ? { name: activeProject.name, instructions: activeProject.instructions, files: activeProject.files }
            : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "The request failed.");
      }
      if (!response.body) throw new Error("The server returned an invalid response.");

      await readEventStream(response.body, (event) => {
        switch (event.t) {
          case "meta":
            setStatus(`Model: ${event.model}`);
            break;
          case "text":
            content += event.d;
            break;
          case "tool": {
            const next: ToolEvent = { id: event.id, name: event.name, label: event.label, status: event.status };
            tools = tools.some((t) => t.id === event.id) ? tools.map((t) => (t.id === event.id ? next : t)) : [...tools, next];
            break;
          }
          case "sources":
            sources = [...sources, ...event.items];
            break;
          case "images":
            images = [...images, ...event.items];
            break;
          case "error":
            failure = event.message;
            break;
          default:
            break;
        }
        setMessages([...history, snapshot()]);
      });

      if (!content.trim() && !failure && tools.length === 0 && images.length === 0) {
        failure = "The model returned an empty response.";
      }
      setMessages([...history, snapshot()]);
    } catch (error) {
      if (controller.signal.aborted) {
        setStatus("Stopped.");
        if (content || tools.length) setMessages([...history, snapshot()]);
        return;
      }
      failure = error instanceof Error ? error.message : "Unknown error";
      setMessages([...history, snapshot()]);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function send() {
    const text = prompt.trim();
    if ((!text && attachments.length === 0) || busy) return;

    const message: Message = {
      role: "user",
      content: text || "Please look at the attached file(s).",
      attachments: attachments.length ? attachments.map((a) => ({ kind: a.kind, name: a.name })) : undefined,
    };
    if (attachments.length) attachmentData.current.set(message, attachments);

    setPrompt("");
    setAttachments([]);
    await runChat([...messages, message]);
  }

  async function regenerate() {
    if (busy || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const history = last.role === "assistant" ? messages.slice(0, -1) : messages;
    if (history.length === 0) return;
    await runChat(history);
  }

  async function editMessage(index: number, text: string) {
    const old = messages[index];
    const value = text.trim();
    if (busy || !old || old.role !== "user" || !value) return;
    const edited: Message = { ...old, content: value };
    const data = attachmentData.current.get(old);
    if (data) attachmentData.current.set(edited, data);
    setActiveArtifactId(null);
    await runChat([...messages.slice(0, index), edited]);
  }

  function updateChatMeta(id: string, patch: Partial<Pick<Chat, "title" | "pinned">>) {
    const current = chatsRef.current.find((c) => c.id === id);
    if (!current) return;
    const next: Chat = { ...current, ...patch };
    setChats((previous) => previous.map((c) => (c.id === id ? next : c)));
    if (canSync && uid) saveChat(uid, next).catch((e) => console.error("Updating chat failed:", e));
  }

  function renameChat(chat: Chat) {
    const title = window.prompt("Rename chat", chat.title)?.trim();
    if (title) updateChatMeta(chat.id, { title: title.slice(0, 80) });
  }

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setStatus("Voice input is not supported in this browser. Try Chrome, Edge or Safari.");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) setPrompt((prev) => (prev && !prev.endsWith(" ") ? prev + " " : prev) + finalText.trim());
    };
    recognition.onerror = (event) => {
      setStatus(event.error === "not-allowed" ? "Microphone access was denied." : `Voice input error: ${event.error}`);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  }

  async function runCode(code: string): Promise<RunOutput> {
    const response = await fetch("/api/sandbox", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ code }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Sandbox request failed.");

    const parts = [
      data?.stdout,
      data?.stderr ? `stderr:\n${data.stderr}` : "",
      data?.error ? `error: ${data.error}` : "",
      ...(Array.isArray(data?.results) ? data.results : []),
    ].filter((part) => typeof part === "string" && part.trim());

    const images: string[] = Array.isArray(data?.images) ? data.images.filter((i: unknown) => typeof i === "string") : [];
    return { text: parts.join("\n") || (images.length ? "" : "(no output)"), images };
  }

  function stop() {
    abortRef.current?.abort();
  }

  /* ---------- attachments ---------- */
  async function addAttachments(files: File[]) {
    if (files.length === 0) return;
    const next = [...attachments];
    for (const file of files) {
      if (next.length >= MAX_ATTACHMENTS) {
        setStatus(`At most ${MAX_ATTACHMENTS} attachments per message.`);
        break;
      }
      try {
        next.push(await fileToAttachment(file));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not attach the file.");
      }
    }
    const total = next.reduce((sum, a) => sum + a.data.length, 0);
    if (total > 3_800_000) {
      setStatus("Attachments are too large in total (about 4 MB limit). Remove some.");
      return;
    }
    setAttachments(next);
    if (attachRef.current) attachRef.current.value = "";
  }

  /* ---------- ZIP project context (Leo Code) ---------- */
  async function uploadZip(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) { setStatus("Choose a .zip archive."); return; }
    if (file.size > 10 * 1024 * 1024) { setStatus("ZIP limit is 10 MB."); return; }
    setStatus("Reading archive locally…");

    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file, { checkCRC32: true });
      const output: ProjectFile[] = [];
      let totalCharacters = 0;

      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || path.startsWith("/") || path.split("/").includes("..")) continue;
        if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|exe|dll|so|dylib|mp4|mp3|woff2?)$/i.test(path)) continue;
        if (/(^|\/)(node_modules|\.git|\.next|dist|build)\//.test(path) || /(^|\/)\.env($|\.(?!example))/.test(path)) continue;
        if (output.length >= 80) break;

        const content = await entry.async("string");
        if (totalCharacters + content.length > 300_000) break;
        totalCharacters += content.length;
        output.push({ path, content: content.slice(0, 20_000) });
      }

      setProjectFiles(output);
      setZipName(file.name);
      setMode("code");
      setStatus(`Loaded ${output.length} text files. Files are provided as context only.`);
    } catch (error) {
      console.error("ZIP loading failed:", error);
      setStatus("Could not read ZIP. Check that the archive is valid.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /* ---------- chats ---------- */
  function newChat() {
    abortRef.current?.abort();
    setChatId(newId());
    setMessages([]);
    setStatus("");
    setPrompt("");
    setAttachments([]);
    setActiveArtifactId(null);
    knownArtifacts.current = new Set();
    setMenuOpen(false);
  }

  function openChat(chat: Chat) {
    abortRef.current?.abort();
    setChatId(chat.id);
    setMessages(chat.messages);
    setMode(chat.mode);
    setActiveProjectId(chat.projectId && projects.some((p) => p.id === chat.projectId) ? chat.projectId : null);
    setStatus("");
    setAttachments([]);
    setActiveArtifactId(null);
    knownArtifacts.current = new Set();
    // Artifacts from a loaded chat should not pop open by themselves.
    chat.messages.forEach((m, i) => {
      if (m.role === "assistant") for (const s of splitArtifacts(m.content, i)) if (s.kind === "artifact") knownArtifacts.current.add(s.artifact.id);
    });
    setMenuOpen(false);
  }

  function deleteChat(id: string) {
    setChats((previous) => previous.filter((c) => c.id !== id));
    if (canSync && uid) removeChat(uid, id).catch((e) => console.error("Deleting chat failed:", e));
    if (id === chatId) newChat();
  }

  function exportChat() {
    if (messages.length === 0) { setStatus("Nothing to export yet."); return; }
    const markdown = messages.map((m) => `### ${m.role === "user" ? "You" : "Leo"}\n\n${m.content}`).join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "leo-chat.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- projects & memory ---------- */
  async function handleSaveProject(project: Project) {
    if (canSync && uid) await saveProject(uid, project);
    else setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
    setActiveProjectId(project.id);
  }

  async function handleDeleteProject(project: Project) {
    if (canSync && uid) await removeProject(uid, project.id);
    else setProjects((prev) => prev.filter((p) => p.id !== project.id));
    if (activeProjectId === project.id) setActiveProjectId(null);
  }

  const visibleChats = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? chats.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
      : chats;
    return [...filtered].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
  }, [chats, search]);

  const suggestions = mode === "chat" ? CHAT_SUGGESTIONS : CODE_SUGGESTIONS;
  const accountLabel = !user ? "Preview" : user.isAnonymous ? "Guest · Sign in" : user.email || user.displayName || "Account";

  return (
    <div className={`shell ${activeArtifact ? "withpanel" : ""}`}>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}

      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">leo<span>·</span>ai</div>

        <button className="newbtn" onClick={newChat}>＋ New chat</button>

        <div className="small">WORKSPACE</div>
        <button className={`navbtn ${mode === "chat" ? "active" : ""}`} onClick={() => { setMode("chat"); setMenuOpen(false); }}>◌　Leo Chat</button>
        <button className={`navbtn ${mode === "code" ? "active" : ""}`} onClick={() => { setMode("code"); setMenuOpen(false); }}>⌘　Leo Code</button>

        <div className="small">PROJECTS</div>
        <div className="projlist">
          <button className={`navbtn slim ${activeProjectId === null ? "active" : ""}`} onClick={() => setActiveProjectId(null)}>No project</button>
          {projects.map((p) => (
            <div key={p.id} className="hrow">
              <button className={`navbtn slim grow ${activeProjectId === p.id ? "active" : ""}`} onClick={() => { setActiveProjectId(p.id); setMenuOpen(false); }} title={p.name}>▣ {p.name}</button>
              <button className="ghost" aria-label={`Edit ${p.name}`} onClick={() => setProjectModal(p)}>✎</button>
            </div>
          ))}
          <button className="navbtn slim" onClick={() => setProjectModal({ id: newId(), name: "", instructions: "", files: [], updatedAt: Date.now() })}>＋ New project</button>
        </div>

        <div className="small">HISTORY</div>
        <input className="field searchbox" type="search" placeholder="Search chats…" aria-label="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="history">
          {chats.length === 0 && <div className="small">Your conversations will appear here.</div>}
          {chats.length > 0 && visibleChats.length === 0 && <div className="small">No chats match “{search}”.</div>}
          {visibleChats.map((chat) => (
            <div key={chat.id} className={`hrow ${chat.id === chatId ? "active" : ""}`}>
              <button className="htitle" onClick={() => openChat(chat)} title={chat.title}>
                {chat.pinned ? "📌 " : chat.mode === "code" ? "⌘ " : "◌ "}
                {chat.title}
              </button>
              <button className="hdel" aria-label={chat.pinned ? "Unpin chat" : "Pin chat"} onClick={() => updateChatMeta(chat.id, { pinned: !chat.pinned })}>📌</button>
              <button className="hdel" aria-label="Rename chat" onClick={() => renameChat(chat)}>✎</button>
              <button className="hdel" aria-label="Delete chat" onClick={() => deleteChat(chat.id)}>×</button>
            </div>
          ))}
        </div>

        <div className="sidebar-foot small">
          <div className="actions" style={{ marginBottom: 10 }}>
            <button className="secondary" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
            <button className="secondary" onClick={exportChat}>⇩ Export</button>
            <button className="secondary" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
          </div>
          {canSync ? "Synced to your account." : "Stored in this browser only."}
          <br />
          Leo · 0.3
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="actions">
            <button className="secondary mobile-only" aria-label="Open menu" onClick={() => setMenuOpen(true)}>☰</button>
            <span>{mode === "chat" ? "Leo Chat" : "Leo Code"}{activeProject ? ` · ${activeProject.name}` : ""}</span>
          </div>

          <div className="actions">
            <button className="secondary mobile-only" onClick={() => setMode(mode === "chat" ? "code" : "chat")}>{mode === "chat" ? "Leo Code" : "Leo Chat"}</button>
            <select className="select" aria-label="Model preference" value={preference} onChange={(event) => setPreference(event.target.value as Preference)}>
              {PREFERENCES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button className="badge" onClick={() => setAuthOpen(true)}>{accountLabel}</button>
          </div>
        </header>

        <section className="workspace">
          {messages.length === 0 ? (
            <div className="welcome">
              <h1>{mode === "chat" ? "What can I help you with?" : "Let's build something."}</h1>
              <div className="subtitle">
                {mode === "chat"
                  ? "Ask questions, attach files or images, search the web, run code and build pages."
                  : "Upload a project ZIP and ask Leo to explain, review, or propose code changes."}
              </div>
              <div className="chips">
                {suggestions.map((text) => (
                  <button key={text} className="chip" onClick={() => setPrompt(text)}>{text}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((message, index) => (
                <MessageView
                  key={`${index}-${message.role}`}
                  message={message}
                  index={index}
                  isLast={index === messages.length - 1}
                  busy={busy}
                  activeArtifactId={activeArtifactId}
                  onRunCode={runCode}
                  onOpenArtifact={(a) => setActiveArtifactId(a.id)}
                  onRegenerate={() => void regenerate()}
                  onEdit={(text) => void editMessage(index, text)}
                />
              ))}

              {busy && messages[messages.length - 1]?.role === "user" && (
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
              {zipName ? `${zipName} · ${projectFiles.length} text files available as context` : "Upload a ZIP archive to let Leo inspect text files."}
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="secondary" onClick={() => fileRef.current?.click()}>＋ Upload ZIP</button>
                {zipName && (
                  <button className="secondary" onClick={() => { setZipName(""); setProjectFiles([]); setStatus("Project removed."); }}>Remove project</button>
                )}
                <input ref={fileRef} hidden type="file" accept=".zip,application/zip" onChange={(event) => uploadZip(event.target.files?.[0])} />
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                Files are sent as context. This version does not execute uploaded code or automatically modify the ZIP archive. ZIP contents are not saved in chat history.
              </div>
            </div>
          )}

          <div
            className={`composer ${dragOver ? "drag" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void addAttachments(Array.from(e.dataTransfer.files)); }}
          >
            {attachments.length > 0 && (
              <div className="attlist">
                {attachments.map((a, i) => (
                  <span key={`${a.name}-${i}`} className="attchip">
                    {a.kind === "image" ? "🖼" : a.kind === "pdf" ? "📄" : "📎"} {a.name}
                    <button className="ghost" aria-label={`Remove ${a.name}`} onClick={() => setAttachments(attachments.filter((_, n) => n !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length) { event.preventDefault(); void addAttachments(files); }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={mode === "chat" ? "Message Leo… (drop or paste files and images)" : "Ask Leo to review or change your project…"}
            />

            <div className="compose-bottom">
              <div className="actions">
                <input ref={attachRef} hidden multiple type="file" accept="image/*,.pdf,.docx,text/*,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.html,.css,.sql,.yml,.yaml,.sh" onChange={(e) => void addAttachments(Array.from(e.target.files ?? []))} />
                <button className="secondary" onClick={() => attachRef.current?.click()} aria-label="Attach files">📎 Attach</button>
                <button className={`secondary ${listening ? "toggled" : ""}`} aria-pressed={listening} onClick={toggleVoice} title="Dictate with your microphone">{listening ? "■ Listening…" : "🎤 Voice"}</button>
                <button className={`secondary ${webSearch ? "toggled" : ""}`} aria-pressed={webSearch} onClick={() => setWebSearch(!webSearch)} title="Allow web search and page reading">🌐 Web {webSearch ? "on" : "off"}</button>
                <span className="small">Shift + Enter for new line</span>
              </div>

              {busy ? (
                <button className="secondary" onClick={stop}>■ Stop</button>
              ) : (
                <button className="primary" disabled={!prompt.trim() && attachments.length === 0} onClick={() => void send()}>Send ↑</button>
              )}
            </div>
          </div>

          {status && <p className="small" role="status">{status}</p>}

          <p className="small" style={{ textAlign: "center", marginTop: 12 }}>
            Leo can make mistakes. Check important facts and review generated code before using it.
          </p>
        </section>
      </main>

      {activeArtifact && <ArtifactPanel artifact={activeArtifact} onClose={() => setActiveArtifactId(null)} />}

      {authOpen && <AuthModal user={user} onClose={() => setAuthOpen(false)} />}

      {settingsOpen && (
        <SettingsModal
          memory={memory}
          canSync={canSync}
          webSearch={webSearch}
          onWebSearch={setWebSearch}
          onAddMemory={async (text) => { if (uid) await addMemory(uid, text); }}
          onDeleteMemory={async (id) => { if (uid) await removeMemory(uid, id); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {projectModal && (
        <ProjectModal
          project={projectModal}
          onSave={handleSaveProject}
          onDelete={projects.some((p) => p.id === projectModal.id) ? () => handleDeleteProject(projectModal) : undefined}
          onClose={() => setProjectModal(null)}
        />
      )}
    </div>
  );
}
