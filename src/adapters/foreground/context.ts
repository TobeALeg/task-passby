import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  "DOVE.tauri": { adapter: "codex", environmentName: "Codex Desktop" },
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
 * DOVE 等桌面容器可能不暴露窗口标题。只有最近任务在短时间内有唯一活动信号时才使用它，
 * 避免把同时活跃的多个任务误认为当前聊天。
 */
export function resolveCodexThreadFromRecentActivity(
  threads: CodexThreadSummary[],
  now = new Date(),
  maxAgeMs = 5 * 60_000,
  minimumLeadMs = 5_000
): CodexThreadSummary | null {
  const newest = threads[0];
  if (!newest) return null;
  const newestTime = Date.parse(newest.updatedAt);
  if (!Number.isFinite(newestTime) || now.getTime() - newestTime > maxAgeMs) return null;
  const runnerUp = threads[1];
  if (runnerUp) {
    const runnerUpTime = Date.parse(runnerUp.updatedAt);
    if (Number.isFinite(runnerUpTime) && newestTime - runnerUpTime < minimumLeadMs) return null;
  }
  return newest;
}

/**
 * 读取前台应用元数据；窗口标题仅用于在 Adapter 内解析会话身份，不会被归档。
 * 读取窗口标题需要 macOS 的辅助功能权限，未授权时仍返回应用身份。
 */
export class MacForegroundApplicationDetector implements ForegroundApplicationDetector {
  readonly #helperPath: string;

  constructor(helperPath = fileURLToPath(new URL("../../foreground-context", import.meta.url))) {
    this.#helperPath = helperPath;
  }

  async detect(): Promise<ForegroundApplication | null> {
    try {
      const { stdout } = await execFileAsync(this.#helperPath, [], { timeout: 3_000 });
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
