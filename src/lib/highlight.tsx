import type { ReactNode } from "react";

/** Tiny dependency-free syntax highlighter: comments, strings, numbers and keywords for common languages. */

const JS = "break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await interface type enum implements public private protected readonly as null undefined true false";
const PY = "and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False self";
const C = "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace new delete public private protected template this throw try catch using bool true false null nullptr fn let mut impl trait pub use mod match func package defer go chan map interface range var string";
const SH = "if then else elif fi for while do done case esac function in return export local echo cd ls cat grep sed awk npm npx git sudo";
const SQL = "select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit as and or not null primary key foreign references index distinct union count sum avg min max like in is case when then else end";

type Family = { keywords: Set<string>; comment: string; caseInsensitive?: boolean; tripleQuotes?: boolean; backtick?: boolean };

const FAMILIES: Record<string, Family> = {
  js: { keywords: new Set(JS.split(" ")), comment: "c", backtick: true },
  py: { keywords: new Set(PY.split(" ")), comment: "hash", tripleQuotes: true },
  c: { keywords: new Set(C.split(" ")), comment: "c", backtick: true },
  sh: { keywords: new Set(SH.split(" ")), comment: "hash" },
  sql: { keywords: new Set(SQL.split(" ")), comment: "dash", caseInsensitive: true },
  json: { keywords: new Set(["true", "false", "null"]), comment: "none" },
  yaml: { keywords: new Set(["true", "false", "null"]), comment: "hash" },
};

const ALIASES: Record<string, string> = {
  js: "js", javascript: "js", jsx: "js", ts: "js", typescript: "js", tsx: "js", mjs: "js",
  python: "py", py: "py", python3: "py",
  c: "c", cpp: "c", "c++": "c", cs: "c", csharp: "c", java: "c", kotlin: "c", go: "c", rust: "c", rs: "c", swift: "c", php: "c",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh",
  sql: "sql", json: "json", yaml: "yaml", yml: "yaml", toml: "yaml",
};

const MAX_LENGTH = 25_000;

export function highlight(code: string, lang: string): ReactNode {
  const family = FAMILIES[ALIASES[lang.toLowerCase()] ?? ""];
  if (!family || code.length > MAX_LENGTH) return code;

  const comment =
    family.comment === "c" ? String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`
    : family.comment === "hash" ? String.raw`#[^\n]*`
    : family.comment === "dash" ? String.raw`--[^\n]*`
    : String.raw`(?!)`;
  const triple = family.tripleQuotes ? String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|` : "";
  const tick = family.backtick ? String.raw`|` + "`(?:\\\\[\\s\\S]|[^`\\\\])*`" : "";
  const pattern = new RegExp(
    `(${comment})|(${triple}"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'${tick})|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b[A-Za-z_$][\\w$]*\\b)`,
    "g"
  );

  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const text = m[0];
    const key = n++;
    if (m[1]) out.push(<span key={key} className="tok-c">{text}</span>);
    else if (m[2]) out.push(<span key={key} className="tok-s">{text}</span>);
    else if (m[3]) out.push(<span key={key} className="tok-n">{text}</span>);
    else if (family.keywords.has(family.caseInsensitive ? text.toLowerCase() : text)) out.push(<span key={key} className="tok-k">{text}</span>);
    else out.push(text);
    last = m.index + text.length;
    if (text.length === 0) pattern.lastIndex++; // safety against zero-width matches
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
