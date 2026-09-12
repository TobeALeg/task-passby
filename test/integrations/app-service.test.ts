import { makeService } from "../helpers/app-options.ts";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { NormalizedThread } from "../../dist/adapters/types.js";
import { AppService } from "../../dist/app/app-service.js";
import type { ConversationSource } from "../../dist/executors/types.js";

class FakeCodexSource implements ConversationSource {
  readonly thread: NormalizedThread;
  constructor(thread: NormalizedThread) { this.thread = thread; }
  async listRecentThreads() { return []; }
  async readThread() { return { ...this.thread, applicationTitle: this.thread.applicationTitle ?? this.thread.title }; }
  close() {}
}

test("刷新工作时复核已有 ArtifactRef 并记录 changed 事件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workpet-artifact-refresh-"));
  const artifactPath = join(directory, "input.txt");
  await writeFile(artifactPath, "v1");
  const thread: NormalizedThread = {
    threadId: "artifact-thread",
    title: "处理资料",
    cwd: directory,
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    events: [
      {
        id: "prompt-1",
        externalId: "prompt-1",
        sequence: 1,
        kind: "user.prompt",
        content: "处理这份资料",
        timestamp: "2026-09-02T10:00:00.000Z",
        executorType: "HUMAN",
        environmentType: "CODEX_DESKTOP"
      },
      {
        id: "artifact-1",
        externalId: "artifact-1",
        sequence: 2,
        kind: "artifact.added",
        content: artifactPath,
        timestamp: "2026-09-02T10:00:01.000Z",
        executorType: "HUMAN",
        environmentType: "CODEX_DESKTOP",
        metadata: { path: artifactPath, role: "INPUT" }
      }
    ]
  };
  const service = makeService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    launcher: { async openNewConversation() { return "opened"; } }
  });
  const created = await service.createWorkFromConversation({executorId: "codex",  threadId: thread.threadId, allowCloudExtraction: false });
  const workId = created.selectedWorkId;
  assert.ok(workId);
  assert.equal(created.selectedWork?.state.objective[0]?.text, "处理资料");
  assert.equal(created.selectedWork?.state.objective[0]?.origin, "SYSTEM_INFERRED");
  assert.match(created.selectedWork?.state.objective[0]?.sourceMessageIds[0] ?? "", /^codex-conversation-title:artifact-thread:/u);
  const artifact = created.selectedWork!.state.artifacts[0]!;
  assert.equal(artifact.file?.name, "input.txt");
  assert.equal(artifact.file?.path, artifactPath);
  assert.equal(service.artifactPath(workId, artifact.id), artifactPath);
  assert.throws(() => service.artifactPath(workId, "unknown"), /找不到这份资料/);
  assert.throws(() => service.artifactPath(workId, created.selectedWork!.state.objective[0]!.id), /找不到这份资料/);
  await writeFile(artifactPath, "v2 changed");

  await service.refreshWork(workId);

  const work = service.core().getWork(workId);
  assert.equal(work?.artifactRefs.length, 2);
  assert.equal(work?.artifactRefs.at(-1)?.availability, "CHANGED");
  assert.equal(work?.sourceArchive.at(-1)?.kind, "artifact.changed");
  await service.refreshWork(workId);
  assert.equal(service.core().getWork(workId)?.artifactRefs.length, 2);
  assert.equal(service.core().getWork(workId)?.artifactRefs.at(-1)?.availability, "CHANGED");
  service.completeWork(workId);
  await writeFile(artifactPath, "v3 after completed");
  for (let poll = 0; poll < 3; poll++) {
    const dashboard = await service.dashboardWithContext(workId);
    assert.equal(dashboard.selectedWork?.state.artifacts[0]?.file?.name, "input.txt");
    assert.equal(service.core().getWork(workId)?.artifactRefs.length, 2);
  }
  await service.refreshWork(workId);
  assert.equal(service.core().getWork(workId)?.artifactRefs.length, 3);
  assert.equal(service.core().getWork(workId)?.sourceArchive.at(-1)?.environmentType, "WORKPET_LOCAL");
  service.close();
});

