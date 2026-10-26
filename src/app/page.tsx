"use client";

import { useEffect, useRef, useState } from "react";
import { signInAnonymously, signOut, onAuthStateChanged, User } from "firebase/auth";
import { auth, firebaseConfigured } from "@/lib/firebase";

type Message = { role: "user" | "assistant"; content: string };
type Mode = "chat" | "code";

export default function Home() {
  const [mode, setMode] = useState<Mode>("chat");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [zipName, setZipName] = useState("");
  const [projectFiles, setProjectFiles] = useState<{path:string; content:string}[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Anonymous sign-in keeps the starter easy to try. Add email/password or OAuth later.
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async current => {
      if (current) setUser(current);
      else {
        try { await signInAnonymously(auth); } catch { setStatus("Firebase Auth is not ready. Configure Firebase or use local demo mode."); }
      }
    });
    return () => unsubscribe();
  }, []);

  async function token() {
    if (!firebaseConfigured || !auth) return "";
    const current = auth.currentUser;
    if (!current) throw new Error("Signing in to Firebase… please try again.");
    return current.getIdToken();
  }

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    const next = [...messages, {role:"user" as const, content:text}];
    setMessages(next); setPrompt(""); setBusy(true); setStatus("");
    try {
      const idToken = await token();
      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json", ...(idToken ? {Authorization:`Bearer ${idToken}`} : {})},
        body:JSON.stringify({messages:next, mode, files: mode === "code" ? projectFiles.slice(0,35) : []})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMessages([...next, {role:"assistant", content:data.content}]);
      setStatus(`Selected model: ${data.model}`);
    } catch (e) {
      setMessages([...next, {role:"assistant", content:`Error: ${e instanceof Error ? e.message : "Unknown error"}`}]);
    } finally { setBusy(false); }
  }

  async function uploadZip(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) { setStatus("Choose a .zip archive."); return; }
    if (file.size > 10 * 1024 * 1024) { setStatus("ZIP limit is 10 MB in this starter."); return; }
    setStatus("Reading archive locally…");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file, {checkCRC32:true});
      const out: {path:string;content:string}[] = [];
      let total = 0;
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || path.startsWith("/") || path.split("/").includes("..")) continue;
        if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|exe|dll|so|dylib|mp4|mp3|woff2?)$/i.test(path)) continue;
        if (out.length >= 80) break;
        const content = await entry.async("string");
        total += content.length;
        if (total > 300_000) break;
        out.push({path, content:content.slice(0,20_000)});
      }
      setProjectFiles(out); setZipName(file.name); setMode("code");
      setStatus(`Loaded ${out.length} text files for AI context. No commands have been run.`);
    } catch { setStatus("Could not read ZIP. Make sure it is a valid archive."); }
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">leo<span>·</span>ai</div>
      <button className="newbtn" onClick={() => {setMessages([]);setStatus("");}}>＋ New chat</button>
      <div className="small">WORKSPACE</div>
      <button className={`navbtn ${mode==="chat"?"active":""}`} onClick={()=>setMode("chat")}>◌　Leo Chat</button>
      <button className={`navbtn ${mode==="code"?"active":""}`} onClick={()=>setMode("code")}>⌘　Leo Code</button>
      <div className="sidebar-foot small">A calm workspace for thinking and building.<br/><br/>Starter version · 0.1</div>
    </aside>
    <main className="main">
      <header className="topbar">
        <span>{mode==="chat" ? "Leo Chat" : "Leo Code"}</span>
        <div className="actions"><span className="badge">Auto model</span><span className="badge">{user ? "Signed in" : "Preview"}</span></div>
      </header>
      <section className="workspace">
        {messages.length === 0 ? <div className="welcome">
          <h1>{mode==="chat" ? "What can I help you with?" : "Let's build something."}</h1>
          <div className="subtitle">{mode==="chat" ? "Ask questions, explore ideas, or work through a difficult problem." : "Upload a project ZIP and ask Leo to explain, review, or propose code changes."}</div>
        </div> : <div className="messages">{messages.map((m,i)=><article className={`msg ${m.role}`} key={i}><div className="role">{m.role==="user"?"You":"Leo"}</div>{m.content}</article>)}</div>}
        {mode==="code" && <div className="notice" style={{marginBottom:14}}>
          <strong>Project workspace</strong><br/>
          {zipName ? `${zipName} · ${projectFiles.length} text files available as context` : "Upload a ZIP archive to let Leo inspect text files."}
          <div className="actions" style={{marginTop:10}}>
            <button className="secondary" onClick={()=>fileRef.current?.click()}>＋ Upload ZIP</button>
            {zipName && <button className="secondary" onClick={()=>{setZipName("");setProjectFiles([]);}}>Remove project</button>}
            <input ref={fileRef} hidden type="file" accept=".zip,application/zip" onChange={e=>uploadZip(e.target.files?.[0])}/>
          </div>
          <div className="small" style={{marginTop:8}}>This starter only sends selected text files as context. It does not execute ZIP contents or apply edits to the archive yet.</div>
        </div>}
        <div className="composer">
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder={mode==="chat"?"Message Leo…":"Ask Leo to review or change your project…"} />
          <div className="compose-bottom">
            <div className="actions"><span className="small">Shift + Enter for new line</span>{mode==="chat" && <button className="secondary" onClick={()=>setMode("code")}>Open Leo Code</button>}</div>
            <button className="primary" disabled={busy||!prompt.trim()} onClick={send}>{busy?"Thinking…":"Send ↑"}</button>
          </div>
        </div>
        {status && <p className="small" role="status">{status}</p>}
        <p className="small" style={{textAlign:"center",marginTop:12}}>Leo can make mistakes. Review generated code before using it.</p>
      </section>
    </main>
  </div>;
}
