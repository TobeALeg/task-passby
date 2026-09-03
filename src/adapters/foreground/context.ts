import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CodexThreadSummary } from "../codex/app-server-client.js";

const execFileAsync = promisify(execFile);

export type SupportedAdapter = "codex" | "workbuddy";

export interface ForegroundApplication {
  bundleId: string;
  name: string;
  windowTitle: string | null;
}

export interface CurrentApplicationContext {
  adapter: SupportedAdapter;
  environmentName: "Codex Desktop" | "WorkBuddy Desktop";
  applicationName: string;
  windowTitle: string | null;
  conversationId?: string;
}

export interface ForegroundApplicationDetector {
  detect(): Promise<ForegroundApplication | null>;
}

const APPLICATIONS: Record<string, Omit<CurrentApplicationContext, "applicationName" | "windowTitle">> = {
  "com.openai.codex": { adapter: "codex", environmentName: "Codex Desktop" },
  "com.tencent.workbuddy.mac": { adapter: "workbuddy", environmentName: "WorkBuddy Desktop" }
};

export function classifyForegroundApplication(application: ForegroundApplication): CurrentApplicationContext | null {
  const supported = APPLICATIONS[application.bundleId];
  return supported ? { ...supported, applicationName: application.name, windowTitle: application.windowTitle } : null;
}

function normalizeTitle(title: string): string {
  return title
    .replace(/\s+[—–-]\s+(?:Codex|ChatGPT|WorkBuddy)$/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

/**
 * 只接受唯一的精确标题匹配。最近更新不代表当前聊天，不能作为回退策略。
 */
export function resolveCodexThreadFromWindowTitle(
  windowTitle: string | null,
  threads: CodexThreadSummary[]
): CodexThreadSummary | null {
  if (!windowTitle?.trim()) return null;
  const normalized = normalizeTitle(windowTitle);
  const matches = threads.filter((thread) => normalizeTitle(thread.title) === normalized);
  return matches.length === 1 ? matches[0] ?? null : null;
}

/**
 * 读取前台应用元数据；窗口标题仅用于在 Adapter 内解析会话身份，不会被归档。
 * 读取窗口标题需要 macOS 的辅助功能权限，未授权时仍返回应用身份。
 */
export class MacForegroundApplicationDetector implements ForegroundApplicationDetector {
  async detect(): Promise<ForegroundApplication | null> {
    const script = `
ObjC.import('AppKit');
const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
const bundleId = ObjC.unwrap(front.bundleIdentifier);
const name = ObjC.unwrap(front.localizedName);
let windowTitle = null;
try {
  const systemEvents = Application('System Events');
  const process = systemEvents.applicationProcesses.whose({ frontmost: true })[0];
  windowTitle = process.windows[0].name();
} catch (_) {}
console.log(JSON.stringify({ bundleId, name, windowTitle }));`;
    try {
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 3_000 });
      const value: unknown = JSON.parse(stdout.trim());
      if (!value || typeof value !== "object") return null;
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.bundleId !== "string" || typeof candidate.name !== "string") return null;
      return {
        bundleId: candidate.bundleId,
        name: candidate.name,
        windowTitle: typeof candidate.windowTitle === "string" ? candidate.windowTitle : null
      };
    } catch {
      return null;
    }
  }
}
