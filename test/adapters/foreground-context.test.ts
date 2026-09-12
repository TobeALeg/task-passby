import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveThreadFromRecentActivity,
  resolveThreadFromWindowTitle
} from "../../src/executors/conversation-resolution.ts";
import { createCodexExecutor } from "../../dist/adapters/codex/executor.js";


test("没有窗口标题时只在最新 Codex 任务足够新且不含歧义时自动识别", () => {
  const threads = [
    { id: "active", title: "当前任务", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T04:00:00.000Z", status: "notLoaded" },
    { id: "older", title: "旧任务", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T03:58:00.000Z", status: "notLoaded" }
  ];
  assert.equal(resolveThreadFromRecentActivity(threads, new Date("2026-09-03T04:01:00.000Z"))?.id, "active");
  assert.equal(resolveThreadFromRecentActivity(threads, new Date("2026-09-03T04:10:00.000Z")), null);
  assert.equal(resolveThreadFromRecentActivity([
    threads[0],
    { ...threads[1], updatedAt: "2026-09-03T03:59:58.000Z" }
  ], new Date("2026-09-03T04:01:00.000Z")), null);
});

test("Codex 只在窗口标题与唯一任务标题相符时识别当前聊天，不以最近任务猜测", () => {
  const threads = [
    { id: "old-thread", title: "准备客户提案", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T01:00:00.000Z", status: "completed" },
    { id: "current-thread", title: "准备客户提案 V2", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T02:00:00.000Z", status: "working" }
  ];
  assert.equal(resolveThreadFromWindowTitle("准备客户提案 V2", threads)?.id, "current-thread");
  assert.equal(resolveThreadFromWindowTitle("新的未命名对话", threads), null);
});

test("Windows Codex 的通用 ChatGPT 窗口标题按无标题容器处理", async () => {
  const now = Date.now();
  const source = {
    async listThreadPage() {
      return {
        threads: [
          { id: "active", title: "Windows 当前任务", preview: "", cwd: "C:\\work", updatedAt: new Date(now).toISOString(), status: "working" },
          { id: "older", title: "旧任务", preview: "", cwd: "C:\\work", updatedAt: new Date(now - 60_000).toISOString(), status: "completed" },
        ],
        nextCursor: null,
      };
    },
    async readThread() { throw new Error("not used"); },
    close() {},
  };
  const adapter = createCodexExecutor({ codex: source });
  assert.equal(
    (await adapter.resolveCurrent({ bundleId: "ChatGPT.exe", name: "ChatGPT", windowTitle: "ChatGPT" }))?.id,
    "active",
  );
});
