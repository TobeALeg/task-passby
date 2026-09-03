import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyForegroundApplication,
  resolveCodexThreadFromRecentActivity,
  resolveCodexThreadFromWindowTitle
} from "../../src/adapters/foreground/context.ts";

test("前台上下文只把受支持的应用归类为 Adapter，不把窗口内容当作记录数据", () => {
  assert.deepEqual(
    classifyForegroundApplication({ bundleId: "com.openai.codex", name: "ChatGPT", windowTitle: "准备客户提案 — Codex" }),
    { adapter: "codex", environmentName: "Codex Desktop", applicationName: "ChatGPT", windowTitle: "准备客户提案 — Codex" }
  );
  assert.equal(
    classifyForegroundApplication({ bundleId: "DOVE.tauri", name: "DOVE", windowTitle: null })?.adapter,
    "codex"
  );
  assert.deepEqual(
    classifyForegroundApplication({ bundleId: "com.tencent.workbuddy.mac", name: "WorkBuddy", windowTitle: "客户提案" }),
    { adapter: "workbuddy", environmentName: "WorkBuddy Desktop", applicationName: "WorkBuddy", windowTitle: "客户提案" }
  );
  assert.equal(classifyForegroundApplication({ bundleId: "com.apple.TextEdit", name: "TextEdit", windowTitle: "notes" }), null);
});

test("没有窗口标题时只在最新 Codex 任务足够新且不含歧义时自动识别", () => {
  const threads = [
    { id: "active", title: "当前任务", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T04:00:00.000Z", status: "notLoaded" },
    { id: "older", title: "旧任务", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T03:58:00.000Z", status: "notLoaded" }
  ];
  assert.equal(resolveCodexThreadFromRecentActivity(threads, new Date("2026-09-03T04:01:00.000Z"))?.id, "active");
  assert.equal(resolveCodexThreadFromRecentActivity(threads, new Date("2026-09-03T04:10:00.000Z")), null);
  assert.equal(resolveCodexThreadFromRecentActivity([
    threads[0],
    { ...threads[1], updatedAt: "2026-09-03T03:59:58.000Z" }
  ], new Date("2026-09-03T04:01:00.000Z")), null);
});

test("Codex 只在窗口标题与唯一任务标题相符时识别当前聊天，不以最近任务猜测", () => {
  const threads = [
    { id: "old-thread", title: "准备客户提案", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T01:00:00.000Z", status: "completed" },
    { id: "current-thread", title: "准备客户提案 V2", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T02:00:00.000Z", status: "working" }
  ];
  assert.equal(resolveCodexThreadFromWindowTitle("准备客户提案 V2 — Codex", threads)?.id, "current-thread");
  assert.equal(resolveCodexThreadFromWindowTitle("新的未命名对话 — Codex", threads), null);
});
