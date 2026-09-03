import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedThread } from "../../dist/adapters/types.js";
import { AppService, type CodexSource } from "../../dist/app/app-service.js";

class FakeCodexSource implements CodexSource {
  readonly thread: NormalizedThread;
  constructor(thread: NormalizedThread) { this.thread = thread; }
  async listRecentThreads() {
    return [{ id: this.thread.threadId, title: this.thread.title, preview: "", cwd: this.thread.cwd, updatedAt: this.thread.updatedAt, status: "working" }];
  }
  async readThread() { return this.thread; }
  close() {}
}

test("从已识别的当前 Codex 对话创建工作时默认启用提炼，不需要应用选择器", async () => {
  const thread: NormalizedThread = {
    threadId: "current-codex-thread", title: "当前客户提案", cwd: "/tmp",
    createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T02:00:00.000Z",
    events: [{
      id: "prompt", externalId: "prompt", sequence: 1, kind: "user.prompt", content: "整理客户提案",
      timestamp: "2026-09-03T01:00:00.000Z", executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = new AppService({ databasePath: ":memory:", codex: new FakeCodexSource(thread), launcher: { async openNewConversation() { return "opened"; } } });

  const result = await service.createWorkFromCurrentContext({
    adapter: "codex", environmentName: "Codex Desktop", applicationName: "ChatGPT", windowTitle: "当前客户提案 — Codex", conversationId: thread.threadId
  });

  assert.equal(result.selectedWork?.title, "整理客户提案");
  assert.match(result.notice ?? "", /当前 Codex 对话/u);
  service.close();
});

test("从 WorkBuddy 当前窗口发起记录时等待下一次真实提交来绑定会话，而不是猜测聊天", async () => {
  const emptyThread: NormalizedThread = { threadId: "unused", title: "unused", cwd: "/tmp", createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T01:00:00.000Z", events: [] };
  const service = new AppService({ databasePath: ":memory:", codex: new FakeCodexSource(emptyThread), launcher: { async openNewConversation() { return "opened"; } } });

  const result = await service.createWorkFromCurrentContext({
    adapter: "workbuddy", environmentName: "WorkBuddy Desktop", applicationName: "WorkBuddy", windowTitle: "当前工作"
  });

  assert.equal(result.selectedWork?.bindings[0]?.conversationId.startsWith("waiting:"), true);
  assert.match(result.notice ?? "", /提交下一条消息/u);
  service.close();
});

test("WorkBuddy 取得真实 session 后默认生成 Work State", async () => {
  const emptyThread: NormalizedThread = { threadId: "unused", title: "unused", cwd: "/tmp", createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T01:00:00.000Z", events: [] };
  const service = new AppService({ databasePath: ":memory:", codex: new FakeCodexSource(emptyThread), launcher: { async openNewConversation() { return "opened"; } } });
  const pending = await service.createWorkFromCurrentContext({
    adapter: "workbuddy", environmentName: "WorkBuddy Desktop", applicationName: "WorkBuddy", windowTitle: "当前客户需求"
  });
  const workId = pending.selectedWorkId;
  assert.ok(workId);

  await service.syncWorkBuddyHook({
    hook_event_name: "UserPromptSubmit", session_id: "workbuddy-current-session", workpet_window_title: "当前客户需求", prompt: "整理这个客户需求的下一步"
  });

  assert.equal(service.core().getWork(workId)?.state.objective[0]?.text, "整理这个客户需求的下一步");
  service.close();
});
