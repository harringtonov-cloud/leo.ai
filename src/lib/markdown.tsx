"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className="ghost"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

function inline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${index++}`;

    if (token.startsWith("`")) {
      parts.push(
        <code key={key} className="icode">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    }

    last = match.index + token.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="codeblock">
      <div className="codehead">
        <span>{lang || "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const isBullet = (line: string) => /^\s*[-*]\s+/.test(line);
const isNumbered = (line: string) => /^\s*\d+[.)]\s+/.test(line);
const isHeading = (line: string) => /^#{1,4}\s+/.test(line);
const isFence = (line: string) => /^\s*```/.test(line);

/** Small, dependency-free Markdown renderer: code blocks, headings, lists, bold, inline code. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;

    if (isFence(line)) {
      const lang = line.replace(/^\s*```/, "").trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(<CodeBlock key={key} lang={lang} code={code.join("\n")} />);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    if (isHeading(line)) {
      blocks.push(
        <h3 key={key} className="mdh">
          {inline(line.replace(/^#{1,4}\s+/, ""), key)}
        </h3>
      );
      i++;
      continue;
    }

    if (isBullet(line) || isNumbered(line)) {
      const ordered = isNumbered(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered ? isNumbered(lines[i]) : isBullet(lines[i]))
      ) {
        items.push(
          lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, "")
        );
        i++;
      }
      const children = items.map((item, n) => (
        <li key={`${key}-${n}`}>{inline(item, `${key}-${n}`)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol key={key}>{children}</ol>
        ) : (
          <ul key={key}>{children}</ul>
        )
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isFence(lines[i]) &&
      !isHeading(lines[i]) &&
      !isBullet(lines[i]) &&
      !isNumbered(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key}>
        {para.map((p, n) => (
          <span key={`${key}-${n}`}>
            {n > 0 && <br />}
            {inline(p, `${key}-${n}`)}
          </span>
        ))}
      </p>
    );
  }

  return <div className="md">{blocks}</div>;
}
