import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { Sandbox } from "@e2b/code-interpreter";

export const runtime = "nodejs";
export const maxDuration = 60;

type CodeExecution = {
  logs?: {
    stdout?: string[];
    stderr?: string[];
  };
  results?: Array<{ text?: string }>;
};

type CodeRunner = {
  runCode: (
    code: string,
    options?: { timeoutMs?: number }
  ) => Promise<CodeExecution>;
  kill: () => Promise<unknown>;
};

export async function POST(request: Request) {
  let sandbox: CodeRunner | undefined;

  try {
    const user = await requireUser(request);
    const body = await request.json();
    const code = body.code;

    if (
      typeof code !== "string" ||
      !code.trim() ||
      code.length > 8000
    ) {
      return NextResponse.json(
        { error: "Code must be 1–8000 characters." },
        { status: 400 }
      );
    }

    if (!process.env.E2B_API_KEY) {
      return NextResponse.json(
        { error: "E2B_API_KEY is not configured." },
        { status: 503 }
      );
    }

    const created = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 30_000,
    });

    sandbox = created as unknown as CodeRunner;

    const result = await sandbox.runCode(code, {
      timeoutMs: 20_000,
    });

    return NextResponse.json({
      userId: user.uid,
      stdout: result.logs?.stdout?.join("\n") || "",
      stderr: result.logs?.stderr?.join("\n") || "",
      results: (result.results || [])
        .map((item) => item.text || "")
        .filter(Boolean)
        .slice(0, 10),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sandbox failed";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
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