test("WorkBuddy 启动失败时恢复原 Codex CaptureBinding", async () => {
  const thread: NormalizedThread = {
    threadId: "handoff-failure-thread",
    title: "不能丢失来源捕获",
    cwd: "/tmp",
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    events: [{
      id: "prompt-1",
      externalId: "prompt-1",
      sequence: 1,
      kind: "user.prompt",
      content: "继续记录 Codex",
      timestamp: "2026-09-02T10:00:00.000Z",
      executorType: "HUMAN",
      environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = makeService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    launcher: { async openNewConversation() { throw new Error("WorkBuddy 未启动"); } }
  });
  const created = await service.createWorkFromConversation({executorId: "codex",  threadId: thread.threadId, allowCloudExtraction: false });
  const workId = created.selectedWorkId;
  assert.ok(workId);

  await assert.rejects(service.handoff(workId, "workbuddy"),/WorkBuddy 未启动/);
  const dashboard = service.dashboard(workId);

  assert.equal(dashboard.petState, "awake");
  assert.match(dashboard.notice ?? "", /已恢复原来源记录/u);
  assert.equal(dashboard.selectedWork?.bindings.at(-1)?.adapter, "codex");
  assert.equal(dashboard.selectedWork?.bindings.at(-1)?.status, "ACTIVE");
  service.close();
});

test("用户可从指定 Codex 消息创建新的 WorkInstance", async () => {
  const thread: NormalizedThread = {
    threadId: "split-thread",
    title: "同一对话里的两项工作",
    cwd: "/tmp",
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T11:00:00.000Z",
    events: [
      {
        id: "prompt-a", externalId: "prompt-a", sequence: 1, kind: "user.prompt",
        content: "先完成工作 A", timestamp: "2026-09-02T10:00:00.000Z",
        executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
      },
      {
        id: "reply-a", externalId: "reply-a", sequence: 2, kind: "agent.response",
        content: "工作 A 已完成", timestamp: "2026-09-02T10:01:00.000Z",
        executorType: "AGENT", environmentType: "CODEX_DESKTOP"
      },
      {
        id: "prompt-b", externalId: "prompt-b", sequence: 3, kind: "user.prompt",
        content: "现在开始工作 B", timestamp: "2026-09-02T11:00:00.000Z",
        executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
      },
      {
        id: "reply-b", externalId: "reply-b", sequence: 4, kind: "agent.response",
        content: "正在处理工作 B", timestamp: "2026-09-02T11:01:00.000Z",
        executorType: "AGENT", environmentType: "CODEX_DESKTOP"
      }
    ]
  };
  const service = makeService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    launcher: { async openNewConversation() { return "opened"; } }
  });
  const original = await service.createWorkFromConversation({executorId: "codex",  threadId: thread.threadId, allowCloudExtraction: false });
  const originalId = original.selectedWorkId;
  assert.ok(originalId);
  const points = await service.listSplitPoints(originalId);
  assert.deepEqual(points.map((point) => point.externalId), ["prompt-b", "prompt-a"]);

  const split = await service.createWorkFromMessage({ sourceWorkId: originalId, startExternalId: "prompt-b" });

  const newId = split.selectedWorkId;
  assert.ok(newId);
  assert.notEqual(newId, originalId);
  assert.deepEqual(service.core().getWork(newId)?.sourceArchive.map((event) => event.externalId), ["prompt-b", "reply-b"]);
  assert.equal(service.core().getWork(originalId)?.activeBinding, null);
  assert.equal(service.core().findWorkByBinding("codex", thread.threadId)?.instance.id, newId);
  await service.refreshWork(newId);
  assert.deepEqual(service.core().getWork(newId)?.sourceArchive.map((event) => event.externalId), ["prompt-b", "reply-b"]);
  service.close();
});

