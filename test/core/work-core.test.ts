import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createWorkCore } from "../../dist/core/index.js";

test("创建工作时一次建立定义、实例、记录、执行片段和来源绑定", () => {
  const core = createWorkCore({ databasePath: ":memory:" });

  const work = core.createWork({
    definition: {
      key: "general-work",
      name: "通用工作",
      version: 1,
    },
    objective: "完成跨应用接力 MVP",
    objectiveSourceMessageIds: ["user-objective"],
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-20-turns" },
  });

  assert.equal(work.definition.key, "general-work");
  assert.equal(work.instance.status, "OPEN");
  assert.equal(work.record.workInstanceId, work.instance.id);
  assert.ok(work.activeEpisode);
  assert.equal(work.activeEpisode.status, "ACTIVE");
  assert.equal(work.activeEpisode.executor.type, "AGENT");
  assert.ok(work.activeBinding);
  assert.equal(work.activeBinding.status, "ACTIVE");
  assert.equal(work.activeBinding.conversationId, "thread-20-turns");
  assert.deepEqual(Object.keys(work.state), [
    "objective",
    "successCriteria",
    "constraints",
    "facts",
    "decisions",
    "completedActions",
    "pendingActions",
    "artifacts",
  ]);
  assert.deepEqual(work.state.objective, [
    {
      id: work.state.objective[0]?.id,
      text: "完成跨应用接力 MVP",
      origin: "USER_STATED",
      sourceMessageIds: ["user-objective"],
    },
  ]);

  core.close();
});

test("追加来源事件时按 externalId 去重并按 sequence 保持原始顺序", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-source-events" },
  });
  const events = [
    {
      externalId: "message-agent-1",
      sequence: 2,
      kind: "agent.response" as const,
      content: "我会先建立领域模型。",
      timestamp: "2026-09-02T09:00:02.000Z",
      executorType: "AGENT" as const,
      environmentType: "CODEX_DESKTOP",
      metadata: { model: "codex" },
      artifactRefs: [],
    },
    {
      externalId: "message-user-1",
      sequence: 1,
      kind: "user.prompt" as const,
      content: "实现 MVP。",
      timestamp: "2026-09-02T09:00:01.000Z",
      executorType: "HUMAN" as const,
      environmentType: "CODEX_DESKTOP",
      metadata: {},
      artifactRefs: [],
    },
  ];

  const first = core.appendSourceEvents(created.instance.id, events);
  const duplicate = core.appendSourceEvents(created.instance.id, events);

  assert.equal(first.appendedCount, 2);
  assert.equal(first.duplicateCount, 0);
  assert.equal(duplicate.appendedCount, 0);
  assert.equal(duplicate.duplicateCount, 2);
  assert.deepEqual(
    duplicate.work.sourceArchive.map((event) => event.externalId),
    ["message-user-1", "message-agent-1"],
  );

  core.close();
});

test("Extractor 可更新八字段但不能覆盖 USER_EDITED 内容", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-state" },
  });

  const extracted = core.applyExtractorPatch(created.instance.id, {
    objective: [stateItem("objective-1", "实现 MVP", "USER_STATED")],
    successCriteria: [stateItem("criteria-1", "真实完成接力")],
    constraints: [stateItem("constraint-1", "数据只存本机")],
    facts: [stateItem("fact-1", "WorkBuddy 支持 MCP")],
    decisions: [stateItem("decision-1", "使用 SQLite")],
    completedActions: [stateItem("done-1", "完成领域建模")],
    pendingActions: [stateItem("pending-1", "接入 WorkBuddy")],
    artifacts: [stateItem("artifact-1", "需求说明")],
  });
  const edited = core.editWorkStateItem(
    created.instance.id,
    "facts",
    "fact-1",
    "WorkBuddy 通过本地 Connector 提供 MCP",
  );
  const patchedAgain = core.applyExtractorPatch(created.instance.id, {
    facts: [stateItem("fact-1", "模型试图覆盖的旧事实")],
  });
  const newIdForOriginal = core.applyExtractorPatch(created.instance.id, {
    facts: [stateItem("fact-new-id", "WorkBuddy 支持 MCP")],
  });

  assert.deepEqual(
    Object.values(extracted.state).map((items) => items.length),
    [1, 1, 1, 1, 1, 1, 1, 1],
  );
  assert.equal(edited.state.facts[0]?.origin, "USER_EDITED");
  assert.ok(edited.state.facts[0]?.editedAt);
  assert.equal(
    patchedAgain.state.facts[0]?.text,
    "WorkBuddy 通过本地 Connector 提供 MCP",
  );
  assert.equal(patchedAgain.state.facts[0]?.origin, "USER_EDITED");
  assert.deepEqual(patchedAgain.state.facts[0]?.sourceMessageIds, ["message-1"]);
  assert.equal(edited.state.facts[0]?.originalText, "WorkBuddy 支持 MCP");
  assert.equal(newIdForOriginal.state.facts.length, 1);

  core.close();
});

