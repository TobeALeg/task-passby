import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SupportedAdapter = string;

export interface ForegroundApplication {
  bundleId: string;
  name: string;
  windowTitle: string | null;
}

export interface CurrentApplicationContext {
  adapter: SupportedAdapter;
  environmentName: string;
  applicationName: string;
  windowTitle: string | null;
  conversationId?: string;
  applicationTitle?: string;
}

export interface ForegroundApplicationDetector {
  detect(): Promise<ForegroundApplication | null>;
}

/**
 * 读取前台应用元数据；窗口标题仅用于在 Adapter 内解析会话身份，不会被归档。
 * 系统不提供窗口标题时仍返回应用身份，由 UI 提供明确的会话选择。
 */
export class MacForegroundApplicationDetector implements ForegroundApplicationDetector {
  readonly #helperPath: string;

  constructor(
    helperPath = fileURLToPath(
      new URL("../../foreground-context", import.meta.url),
    ),
    readonly bundleIds: readonly string[] = [],
  ) {
    this.#helperPath = helperPath;
  }

  async detect(): Promise<ForegroundApplication | null> {
    try {
      const { stdout } = await execFileAsync(
        this.#helperPath,
        [...this.bundleIds],
        { timeout: 3_000 },
      );
      const value: unknown = JSON.parse(stdout.trim());
      if (!value || typeof value !== "object") return null;
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.bundleId !== "string" ||
        typeof candidate.name !== "string"
      )
        return null;
      return {
        bundleId: candidate.bundleId,
        name: candidate.name,
        windowTitle:
          typeof candidate.windowTitle === "string"
            ? candidate.windowTitle
            : null,
      };
    } catch {
      return null;
    }
  }
}
