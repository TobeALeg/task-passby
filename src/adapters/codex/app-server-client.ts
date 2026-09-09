import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { normalizeCodexThread, type CodexThreadPayload } from "./normalize.js";
import type { NormalizedThread } from "../types.js";

interface JsonRpcSuccess<T> {
  id: number;
  result: T;
}

interface JsonRpcFailure {
  id: number;
  error: { code: number; message: string; data?: unknown };
}

interface ThreadListResponse {
  data: Array<CodexThreadPayload & { turns: [] }>;
  nextCursor?: string | null;
}

interface ThreadReadResponse {
  thread: CodexThreadPayload;
}

export interface CodexThreadSummary {
  id: string;
  title: string | null;
  preview: string;
  cwd: string;
  updatedAt: string;
  status: unknown;
}

export const CODEX_BINARY_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  `${process.env.HOME ?? ""}/Applications/ChatGPT.app/Contents/Resources/codex`,
  `${process.env.HOME ?? ""}/.codex/plugins/.plugin-appserver/codex`,
];

async function findCodexBinary(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (!candidate.startsWith("/")) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known official bundle location.
    }
  }
  throw new Error(
    "未找到 Codex App Server。请确认已安装最新版 Codex 桌面应用。",
  );
}

export class CodexAppServerClient {
  readonly #binaryCandidates: string[];
  #process: ChildProcessWithoutNullStreams | null = null;
  #nextRequestId = 1;
  #connecting: Promise<void> | null = null;
  #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(binaryCandidates: string[] = CODEX_BINARY_CANDIDATES) {
    this.#binaryCandidates = binaryCandidates;
  }

  async connect(): Promise<void> {
    if (this.#connecting) return this.#connecting;
    if (this.#process) return;
    this.#connecting = this.#connect()
      .catch((error) => {
        this.close();
        throw error;
      })
      .finally(() => {
        this.#connecting = null;
      });
    return this.#connecting;
  }
  async #connect(): Promise<void> {
    const binary = await findCodexBinary(this.#binaryCandidates);
    const child = spawn(binary, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.#process = child;

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#receiveLine(line));
    child.stderr.on("data", () => {
      // App Server diagnostics intentionally stay out of the JSON-RPC channel.
    });
    child.once("error", (error) => {
      for (const request of this.#pending.values()) request.reject(error);
      this.#pending.clear();
      if (this.#process === child) this.#process = null;
    });
    child.once("exit", (code, signal) => {
      const error = new Error(
        `Codex App Server 已退出（code=${String(code)}, signal=${String(signal)}）`,
      );
      for (const request of this.#pending.values()) request.reject(error);
      this.#pending.clear();
      if (this.#process === child) this.#process = null;
    });

    await this.#request("initialize", {
      clientInfo: { name: "workpet", title: "Worket", version: "0.1.0" },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [
          "item/agentMessage/delta",
          "item/reasoning/summaryTextDelta",
          "item/commandExecution/outputDelta",
        ],
      },
    });
    this.#notify("initialized", {});
  }

  async listRecentThreads(limit = 20): Promise<CodexThreadSummary[]> {
    return (await this.listThreadPage(limit)).threads;
  }

  async listThreadPage(
    limit = 30,
    cursor?: string,
  ): Promise<{ threads: CodexThreadSummary[]; nextCursor: string | null }> {
    await this.connect();
    const response = await this.#request<ThreadListResponse>("thread/list", {
      limit,
      ...(cursor ? { cursor } : {}),
      archived: false,
      sortKey: "updated_at",
      sortDirection: "desc",
    });
    return {
      threads: response.data.map((thread) => ({
        id: thread.id,
        title: thread.name?.trim() || null,
        preview: thread.preview ?? "",
        cwd: thread.cwd,
        updatedAt: new Date(thread.updatedAt * 1_000).toISOString(),
        status: thread.status,
      })),
      nextCursor: response.nextCursor ?? null,
    };
  }

  async readThread(threadId: string): Promise<NormalizedThread> {
    await this.connect();
    const response = await this.#request<ThreadReadResponse>("thread/read", {
      threadId,
      includeTurns: true,
    });
    return normalizeCodexThread(response.thread);
  }

  close(): void {
    for (const request of this.#pending.values())
      request.reject(new Error("Codex connection closed"));
    this.#pending.clear();
    this.#process?.kill("SIGTERM");
    this.#process = null;
  }

  #notify(method: string, params: unknown): void {
    this.#write({ method, params });
  }

  #request<T>(method: string, params: unknown): Promise<T> {
    const id = this.#nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex ${method} 超时，请重试。`));
      }, 30000);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.#write({ id, method, params });
      } catch (error) {
        this.#pending.get(id)?.reject(error as Error);
        this.#pending.delete(id);
      }
    });
  }

  #write(message: unknown): void {
    if (!this.#process) throw new Error("Codex App Server 尚未连接");
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #receiveLine(line: string): void {
    let message: JsonRpcSuccess<unknown> | JsonRpcFailure;
    try {
      message = JSON.parse(line) as JsonRpcSuccess<unknown> | JsonRpcFailure;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if ("error" in message) {
      pending.reject(
        new Error(`${message.error.message} (${message.error.code})`),
      );
    } else {
      pending.resolve(message.result);
    }
  }
}
