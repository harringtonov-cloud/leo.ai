"use client";

import { useState } from "react";
import type { MemoryItem } from "@/lib/types";

export function SettingsModal({
  memory, canSync, webSearch, onWebSearch, style, onStyle, instructions, onInstructions, onAddMemory, onDeleteMemory, onClose,
}: {
  memory: MemoryItem[];
  canSync: boolean;
  webSearch: boolean;
  onWebSearch: (value: boolean) => void;
  style: string;
  onStyle: (value: string) => void;
  instructions: string;
  onInstructions: (value: string) => void;
  onAddMemory: (text: string) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  async function add() {
    const value = text.trim();
    if (!value) return;
    try {
      await onAddMemory(value);
      setText("");
      setError("");
    } catch {
      setError("Could not save. Check Firestore rules and your connection.");
    }
  }

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Settings & memory</strong>
          <button className="ghost" onClick={onClose} aria-label="Close">×</button>
        </div>

        <label className="switch">
          <input type="checkbox" checked={webSearch} onChange={(e) => onWebSearch(e.target.checked)} />
          <span>Let Leo search the web and read pages</span>
        </label>

        <h4 className="mdh">Personalisation</h4>
        <label className="small" htmlFor="leo-style">Response style</label>
        <select id="leo-style" className="select" style={{ display: "block", margin: "4px 0 10px" }} value={style} onChange={(e) => onStyle(e.target.value)}>
          <option value="">Normal</option>
          <option value="concise">Concise</option>
          <option value="explanatory">Explanatory</option>
          <option value="formal">Formal</option>
          <option value="friendly">Friendly</option>
        </select>
        <label className="small" htmlFor="leo-instructions">Custom instructions (applied to every chat, saved in this browser)</label>
        <textarea id="leo-instructions" className="field" rows={4} maxLength={2000} placeholder="e.g. Answer in Russian. I am a backend developer; skip basic explanations." value={instructions} onChange={(e) => onInstructions(e.target.value)} />

        <h4 className="mdh">Memory</h4>
        <p className="small">Short facts Leo can use in every chat. Leo saves one when you ask it to “remember” something. You can add or delete items here. Do not store passwords or sensitive personal data.</p>

        {!canSync ? (
          <p className="small">Memory needs Firebase and Firestore to be configured.</p>
        ) : (
          <>
            <div className="actions" style={{ marginBottom: 10 }}>
              <input className="field" style={{ flex: 1, margin: 0 }} maxLength={300} placeholder="e.g. I prefer short answers" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
              <button className="secondary" onClick={() => void add()} disabled={!text.trim()}>Add</button>
            </div>
            {error && <p className="small" style={{ color: "var(--err)" }}>{error}</p>}
            <div className="memlist">
              {memory.length === 0 && <div className="small">Nothing saved yet.</div>}
              {memory.map((item) => (
                <div key={item.id} className="memrow">
                  <span>{item.text}</span>
                  <button className="ghost" aria-label="Delete memory item" onClick={() => void onDeleteMemory(item.id)}>×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
