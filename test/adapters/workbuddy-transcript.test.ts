import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseWorkBuddyTranscript } from "../../src/adapters/workbuddy/transcript.ts";

test("WorkBuddy transcript 只归档可见 user/assistant 内容并忽略 thinking 与 system", async () => {
  const directory = mkdtempSync(join(tmpdir(), "workpet-transcript-"));
  const image = join(directory, "chart.png");
  writeFileSync(image, "image", "utf8");
  const transcript = join(directory, "session.jsonl");
  writeFileSync(transcript, [
    JSON.stringify({ id: "system-1", message: { role: "system", content: "内部系统指令" } }),
    JSON.stringify({ id: "user-1", timestamp: "2026-09-02T01:00:00Z", message: { role: "user", content: [{ type: "text", text: "继续补全提案" }, { type: "image", path: image }] } }),
    JSON.stringify({ id: "assistant-1", timestamp: "2026-09-02T01:01:00Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "隐藏推理" }, { type: "text", text: "已补全两条证据。" }] } })
  ].join("\n"), "utf8");

  const events = await parseWorkBuddyTranscript(transcript, "session-1");

  assert.deepEqual(events.map((event) => event.kind), ["user.prompt", "artifact.added", "agent.response"]);
  assert.equal(events[0]?.content, "继续补全提案");
  assert.equal(events[1]?.metadata.path, image);
  assert.equal(events[2]?.content, "已补全两条证据。");
  assert.ok(events.every((event) => !event.content?.includes("隐藏推理") && !event.content?.includes("内部系统指令")));
});
