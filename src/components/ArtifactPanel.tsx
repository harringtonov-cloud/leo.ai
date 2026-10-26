"use client";

import { useState } from "react";
import { artifactFilename, previewDocument } from "@/lib/artifacts";
import type { Artifact } from "@/lib/artifacts";
import { CopyButton, Markdown } from "@/lib/markdown";

export function ArtifactCard({ artifact, active, onOpen }: { artifact: Artifact; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`artcard ${active ? "active" : ""}`} onClick={onOpen}>
      <span className="arttype">{artifact.type.toUpperCase()}</span>
      <span className="arttitle">{artifact.title}</span>
      <span className="small">{artifact.complete ? "Open" : "Writing…"}</span>
    </button>
  );
}

export function ArtifactPanel({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const canPreview = artifact.type === "html" || artifact.type === "svg" || artifact.type === "markdown";
  const [tab, setTab] = useState<"preview" | "code">(canPreview ? "preview" : "code");
  const doc = previewDocument(artifact);

  function download() {
    const url = URL.createObjectURL(new Blob([artifact.content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = artifactFilename(artifact);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="artpanel" aria-label="Artifact">
      <header className="arthead">
        <div className="arttitle">{artifact.title}</div>
        <div className="actions">
          {canPreview && (
            <>
              <button className={`ghost ${tab === "preview" ? "on" : ""}`} onClick={() => setTab("preview")}>Preview</button>
              <button className={`ghost ${tab === "code" ? "on" : ""}`} onClick={() => setTab("code")}>Code</button>
            </>
          )}
          <CopyButton text={artifact.content} />
          <button className="ghost" onClick={download}>⇩ Download</button>
          <button className="ghost" aria-label="Close artifact" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="artbody">
        {tab === "preview" && doc !== null && (
          // No allow-same-origin: generated pages run in an opaque origin and cannot touch the app, cookies or storage.
          <iframe
            title={artifact.title}
            className="artframe"
            sandbox="allow-scripts allow-forms allow-modals"
            referrerPolicy="no-referrer"
            srcDoc={doc}
          />
        )}
        {tab === "preview" && artifact.type === "markdown" && (
          <div className="artmd"><Markdown text={artifact.content} /></div>
        )}
        {tab === "code" && (
          <pre className="artcode"><code>{artifact.content}</code></pre>
        )}
      </div>
      {!artifact.complete && <div className="small artstatus">Still being written…</div>}
    </aside>
  );
}
