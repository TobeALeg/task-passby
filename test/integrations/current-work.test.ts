import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { NormalizedThread } from "../../dist/adapters/types.js";
import { AppService, type CodexSource } from "../../dist/app/app-service.js";

class FakeCodexSource implements CodexSource {
  readonly thread: NormalizedThread;
  constructor(thread: NormalizedThread) { this.thread = thread; }
  async listRecentThreads() {
    return [{ id: this.thread.threadId, title: this.thread.title, preview: "", cwd: this.thread.cwd, updatedAt: this.thread.updatedAt, status: "working" }];
  }
  async readThread() { return { ...this.thread, applicationTitle: this.thread.applicationTitle ?? this.thread.title }; }
  close() {}
}

test("桌宠用一次服务调用检测并记录当前工作，不依赖预先缓存的上下文", async () => {
  const thread: NormalizedThread = {
    threadId: "current-codex-thread", title: "修复当前聊天识别失败", cwd: "/tmp",
    createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T02:00:00.000Z",
    events: [{
      id: "prompt", externalId: "prompt", sequence: 1, kind: "user.prompt",
      content: "Error occurred in handler for 'work:create-from-current-context': Error: 未识别到当前聊天",
      timestamp: "2026-09-03T01:00:00.000Z", executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    foreground: { async detect() { return { bundleId: "com.openai.codex", name: "ChatGPT", windowTitle: "修复当前聊天识别失败 — Codex" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });

  const result = await service.recordCurrentContext();

  assert.equal(result.selectedWork?.title, "修复当前聊天识别失败");
  assert.equal(result.selectedWork?.state.objective[0]?.text, "修复当前聊天识别失败");
  assert.equal(result.selectedWork?.state.objective[0]?.origin, "SYSTEM_INFERRED");
  assert.equal(result.selectedWork?.state.objective[0]?.sourceMessageIds.length, 1);
  assert.match(result.selectedWork?.state.objective[0]?.sourceMessageIds[0] ?? "", /^codex-conversation-title:current-codex-thread:/u);
  assert.match(result.notice ?? "", /当前 Codex 对话/u);
  service.close();
});

test("再次识别当前 Codex 聊天时用应用总结标题纠正旧记录的错误目标", async () => {
  const thread: NormalizedThread = {
    threadId: "legacy-codex-thread", title: "修复当前聊天识别失败", cwd: "/tmp",
    createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T02:00:00.000Z",
    events: [{
      id: "legacy-prompt", externalId: "legacy-prompt", sequence: 1, kind: "user.prompt",
      content: "Error occurred in handler for 'work:create-from-current-context'",
      timestamp: "2026-09-03T01:00:00.000Z", executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    foreground: { async detect() { return { bundleId: "com.openai.codex", name: "ChatGPT", windowTitle: "修复当前聊天识别失败 — Codex" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });
  let legacy = service.core().createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: thread.threadId }
  });
  legacy = service.core().appendSourceEvents(legacy.instance.id, [{
    externalId: "legacy-prompt", sequence: 1, kind: "user.prompt",
    content: "Error occurred in handler for 'work:create-from-current-context'",
    timestamp: "2026-09-03T01:00:00.000Z", executorType: "HUMAN", environmentType: "CODEX_DESKTOP",
    metadata: {}, artifactRefs: []
  }]).work;
  legacy = service.core().applyExtractorPatch(legacy.instance.id, { objective: [{
    id: "legacy-objective", text: "Error occurred in handler for 'work:create-from-current-context'",
    origin: "USER_STATED", sourceMessageIds: ["legacy-prompt"]
  }] });
  assert.equal(service.dashboard(legacy.instance.id).selectedWork?.title, "Error occurred in handler for 'work:create-from-current-context'");

  const corrected = await service.dashboardWithVerification(legacy.instance.id);
  assert.equal(corrected.selectedWork?.title, "修复当前聊天识别失败");
  assert.equal(corrected.selectedWork?.state.objective[0]?.origin, "SYSTEM_INFERRED");
  service.close();
});

test("桌宠预览使用应用生成的会话标题，并在同一会话记录后切换为打开", async () => {
  const thread: NormalizedThread = {
    threadId: "preview-codex-thread", title: "应用总结的任务标题", cwd: "/tmp",
    createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T02:00:00.000Z",
    events: [{
      id: "prompt", externalId: "prompt", sequence: 1, kind: "user.prompt", content: "这是用户首次发起会话的原始内容，不应该显示在气泡里",
      timestamp: "2026-09-03T01:00:00.000Z", executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    foreground: { async detect() { return { bundleId: "com.openai.codex", name: "ChatGPT", windowTitle: "应用总结的任务标题 — Codex" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });

  const before = await service.getPetView();
  assert.deepEqual(before.currentConversation, {
    adapter: "codex",
    applicationName: "Codex",
    title: "应用总结的任务标题",
    workId: null,
    workStatus: null,
    isRecording: false
  });

  const recorded = await service.recordCurrentContext();
  const after = await service.getPetView();
  assert.equal(after.currentConversation?.workId, recorded.selectedWorkId);
  assert.equal(after.currentConversation?.title, "应用总结的任务标题");
  const reopened = await service.recordCurrentContext();
  assert.equal(reopened.selectedWorkId, recorded.selectedWorkId);
  assert.equal(reopened.works.length, 1);
  service.close();
});

test("当前工作完成后保留打开入口，但不再把气泡标记为正在记录", async () => {
  const thread: NormalizedThread = {
    threadId: "completed-codex-thread", title: "完成状态气泡", cwd: "/tmp",
    createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T02:00:00.000Z",
    events: [{
      id: "prompt", externalId: "prompt", sequence: 1, kind: "user.prompt", content: "完成这个任务",
      timestamp: "2026-09-03T01:00:00.000Z", executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    foreground: { async detect() { return { bundleId: "com.openai.codex", name: "ChatGPT", windowTitle: "完成状态气泡 — Codex" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });
  const recorded = await service.recordCurrentContext();
  assert.ok(recorded.selectedWorkId);

  service.completeWork(recorded.selectedWorkId);
  const after = await service.getPetView();

  assert.equal(after.petState, "sleeping");
  assert.equal(after.currentConversation?.workId, recorded.selectedWorkId);
  assert.equal(after.currentConversation?.workStatus, "COMPLETED");
  assert.equal(after.currentConversation?.isRecording, false);
  const reopened = await service.dashboardWithVerification(recorded.selectedWorkId);
  assert.equal(reopened.selectedWork?.status, "COMPLETED");
  service.close();
});

test("桌宠预览在未聚焦受支持应用时不显示会话或记录入口", async () => {
  const emptyThread: NormalizedThread = { threadId: "unused", title: "unused", cwd: "/tmp", createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T01:00:00.000Z", events: [] };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(emptyThread),
    foreground: { async detect() { return { bundleId: "com.apple.finder", name: "Finder", windowTitle: "下载" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });

  assert.equal((await service.getPetView()).currentConversation, null);
  service.close();
});

test("Codex 窗口标题匹配失败时不以最近任务代替当前对话", async () => {
  const thread: NormalizedThread = {
    threadId: "recent-but-not-focused", title: "最近任务", cwd: "/tmp",
    createdAt: "2026-09-03T01:00:00.000Z", updatedAt: new Date().toISOString(), events: []
  };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    foreground: { async detect() { return { bundleId: "com.openai.codex", name: "Codex", windowTitle: "另一个任务 — Codex" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });

  assert.equal((await service.getPetView()).currentConversation, null);
  assert.equal((await service.recordCurrentContext()).selectedWork, null);
  service.close();
});

test("Codex 没有应用生成标题时不把首次消息 preview 显示成气泡标题", async () => {
  const thread: NormalizedThread = {
    threadId: "unnamed-thread", title: "内部读取回退标题", cwd: "/tmp",
    createdAt: "2026-09-03T01:00:00.000Z", updatedAt: new Date().toISOString(), events: []
  };
  const codex: CodexSource = {
    async listRecentThreads() {
      return [{ id: thread.threadId, title: null, preview: "首次用户消息", cwd: thread.cwd, updatedAt: thread.updatedAt, status: "working" }];
    },
    async readThread() { return thread; },
    close() {}
  };
  const service = new AppService({
    databasePath: ":memory:", codex,
    foreground: { async detect() { return { bundleId: "DOVE.tauri", name: "DOVE", windowTitle: null }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });

  assert.equal((await service.getPetView()).currentConversation, null);
  await assert.rejects(
    service.createWorkFromCodex({ threadId: thread.threadId, allowCloudExtraction: false }),
    /尚未生成应用任务标题/u
  );
  assert.equal(service.dashboard().works.length, 0);
  service.close();
});

test("桌宠无法识别受支持的前台应用时返回提示而不抛出 IPC 错误", async () => {
  const emptyThread: NormalizedThread = { threadId: "unused", title: "unused", cwd: "/tmp", createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T01:00:00.000Z", events: [] };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(emptyThread),
    foreground: { async detect() { return { bundleId: "dev.workpet.desktop", name: "WorkPet", windowTitle: "我的工作" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });

  const result = await service.recordCurrentContext();

  assert.equal(result.selectedWork, null);
  assert.match(result.notice ?? "", /未识别到受支持的前台应用/u);
  service.close();
});

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

  assert.equal(result.selectedWork?.title, "当前客户提案");
  assert.match(result.notice ?? "", /当前 Codex 对话/u);
  service.close();
});

test("从 WorkBuddy 当前窗口发起记录时等待下一次真实提交来绑定会话，而不是猜测聊天", async () => {
  const emptyThread: NormalizedThread = { threadId: "unused", title: "unused", cwd: "/tmp", createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T01:00:00.000Z", events: [] };
  const service = new AppService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(emptyThread),
    foreground: { async detect() { return { bundleId: "com.tencent.workbuddy.mac", name: "WorkBuddy", windowTitle: "当前工作" }; } },
    launcher: { async openNewConversation() { return "opened"; } }
  });

  assert.deepEqual((await service.getPetView()).currentConversation, {
    adapter: "workbuddy", applicationName: "WorkBuddy", title: "当前工作", workId: null,
    workStatus: null, isRecording: false
  });

  const result = await service.createWorkFromCurrentContext({
    adapter: "workbuddy", environmentName: "WorkBuddy Desktop", applicationName: "WorkBuddy", windowTitle: "当前工作"
  });

  assert.equal(result.selectedWork?.bindings[0]?.conversationId.startsWith("waiting:"), true);
  assert.match(result.notice ?? "", /提交下一条消息/u);
  assert.equal((await service.getPetView()).currentConversation?.workId, result.selectedWorkId);
  const reopened = await service.recordCurrentContext();
  assert.equal(reopened.works.length, 1);
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

test("WorkBuddy 真实会话绑定在重启后仍能由窗口定位并显示打开", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workpet-workbuddy-locator-"));
  const databasePath = join(directory, "workpet.sqlite");
  const emptyThread: NormalizedThread = { threadId: "unused", title: "unused", cwd: "/tmp", createdAt: "2026-09-03T01:00:00.000Z", updatedAt: "2026-09-03T01:00:00.000Z", events: [] };
  const foreground = { async detect() { return { bundleId: "com.tencent.workbuddy.mac", name: "WorkBuddy", windowTitle: "持久化定位测试" }; } };
  const options = { databasePath, codex: new FakeCodexSource(emptyThread), foreground, launcher: { async openNewConversation() { return "opened"; } } };
  const first = new AppService(options);
  const recorded = await first.recordCurrentContext();
  const workId = recorded.selectedWorkId;
  assert.ok(workId);
  await first.syncWorkBuddyHook({
    hook_event_name: "UserPromptSubmit", session_id: "persistent-session", workpet_window_title: "持久化定位测试", prompt: "继续这个工作"
  });
  first.close();

  const reopened = new AppService({ ...options, codex: new FakeCodexSource(emptyThread) });
  assert.equal((await reopened.getPetView()).currentConversation?.workId, workId);
  assert.equal((await reopened.recordCurrentContext()).works.length, 1);
  reopened.close();
});
