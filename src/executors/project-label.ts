import { homedir } from "node:os";
import { basename, relative, resolve } from "node:path";

/** Display metadata only: preserve the source cwd for recording and handoff. */
export function conversationProjectLabel(executorId: string, cwd: string): string {
  if (!cwd.trim()) return "无项目";
  const path = resolve(cwd);
  const home = homedir();
  if (path === home) return "无项目";
  if (executorId === "codex") {
    const local = relative(resolve(home, "Documents/Codex"), path);
    if (/^\d{4}-\d{2}-\d{2}(?:\/[^/]+|-[^/]+)?$/.test(local)) return "无项目";
  }
  if (executorId === "workbuddy") {
    const local = relative(resolve(home, "WorkBuddy"), path);
    if (/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(local)) return "无项目";
  }
  return basename(path) || "无项目";
}
