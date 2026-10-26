import { Sandbox } from "@e2b/code-interpreter";

type Execution = {
  logs?: { stdout?: string[]; stderr?: string[] };
  results?: Array<{ text?: string; png?: string }>;
  error?: { name?: string; value?: string };
};

type Runner = {
  runCode: (code: string, options?: { timeoutMs?: number }) => Promise<Execution>;
  kill: () => Promise<unknown>;
};

export type SandboxResult = {
  stdout: string;
  stderr: string;
  results: string[];
  images: string[]; // base64 PNG
  error?: string;
};

export const MAX_CODE_LENGTH = 8000;

export async function runPython(code: string): Promise<SandboxResult> {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured.");
  if (!code.trim() || code.length > MAX_CODE_LENGTH) {
    throw new Error(`Code must be 1–${MAX_CODE_LENGTH} characters.`);
  }

  let sandbox: Runner | undefined;
  try {
    sandbox = (await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 30_000,
    })) as unknown as Runner;

    const run = await sandbox.runCode(code, { timeoutMs: 20_000 });
    const results = run.results ?? [];

    return {
      stdout: (run.logs?.stdout ?? []).join("\n").slice(0, 8000),
      stderr: (run.logs?.stderr ?? []).join("\n").slice(0, 4000),
      results: results.map((r) => r.text || "").filter(Boolean).slice(0, 10),
      images: results.map((r) => r.png || "").filter(Boolean).slice(0, 3),
      error: run.error ? `${run.error.name ?? "Error"}: ${run.error.value ?? ""}`.trim() : undefined,
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
