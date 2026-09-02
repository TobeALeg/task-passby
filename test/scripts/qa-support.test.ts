import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUNDTRIP_SENTINEL,
  containsExactString,
  desktopRoundtripIssues,
  parseArchiveEvents,
  qualificationIssues
} from "../../scripts/qa-support.mjs";

test("桌面验收资格要求二十轮用户输入和两份附件", () => {
  assert.deepEqual(qualificationIssues({ userPromptCount: 20, artifactCount: 2 }), []);
  assert.equal(qualificationIssues({ userPromptCount: 19, artifactCount: 1 }).length, 2);
});

test("拒绝回复即使复述口令也不能冒充闭环成功", () => {
  const refusal = { result: `无法调用工具，因此不能回复 ${ROUNDTRIP_SENTINEL}` };
  const success = { result: ROUNDTRIP_SENTINEL };
  assert.equal(containsExactString(refusal, ROUNDTRIP_SENTINEL), false);
  assert.equal(containsExactString(success, ROUNDTRIP_SENTINEL), true);
});

test("桌面闭环必须同时具有真实 binding、MCP 调用和可见回复", () => {
  const work = {
    eventCount: 12,
    bindings: [{ adapter: "workbuddy", status: "ACTIVE", conversationId: "desktop-session-1" }],
    episodes: [{ environment: "WorkBuddy Desktop" }]
  };
  const archiveEvents = [
    { kind: "tool.call", environmentType: "WORKBUDDY_DESKTOP", metadata: { toolName: "get_work_context" } },
    { kind: "user.prompt", environmentType: "WORKBUDDY_DESKTOP", metadata: {} },
    { kind: "agent.response", environmentType: "WORKBUDDY_DESKTOP", metadata: {} }
  ];
  assert.deepEqual(desktopRoundtripIssues({ work, archiveEvents, beforeEventCount: 10 }), []);
  assert.ok(desktopRoundtripIssues({ work, archiveEvents: archiveEvents.slice(1), beforeEventCount: 10 }).length > 0);
});

test("archive MCP 响应能提取事件", () => {
  const events = [{ kind: "agent.response" }];
  const response = { result: { content: [{ type: "text", text: JSON.stringify({ events }) }] } };
  assert.deepEqual(parseArchiveEvents(response), events);
});
