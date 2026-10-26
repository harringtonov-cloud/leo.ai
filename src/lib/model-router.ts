export type TaskKind = "chat" | "coding" | "reasoning" | "vision";

export function classifyTask(prompt: string): TaskKind {
  const p = prompt.toLowerCase();
  if (/(debug|fix|code|typescript|javascript|python|java|rust|compile|build|refactor|function|component|api route|ошибк|исправ|код|программ|файл|проект|тест)/i.test(p)) {
    return "coding";
  }
  if (/(compare|analyze deeply|architecture|trade.?off|сравни|архитектур|подробно проанализ)/i.test(p)) {
    return "reasoning";
  }
  return "chat";
}

export function modelFor(kind: TaskKind) {
  // Vision-capable model is required for images and PDFs. Set MODEL_VISION to a multimodal model id.
  if (kind === "vision") return process.env.MODEL_VISION || process.env.MODEL_GENERAL || "openai/gpt-4.1";
  if (kind === "coding") return process.env.MODEL_CODING || process.env.MODEL_GENERAL || "openai/gpt-4.1";
  if (kind === "reasoning") return process.env.MODEL_GENERAL || "anthropic/claude-sonnet-4";
  return process.env.MODEL_FAST || "openai/gpt-4.1-mini";
}