test("删除的 Work State 条目留下 tombstone 并阻止 Extractor 重建", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-tombstone" },
  });
  core.applyExtractorPatch(created.instance.id, {
    pendingActions: [stateItem("pending-deleted", "读取 WorkBuddy 私有数据库")],
  });

  const deleted = core.deleteWorkStateItem(
    created.instance.id,
    "pendingActions",
    "pending-deleted",
  );
  const patchedAgain = core.applyExtractorPatch(created.instance.id, {
    pendingActions: [
      stateItem("new-id-for-deleted-content", "读取 WorkBuddy 私有数据库。"),
      stateItem("same-source-other-content", "通过公开 MCP 读取工作上下文"),
    ],
  });

  assert.deepEqual(deleted.state.pendingActions, []);
  assert.deepEqual(patchedAgain.state.pendingActions.map((item) => item.text), ["通过公开 MCP 读取工作上下文"]);

  core.close();
});

test("完成后停止绑定，继续原工作时在同一实例中新建 Episode", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-lifecycle" },
  });
  assert.ok(created.activeEpisode);
  assert.ok(created.activeBinding);

  const completed = core.completeWork(created.instance.id);

  assert.equal(completed.instance.status, "COMPLETED");
  assert.equal(completed.activeEpisode, null);
  assert.equal(completed.activeBinding, null);
  assert.equal(completed.episodes[0]?.status, "ENDED");
  assert.equal(completed.bindings[0]?.status, "INACTIVE");
  assert.throws(
    () =>
      core.appendSourceEvents(created.instance.id, [
        {
          externalId: "after-complete",
          sequence: 1,
          kind: "user.prompt",
          content: "完成后不应自动记录",
          timestamp: "2026-09-02T10:00:00.000Z",
          executorType: "HUMAN",
          environmentType: "CODEX_DESKTOP",
          metadata: {},
          artifactRefs: [],
        },
      ]),
    /WORK_NOT_CAPTURING/,
  );

  const resumed = core.resumeWork(created.instance.id, {
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-lifecycle" },
  });

  assert.equal(resumed.instance.id, created.instance.id);
  assert.equal(resumed.instance.status, "OPEN");
  assert.equal(resumed.episodes.length, 2);
  assert.equal(resumed.bindings.length, 2);
  assert.ok(resumed.activeEpisode);
  assert.notEqual(resumed.activeEpisode.id, created.activeEpisode.id);
  assert.ok(resumed.activeBinding);
  assert.notEqual(resumed.activeBinding.id, created.activeBinding.id);

  core.close();
});

test("停止捕获只结束当前 Binding 和 Episode，不结束 WorkInstance", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-stop-capture" },
  });

  const stopped = core.stopCapture(created.instance.id);

  assert.equal(stopped.instance.status, "OPEN");
  assert.equal(stopped.activeBinding, null);
  assert.equal(stopped.activeEpisode, null);
  assert.equal(stopped.bindings[0]?.status, "INACTIVE");
  assert.equal(stopped.episodes[0]?.status, "ENDED");
  core.close();
});

