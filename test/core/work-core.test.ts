import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkCore } from "../../src/core/index.ts";

test("创建工作时一次建立定义、实例、记录、执行片段和来源绑定", () => {
  const core = createWorkCore({ databasePath: ":memory:" });

  const work = core.createWork({
    definition: {
      key: "general-work",
      name: "通用工作",
      version: 1,
    },
    objective: "完成跨应用接力 MVP",
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
      sourceMessageIds: [],
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

  assert.deepEqual(
    Object.values(extracted.state).map((items) => items.length),
    [1, 1, 1, 1, 1, 1, 1, 1],
  );
  assert.equal(edited.state.facts[0]?.origin, "USER_EDITED");
  assert.equal(
    patchedAgain.state.facts[0]?.text,
    "WorkBuddy 通过本地 Connector 提供 MCP",
  );
  assert.equal(patchedAgain.state.facts[0]?.origin, "USER_EDITED");
  assert.deepEqual(patchedAgain.state.facts[0]?.sourceMessageIds, ["message-1"]);

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
    pendingActions: [stateItem("pending-deleted", "读取 WorkBuddy 私有数据库")],
  });

  assert.deepEqual(deleted.state.pendingActions, []);
  assert.deepEqual(patchedAgain.state.pendingActions, []);

  core.close();
});

function stateItem(
  id: string,
  text: string,
  origin: "USER_STATED" | "AGENT_PROPOSED" | "SYSTEM_INFERRED" = "SYSTEM_INFERRED",
) {
  return { id, text, origin, sourceMessageIds: ["message-1"] };
}
