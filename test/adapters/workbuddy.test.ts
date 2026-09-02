import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkBuddyDeepLink, buildWorkBuddyBootstrap } from "../../src/adapters/workbuddy/deep-link.ts";

test("WorkBuddy 交接只通过 deep link 传递稳定 marker 和 MCP 指令", () => {
  const prompt = buildWorkBuddyBootstrap({
    workId: "work-123",
    title: "准备客户提案",
    currentTask: "补全证据来源",
    nextStep: "调用 get_work_context 后继续",
    artifactPaths: ["/tmp/input.pdf"]
  });
  const link = buildWorkBuddyDeepLink(prompt);
  const url = new URL(link);

  assert.equal(url.protocol, "workbuddy:");
  assert.equal(url.hostname, "task");
  assert.equal(url.searchParams.get("action"), "start");
  assert.equal(url.searchParams.get("welcomeMode"), "work");
  assert.equal(url.searchParams.get("permissionMode"), "default");
  assert.match(url.searchParams.get("prompt") ?? "", /\[WORKPET:work-123\]/);
  assert.match(url.searchParams.get("prompt") ?? "", /get_work_context/);
  assert.doesNotMatch(url.searchParams.get("prompt") ?? "", /完整历史/);
});

test("WorkBuddy deep link 拒绝超过产品上限的 prompt", () => {
  assert.throws(() => buildWorkBuddyDeepLink("x".repeat(8_001)), /8000/);
});
