import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyForegroundApplication,
  resolveCodexThreadFromWindowTitle
} from "../../src/adapters/foreground/context.ts";

test("前台上下文只把受支持的应用归类为 Adapter，不把窗口内容当作记录数据", () => {
  assert.deepEqual(
    classifyForegroundApplication({ bundleId: "com.openai.codex", name: "ChatGPT", windowTitle: "准备客户提案 — Codex" }),
    { adapter: "codex", environmentName: "Codex Desktop", applicationName: "ChatGPT", windowTitle: "准备客户提案 — Codex" }
  );
  assert.deepEqual(
    classifyForegroundApplication({ bundleId: "com.tencent.workbuddy.mac", name: "WorkBuddy", windowTitle: "客户提案" }),
    { adapter: "workbuddy", environmentName: "WorkBuddy Desktop", applicationName: "WorkBuddy", windowTitle: "客户提案" }
  );
  assert.equal(classifyForegroundApplication({ bundleId: "com.apple.TextEdit", name: "TextEdit", windowTitle: "notes" }), null);
});

test("Codex 只在窗口标题与唯一任务标题相符时识别当前聊天，不以最近任务猜测", () => {
  const threads = [
    { id: "old-thread", title: "准备客户提案", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T01:00:00.000Z", status: "completed" },
    { id: "current-thread", title: "准备客户提案 V2", preview: "", cwd: "/tmp", updatedAt: "2026-09-03T02:00:00.000Z", status: "working" }
  ];
  assert.equal(resolveCodexThreadFromWindowTitle("准备客户提案 V2 — Codex", threads)?.id, "current-thread");
  assert.equal(resolveCodexThreadFromWindowTitle("新的未命名对话 — Codex", threads), null);
});
