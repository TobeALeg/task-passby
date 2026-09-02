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
  assert.equal(work.activeEpisode.status, "ACTIVE");
  assert.equal(work.activeEpisode.executor.type, "AGENT");
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
