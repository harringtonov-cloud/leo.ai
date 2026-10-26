"use client";

import { useRef, useState } from "react";
import type { KnowledgeFile, Project } from "@/lib/types";

const TEXT_OK = /\.(txt|md|markdown|csv|json|ya?ml|toml|html?|css|js|jsx|ts|tsx|py|go|rs|java|c|h|cpp|cs|php|sh|sql|xml|log)$/i;

export function ProjectModal({
  project, onSave, onDelete, onClose,
}: {
  project: Project;
  onSave: (project: Project) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [instructions, setInstructions] = useState(project.instructions);
  const [files, setFiles] = useState<KnowledgeFile[]>(project.files);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    const skipped: string[] = [];
    for (const file of Array.from(list)) {
      if (next.length >= 30 || file.size > 1_000_000 || !(file.type.startsWith("text/") || TEXT_OK.test(file.name))) {
        skipped.push(file.name);
        continue;
      }
      next.push({ name: file.name, content: (await file.text()).slice(0, 40_000) });
    }
    setFiles(next);
    setMessage(skipped.length ? `Skipped (text only, ≤1 MB, max 30 files): ${skipped.join(", ")}` : "");
    if (input.current) input.current.value = "";
  }

  async function save() {
    if (!name.trim()) { setMessage("Give the project a name."); return; }
    setBusy(true);
    try {
      await onSave({ ...project, name: name.trim(), instructions, files, updatedAt: Date.now() });
      onClose();
    } catch {
      setMessage("Could not save the project. Check Firestore rules and your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Project" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Project</strong>
          <button className="ghost" onClick={onClose} aria-label="Close">×</button>
        </div>

        <input className="field" maxLength={100} placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="field" rows={5} maxLength={4000} placeholder="Instructions for every chat in this project (tone, role, rules…)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />

        <div className="small" style={{ margin: "6px 0" }}>Knowledge files (text/code only). They are sent as context in every chat of this project.</div>
        <div className="memlist">
          {files.length === 0 && <div className="small">No files yet.</div>}
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="memrow">
              <span>{f.name} <span className="small">· {Math.ceil(f.content.length / 1000)}k chars</span></span>
              <button className="ghost" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, n) => n !== i))}>×</button>
            </div>
          ))}
        </div>
        <input ref={input} hidden multiple type="file" onChange={(e) => void addFiles(e.target.files)} />
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={() => input.current?.click()}>＋ Add files</button>
          <button className="primary" disabled={busy} onClick={() => void save()}>Save project</button>
          {onDelete && <button className="secondary" disabled={busy} onClick={() => void onDelete().then(onClose)}>Delete</button>}
        </div>
        {message && <p className="small" role="status">{message}</p>}
      </div>
    </div>
  );
}