test("无来源 CaptureBinding 的工作交接失败时结束 pending Episode", async () => {
  const thread: NormalizedThread = {
    threadId: "no-source-handoff-thread",
    title: "无来源交接失败",
    cwd: "/tmp",
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    events: [{
      id: "prompt-1", externalId: "prompt-1", sequence: 1, kind: "user.prompt",
      content: "交给 WorkBuddy", timestamp: "2026-09-02T10:00:00.000Z",
      executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = makeService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    launcher: { async openNewConversation() { throw new Error("WorkBuddy 未启动"); } }
  });
  const created = await service.createWorkFromConversation({executorId: "codex",  threadId: thread.threadId, allowCloudExtraction: false });
  const workId = created.selectedWorkId;
  assert.ok(workId);
  service.core().stopCapture(workId);

  await assert.rejects(service.handoff(workId, "workbuddy"),/WorkBuddy 未启动/);
  const result = service.dashboard(workId);

  assert.match(result.notice ?? "", /未保留活动的待确认绑定/u);
  assert.equal(service.core().getWork(workId)?.activeBinding, null);
  assert.equal(service.core().getWork(workId)?.activeEpisode, null);
  assert.ok(service.core().getWork(workId)?.episodes.every((episode) => episode.status === "ENDED"));
  service.close();
});

test("WorkBuddy Deep Link 启动后不把未知提交状态误报为待发送草稿", async () => {
  const thread: NormalizedThread = {
    threadId: "handoff-opened-thread",
    title: "接力状态提示",
    cwd: "/tmp",
    createdAt: "2026-09-03T10:00:00.000Z",
    updatedAt: "2026-09-03T10:00:00.000Z",
    events: [{
      id: "prompt-1", externalId: "prompt-1", sequence: 1, kind: "user.prompt",
      content: "交给 WorkBuddy", timestamp: "2026-09-03T10:00:00.000Z",
      executorType: "HUMAN", environmentType: "CODEX_DESKTOP"
    }]
  };
  const service = makeService({
    databasePath: ":memory:",
    codex: new FakeCodexSource(thread),
    launcher: { async openNewConversation() { return "opened"; } }
  });
  const created = await service.createWorkFromConversation({executorId: "codex",  threadId: thread.threadId, allowCloudExtraction: false });
  const workId = created.selectedWorkId;
  assert.ok(workId);

  const result = await service.handoff(workId, "workbuddy");

  assert.match(result.notice ?? "", /已打开 WorkBuddy/u);
  assert.doesNotMatch(result.notice ?? "", /草稿|按回车/u);
  assert.equal(result.selectedWork?.captureStatus, "waiting");
  assert.equal(result.selectedWork?.agentName, "Codex");
  assert.equal(result.selectedWork?.episodeCount, 1);
  assert.deepEqual(
    result.selectedWork?.episodes.map((episode) => episode.executor),
    ["Codex"],
  );

  const pending = service.core().getWork(workId)?.activeBinding?.conversationId;
  assert.match(pending ?? "", /^pending:/u);
  service.core().bindConversation(
    workId,
    "workbuddy",
    pending!,
    "confirmed-workbuddy-session",
  );
  const confirmed = service.dashboard(workId);
  assert.equal(confirmed.selectedWork?.agentName, "WorkBuddy");
  assert.equal(confirmed.selectedWork?.episodeCount, 2);
  assert.deepEqual(
    confirmed.selectedWork?.episodes.map((episode) => episode.executor),
    ["Codex", "WorkBuddy"],
  );
  service.close();
});


test("取消记录撤销绑定，迟到的同步不会重建记录，来源仍可重新导入", async () => {
  const thread: NormalizedThread = {
    threadId: "cancel-recording-thread", title: "保留原对话", cwd: "/tmp",
    createdAt: "2026-09-09T10:00:00.000Z", updatedAt: "2026-09-09T10:00:00.000Z",
    events: [{ id: "prompt", externalId: "prompt", sequence: 1, kind: "user.prompt",
      content: "用户原始消息", timestamp: "2026-09-09T10:00:00.000Z",
      executorType: "HUMAN", environmentType: "CODEX_DESKTOP" }],
  };
  const original = structuredClone(thread);
  const source = new FakeCodexSource(thread);
  const service = makeService({ databasePath: ":memory:", codex: source,
    launcher: { async openNewConversation() { throw new Error("不应交付消息"); } } });
  try {
    const created = await service.createWorkFromConversation({ executorId: "codex", threadId: thread.threadId, allowCloudExtraction: false });
    const id = created.selectedWorkId!;
    assert.throws(() => service.cancelRecording(id, "永久删除"), /取消记录/);
    assert.ok(service.core().getWork(id)?.activeBinding);
    service.core().createHandoffPackage(id);
    const read = source.readThread.bind(source);
    let release!: () => void;
    source.readThread = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return read();
    };
    const syncing = service.syncRecordedWorks();
    const cancelled = service.cancelRecording(id, "取消记录");
    assert.equal(cancelled.works.length, 0);
    assert.match(cancelled.notice ?? "", /后续不再同步/);
    release();
    await syncing;
    source.readThread = async () => { throw new Error("取消后不应读取来源"); };
    await service.syncRecordedWorks();
    assert.equal(service.core().findWorkByBinding("codex", thread.threadId), null);
    assert.equal(service.core().getWork(id), null);
    assert.deepEqual(thread, original);
    source.readThread = read;
    const recorded = await service.createWorkFromConversation({ executorId: "codex", threadId: thread.threadId, allowCloudExtraction: false });
    assert.ok(recorded.selectedWorkId);
    assert.notEqual(recorded.selectedWorkId, id);
  } finally { service.close(); }
});
