"use client";

import { useMemo } from "react";
import { splitArtifacts } from "@/lib/artifacts";
import type { Artifact } from "@/lib/artifacts";
import { CopyButton, Markdown } from "@/lib/markdown";
import type { RunOutput } from "@/lib/markdown";
import type { Message } from "@/lib/types";
import { ArtifactCard } from "@/components/ArtifactPanel";

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function MessageView({
  message, index, isLast, busy, activeArtifactId, onRunCode, onOpenArtifact, onRegenerate,
}: {
  message: Message;
  index: number;
  isLast: boolean;
  busy: boolean;
  activeArtifactId: string | null;
  onRunCode: (code: string) => Promise<RunOutput>;
  onOpenArtifact: (artifact: Artifact) => void;
  onRegenerate: () => void;
}) {
  const segments = useMemo(
    () => (message.role === "assistant" && !message.error ? splitArtifacts(message.content, index) : []),
    [message.content, message.role, message.error, index]
  );

  // Text shown/copied without the artifact bodies, which live in the side panel.
  const plainText = segments.filter((s) => s.kind === "text").map((s) => (s.kind === "text" ? s.text : "")).join("").trim();

  return (
    <article className={`msg ${message.role} ${message.error ? "err" : ""}`}>
      <div className="role">{message.role === "user" ? "You" : "Leo"}</div>

      {message.role === "user" && message.attachments && message.attachments.length > 0 && (
        <div className="attlist">
          {message.attachments.map((a, n) => (
            <span key={n} className="attchip">{a.kind === "image" ? "🖼" : a.kind === "pdf" ? "📄" : "📎"} {a.name}</span>
          ))}
        </div>
      )}

      {message.role === "assistant" && message.tools && message.tools.length > 0 && (
        <div className="toollist">
          {message.tools.map((t) => (
            <div key={t.id} className={`toolrow ${t.status}`}>
              <span>{t.status === "running" ? "◌" : t.status === "done" ? "✓" : "!"}</span> {t.label}
            </div>
          ))}
        </div>
      )}

      {message.role === "assistant" && !message.error ? (
        segments.map((segment, n) =>
          segment.kind === "text" ? (
            segment.text.trim() ? <Markdown key={n} text={segment.text} onRunCode={onRunCode} /> : null
          ) : (
            <ArtifactCard
              key={n}
              artifact={segment.artifact}
              active={activeArtifactId === segment.artifact.id}
              onOpen={() => onOpenArtifact(segment.artifact)}
            />
          )
        )
      ) : (
        <div className="plain">{message.content}</div>
      )}

      {message.images?.map((png, n) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={n} className="codeimg" alt={`Generated chart ${n + 1}`} src={`data:image/png;base64,${png}`} />
      ))}

      {message.sources && message.sources.length > 0 && (
        <div className="sources">
          <div className="small">Sources</div>
          {message.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer nofollow" title={s.title}>
              {hostOf(s.url)}
            </a>
          ))}
        </div>
      )}

      {message.role === "assistant" && (
        <div className="msg-actions">
          {!message.error && plainText && <CopyButton text={plainText} />}
          {isLast && !busy && (
            <button className="ghost" onClick={onRegenerate}>↻ {message.error ? "Retry" : "Regenerate"}</button>
          )}
        </div>
      )}
    </article>
  );
}