test("Handoff Package 投影结构化状态但不包含完整 Source Archive", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    objective: "做出可用的 MVP",
    objectiveSourceMessageIds: ["user-handoff-objective"],
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-handoff" },
  });
  core.appendSourceEvents(created.instance.id, [
    {
      externalId: "raw-secret-message",
      sequence: 1,
      kind: "agent.response",
      content: "只应存在于本地完整归档的敏感对话原文",
      timestamp: "2026-09-02T11:00:00.000Z",
      executorType: "AGENT",
      environmentType: "CODEX_DESKTOP",
      metadata: {},
      artifactRefs: [],
    },
  ]);
  core.applyExtractorPatch(created.instance.id, {
    pendingActions: [stateItem("next-1", "接入 WorkBuddy")],
  });

  const handoff = core.createHandoffPackage(created.instance.id);
  const serialized = JSON.stringify(handoff);

  assert.equal(handoff.workInstanceId, created.instance.id);
  assert.equal(handoff.currentTask, "做出可用的 MVP");
  assert.equal(handoff.nextStep, "接入 WorkBuddy");
  assert.equal(handoff.sourceArchiveSummary.eventCount, 1);
  assert.equal(handoff.state.pendingActions[0]?.text, "接入 WorkBuddy");
  assert.equal("sourceArchive" in handoff, false);
  assert.equal(serialized.includes("只应存在于本地完整归档的敏感对话原文"), false);
  assert.equal(core.getWork(created.instance.id)?.handoffPackages.length, 1);
  assert.deepEqual(core.getLatestHandoffPackage(created.instance.id), handoff);

  core.close();
});

test("交接结束来源绑定并在同一 WorkInstance 创建待绑定的 WorkBuddy Episode", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    objective: "继续同一项工作",
    objectiveSourceMessageIds: ["user-continue-objective"],
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-before-handoff" },
  });

  const handedOff = core.startExecutionEpisode(created.instance.id, {
    executor: { type: "AGENT", name: "WorkBuddy" },
    environment: { type: "WORKBUDDY_DESKTOP", name: "WorkBuddy Desktop" },
    source: { adapter: "workbuddy", conversationId: "pending:handoff-1" },
    endCurrentEpisode: true,
  });
  const bound = core.bindConversation(
    created.instance.id,
    "workbuddy",
    "pending:handoff-1",
    "workbuddy-session-1",
  );

  assert.equal(handedOff.instance.id, created.instance.id);
  assert.equal(handedOff.episodes.length, 2);
  assert.equal(handedOff.episodes[0]?.status, "ENDED");
  assert.equal(handedOff.activeEpisode?.environment.type, "WORKBUDDY_DESKTOP");
  assert.equal(bound.activeBinding?.conversationId, "workbuddy-session-1");
  assert.equal(core.findWorkByBinding("workbuddy", "workbuddy-session-1")?.instance.id, created.instance.id);

  core.close();
});

test("工作列表和归档状态由 Work Core 统一管理", () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const first = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    objective: "第一项工作",
    objectiveSourceMessageIds: ["user-first-objective"],
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-list-1" },
  });
  const second = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    objective: "第二项工作",
    objectiveSourceMessageIds: ["user-second-objective"],
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-list-2" },
  });

  core.archiveWork(first.instance.id);

  assert.deepEqual(core.listWorks("OPEN").map((work) => work.instance.id), [second.instance.id]);
  assert.deepEqual(core.listWorks("ARCHIVED").map((work) => work.instance.id), [first.instance.id]);

  core.close();
});

test("永久删除只删除 Work 数据，不触碰 ArtifactRef 指向的原文件", () => {
  const directory = mkdtempSync(join(tmpdir(), "workpet-core-"));
  const originalPath = join(directory, "用户资料.txt");
  writeFileSync(originalPath, "这是用户自己的原始文件", "utf8");
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "thread-delete" },
  });

  const withArtifact = core.addArtifactRef(created.instance.id, {
    path: originalPath,
    role: "SOURCE",
    filename: "用户资料.txt",
    mimeType: "text/plain",
    size: 36,
    sha256: "known-sha256",
    lastModifiedAt: "2026-09-02T12:00:00.000Z",
    availability: "AVAILABLE",
  });
  assert.equal(withArtifact.artifactRefs[0]?.path, originalPath);

  core.deleteWorkPermanently(created.instance.id, {
    confirmation: created.instance.id,
  });

  assert.equal(core.getWork(created.instance.id), null);
  assert.equal(readFileSync(originalPath, "utf8"), "这是用户自己的原始文件");

  core.close();
});

function stateItem(
  id: string,
  text: string,
  origin: "USER_STATED" | "AGENT_PROPOSED" | "SYSTEM_INFERRED" = "SYSTEM_INFERRED",
) {
  return { id, text, origin, sourceMessageIds: ["message-1"] };
}
