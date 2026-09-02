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
  const binding = {
    id: "binding-1",
    episodeId: "episode-1",
    adapter: "workbuddy",
    status: "ACTIVE",
    conversationId: "desktop-session-1"
  };
  const work = {
    eventCount: 12,
    bindings: [binding],
    episodes: [{ id: "episode-1", environment: "WorkBuddy Desktop" }]
  };
  const archiveEvents = [
    {
      kind: "tool.call", episodeId: "episode-1", environmentType: "WORKBUDDY_DESKTOP",
      metadata: {
        toolName: "get_work_context", outcome: "success", auditId: "audit-1",
        bindingId: "binding-1", conversationId: "desktop-session-1"
      }
    },
    {
      kind: "tool.result", episodeId: "episode-1", environmentType: "WORKBUDDY_DESKTOP",
      metadata: { outcome: "success", auditId: "audit-1" }
    },
    {
      kind: "user.prompt", episodeId: "episode-1", environmentType: "WORKBUDDY_DESKTOP",
      metadata: { sessionId: "desktop-session-1" }
    },
    {
      kind: "agent.response", episodeId: "episode-1", environmentType: "WORKBUDDY_DESKTOP",
      content: "已读取 proof-123",
      metadata: { sessionId: "desktop-session-1" }
    }
  ];
  assert.deepEqual(desktopRoundtripIssues({ work, archiveEvents, beforeEventCount: 10, proofToken: "proof-123" }), []);
  assert.ok(desktopRoundtripIssues({ work, archiveEvents: archiveEvents.slice(1), beforeEventCount: 10, proofToken: "proof-123" }).length > 0);
  const wrongEpisode = archiveEvents.map((event) => ({ ...event, episodeId: "episode-old" }));
  assert.ok(desktopRoundtripIssues({ work, archiveEvents: wrongEpisode, beforeEventCount: 10, proofToken: "proof-123" }).length > 0);
  const missingProof = archiveEvents.map((event) => event.kind === "agent.response" ? { ...event, content: "无法读取" } : event);
  assert.ok(desktopRoundtripIssues({ work, archiveEvents: missingProof, beforeEventCount: 10, proofToken: "proof-123" }).length > 0);
});

test("archive MCP 响应能提取事件", () => {
  const events = [{ kind: "agent.response" }];
  const response = { result: { content: [{ type: "text", text: JSON.stringify({ events }) }] } };
  assert.deepEqual(parseArchiveEvents(response), events);
});
