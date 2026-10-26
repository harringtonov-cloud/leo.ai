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

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
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

/* ---------- inline ---------- */

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(~~[^~\n]+?~~)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*?\*)|(\b_[^_\s][^_\n]*?_\b)|(https?:\/\/[^\s<>)\]]+)/g;

function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${index++}`;

    if (match[1]) {
      parts.push(<code key={key} className="icode">{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      parts.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    } else if (match[3]) {
      parts.push(<del key={key}>{inline(token.slice(2, -2), key)}</del>);
    } else if (match[4]) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeHref(link[2]) : null;
      parts.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{inline(link![1], key)}</a>
        ) : (
          token
        )
      );
    } else if (match[5] || match[6]) {
      parts.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    } else {
      const href = safeHref(token.replace(/[.,;:!?]+$/, ""));
      const trailing = token.slice((href ?? token).length);
      parts.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{href}</a>
        ) : (
          token
        )
      );
      if (trailing) parts.push(trailing);
    }
    last = match.index + token.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/* ---------- code ---------- */

export type RunOutput = { text: string; images: string[] };

function CodeBlock({ lang, code, onRunCode }: { lang: string; code: string; onRunCode?: (code: string) => Promise<RunOutput> }) {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<RunOutput | null>(null);
  const runnable = Boolean(onRunCode) && /^(python|py|python3)$/i.test(lang) && code.length <= 8000;

  async function run() {
    if (!onRunCode) return;
    setRunning(true);
    setOutput(null);
    try {
      setOutput(await onRunCode(code));
    } catch (error) {
      setOutput({ text: `Error: ${error instanceof Error ? error.message : "Run failed"}`, images: [] });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="codeblock">
      <div className="codehead">
        <span>{lang || "code"}</span>
        <span>
          {runnable && (
            <button type="button" className="ghost" disabled={running} onClick={() => void run()}>
              {running ? "Running…" : "▶ Run in sandbox"}
            </button>
          )}
          <CopyButton text={code} />
        </span>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      {output?.text && <pre className="codeout">{output.text}</pre>}
      {output?.images.map((png, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} className="codeimg" alt={`Output ${i + 1}`} src={`data:image/png;base64,${png}`} />
      ))}
    </div>
  );
}

/* ---------- blocks ---------- */

const isFence = (l: string) => /^\s*```/.test(l);
const isHeading = (l: string) => /^#{1,6}\s+/.test(l);
const isRule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isQuote = (l: string) => /^\s*>/.test(l);
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isListItem = (l: string) => LIST_ITEM.test(l) && !isRule(l);
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const isTableStart = (lines: string[], i: number) => lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]) && lines[i + 1].includes("|");

type ListNode = { indent: number; ordered: boolean; text: string; children: ListNode[] };

function buildTree(items: ListNode[]): ListNode[] {
  const root: ListNode[] = [];
  const stack: ListNode[] = [];
  for (const item of items) {
    while (stack.length && stack[stack.length - 1].indent >= item.indent) stack.pop();
    if (stack.length === 0) root.push(item);
    else stack[stack.length - 1].children.push(item);
    stack.push(item);
  }
  return root;
}

function renderList(nodes: ListNode[], key: string): ReactNode {
  const ordered = nodes[0].ordered;
  const items = nodes.map((node, n) => {
    const task = node.text.match(/^\[( |x|X)\]\s+(.*)$/);
    return (
      <li key={`${key}-${n}`} className={task ? "task" : undefined}>
        {task && <input type="checkbox" checked={task[1] !== " "} readOnly disabled />}
        {inline(task ? task[2] : node.text, `${key}-${n}`)}
        {node.children.length > 0 && renderList(node.children, `${key}-${n}c`)}
      </li>
    );
  });
  return ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Dependency-free Markdown renderer: headings, lists (nested, tasks), tables, quotes, rules, links, code. */
export function Markdown({ text, onRunCode }: { text: string; onRunCode?: (code: string) => Promise<RunOutput> }) {
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
      while (i < lines.length && !isFence(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      blocks.push(<CodeBlock key={key} lang={lang} code={code.join("\n")} onRunCode={onRunCode} />);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    if (isRule(line)) {
      blocks.push(<hr key={key} className="mdhr" />);
      i++;
      continue;
    }

    if (isHeading(line)) {
      const level = Math.min(line.match(/^#+/)![0].length, 4);
      const content = inline(line.replace(/^#{1,6}\s+/, ""), key);
      blocks.push(level === 1 ? <h2 key={key} className="mdh mdh1">{content}</h2> : level === 2 ? <h3 key={key} className="mdh">{content}</h3> : <h4 key={key} className="mdh mdh3">{content}</h4>);
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={key} className="mdtable">
          <table>
            <thead>
              <tr>{head.map((c, n) => <th key={n} style={{ textAlign: aligns[n] as "left" | "center" | "right" }}>{inline(c, `${key}h${n}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>{head.map((_, n) => <td key={n} style={{ textAlign: aligns[n] as "left" | "center" | "right" }}>{inline(row[n] ?? "", `${key}r${r}c${n}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (isQuote(line)) {
      const quote: string[] = [];
      while (i < lines.length && isQuote(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key} className="mdquote">{quote.map((q, n) => <div key={n}>{inline(q, `${key}q${n}`)}</div>)}</blockquote>);
      continue;
    }

    if (isListItem(line)) {
      const items: ListNode[] = [];
      while (i < lines.length && isListItem(lines[i])) {
        const m = lines[i].match(LIST_ITEM)!;
        items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), text: m[3], children: [] });
        i++;
      }
      blocks.push(renderList(buildTree(items), key));
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHeading(lines[i]) &&
      !isListItem(lines[i]) && !isQuote(lines[i]) && !isRule(lines[i]) && !isTableStart(lines, i)
    ) {
      para.push(lines[i++]);
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
