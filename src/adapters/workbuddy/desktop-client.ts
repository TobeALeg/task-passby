import { connect } from "node:net";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NormalizedThread } from "../types.js";
import type { ConversationPage } from "../../executors/types.js";

export class WorkBuddyDesktopClient {
  constructor(
    readonly socketPath = process.platform === "win32"
      ? `\\\\.\\pipe\\workpet-workbuddy-${createHash("sha256").update(homedir()).digest("hex").slice(0, 12)}`
      : join(homedir(), ".workpet", "workbuddy.sock"),
  ) {}
  async listThreadPage(
    _limit = 30,
    cursor?: string,
  ): Promise<ConversationPage> {
    return this.request({ method: "list", page: cursor ? Number(cursor) : 1 });
  }
  async readThread(id: string): Promise<NormalizedThread> {
    return this.request({ method: "read", id });
  }
  async inspect(): Promise<void> {
    const result = await this.request<{ protocol: number }>({
      method: "status",
    });
    if (result.protocol !== 1)
      throw new Error(
        "WorkBuddy 接入版本不兼容，请更新 Worket 后重启 WorkBuddy。",
      );
  }
  close(): void {}
  request<T>(input: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath);
      let body = "";
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(value as T);
      };
      socket.setTimeout(60_000, () =>
        finish(new Error("WorkBuddy 读取超时，请稍后重试。")),
      );
      socket.on("connect", () => socket.write(JSON.stringify(input) + "\n"));
      socket.on("data", (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024 * 1024)
          finish(new Error("WorkBuddy 会话过大，未导入不完整历史。"));
      });
      socket.on("error", (error) =>
        finish(
          new Error(
            `WorkBuddy 接入不可用，请启动或重启 WorkBuddy。${error.message}`,
          ),
        ),
      );
      socket.on("end", () => {
        try {
          const response = JSON.parse(body);
          if (response.error) finish(new Error(response.error));
          else finish(undefined, response.result);
        } catch {
          finish(new Error("WorkBuddy 接口返回格式不兼容。"));
        }
      });
    });
  }
}
