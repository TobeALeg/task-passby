import assert from "node:assert/strict";
import test from "node:test";

import { LocalRuleExtractor } from "../../src/extractor/local-rule-extractor.ts";

test("本地提炼器生成带来源的通用 Work State，不读取原始文件", async () => {
  const extractor = new LocalRuleExtractor();
  const patch = await extractor.extract({
    previousState: null,
    events: [
      source("m1", "user.prompt", "请完成客户提案。必须只使用已确认的数据。"),
      source("a1", "agent.response", "已经完成竞品表，下一步补全引用。"),
      source("f1", "artifact.added", "/tmp/private.pdf", { path: "/tmp/private.pdf" })
    ]
  });

  assert.equal(patch.objective?.[0]?.origin, "USER_STATED");
  assert.deepEqual(patch.objective?.[0]?.sourceMessageIds, ["m1"]);
  assert.match(patch.constraints?.[0]?.text ?? "", /必须只使用/);
  assert.match(patch.completedActions?.[0]?.text ?? "", /已经完成竞品表/);
  assert.match(patch.pendingActions?.[0]?.text ?? "", /补全引用/);
  assert.equal(patch.artifacts?.[0]?.text, "/tmp/private.pdf");
});

test("本地提炼器忽略确认词并限制每个字段的噪声数量", async () => {
  const extractor = new LocalRuleExtractor();
  const events = ["好", "确认", "同意", "yes", ...Array.from({ length: 20 }, (_, index) => `必须遵守第 ${index + 1} 条约束。`)]
    .map((content, index) => source(`m${index}`, "user.prompt", content));

  const patch = await extractor.extract({ previousState: null, events });

  assert.ok((patch.constraints?.length ?? 0) <= 8);
  assert.ok(patch.constraints?.every((entry) => !/^(好|确认|同意|yes)$/iu.test(entry.text)));
  assert.notEqual(patch.objective?.[0]?.text, "好");
});

function source(id: string, kind: string, content: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    externalId: id,
    sequence: 1,
    kind,
    content,
    timestamp: "2026-09-02T00:00:00.000Z",
    executorType: kind === "user.prompt" ? "HUMAN" : "AGENT",
    environmentType: "CODEX_DESKTOP",
    metadata
  };
}
