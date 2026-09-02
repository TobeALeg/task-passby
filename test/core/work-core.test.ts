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
