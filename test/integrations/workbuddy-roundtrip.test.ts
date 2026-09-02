import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkBuddyHookIngestor } from "../../dist/adapters/workbuddy/hook-ingestor.js";
import { WorkPetMcpHandler } from "../../dist/bridge/mcp-handler.js";
import { createWorkCore } from "../../dist/core/index.js";

test("WorkBuddy 通过 marker 绑定同一工作、读取接力状态并把可见回复写回", async () => {
  const core = createWorkCore({ databasePath: ":memory:" });
  const created = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    objective: "完成跨应用接力",
    objectiveSourceMessageIds: ["user-roundtrip-objective"],
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: { adapter: "codex", conversationId: "codex-thread" }
  });
  core.appendSourceEvents(created.instance.id, [{
    externalId: "codex-private-history",
    sequence: 1,
    kind: "agent.response",
    content: "这段完整历史不得自动进入接力包",
    timestamp: "2026-09-02T10:00:00.000Z",
    executorType: "AGENT",
    environmentType: "CODEX_DESKTOP",
    metadata: {},
    artifactRefs: []
  }]);
  const pendingId = "pending:handoff-test";
  core.startExecutionEpisode(created.instance.id, {
    executor: { type: "AGENT", name: "WorkBuddy" },
    environment: { type: "WORKBUDDY_DESKTOP", name: "WorkBuddy Desktop" },
    source: { adapter: "workbuddy", conversationId: pendingId },
    endCurrentEpisode: true
  });

  const hooks = new WorkBuddyHookIngestor(core);
  const markerPrompt = `[WORKPET:${created.instance.id}] 请调用 get_work_context 后继续。`;
  const bound = await hooks.ingest({
    hook_event_name: "UserPromptSubmit",
    session_id: "workbuddy-session",
    prompt: markerPrompt
  });
  assert.equal(bound.accepted, true);
  assert.equal(core.getWork(created.instance.id)?.activeBinding?.conversationId, "workbuddy-session");

  const mcp = new WorkPetMcpHandler(core, { proofToken: "proof-token-1" });
  const context = mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_work_context", arguments: { work_id: created.instance.id } }
  });
  assert.match(JSON.stringify(context), /完成跨应用接力/u);
  assert.match(JSON.stringify(context), /proof-token-1/u);
  assert.doesNotMatch(JSON.stringify(context), /完整历史不得/u);
  const auditedToolCall = core.getWork(created.instance.id)?.sourceArchive.find(
    (event) => event.kind === "tool.call" && event.metadata.toolName === "get_work_context"
  );
  const auditedToolResult = core.getWork(created.instance.id)?.sourceArchive.find(
    (event) => event.kind === "tool.result" && event.metadata.auditId === auditedToolCall?.metadata.auditId
  );
  assert.equal(auditedToolCall?.environmentType, "WORKBUDDY_DESKTOP");
  assert.equal(auditedToolCall?.episodeId, core.getWork(created.instance.id)?.activeEpisode?.id);
  assert.equal(auditedToolCall?.metadata.bindingId, core.getWork(created.instance.id)?.activeBinding?.id);
  assert.equal(auditedToolCall?.metadata.conversationId, "workbuddy-session");
  assert.equal(auditedToolResult?.metadata.outcome, "success");

  const directory = await mkdtemp(join(tmpdir(), "workpet-roundtrip-"));
  const transcriptPath = join(directory, "session.jsonl");
  await writeFile(transcriptPath, [
    JSON.stringify({ id: "user-1", message: { role: "user", content: markerPrompt } }),
    JSON.stringify({ id: "assistant-1", message: { role: "assistant", content: [{ type: "thinking", text: "隐藏思维" }, { type: "text", text: "我已接手并完成下一步。" }] } })
  ].join("\n"));
  const stopped = await hooks.ingest({
    hook_event_name: "Stop",
    session_id: "workbuddy-session",
    transcript_path: transcriptPath
  });
  assert.equal(stopped.appendedCount, 1);
  const work = core.getWork(created.instance.id);
  assert.match(JSON.stringify(work?.sourceArchive), /我已接手并完成下一步/u);
  assert.doesNotMatch(JSON.stringify(work?.sourceArchive), /隐藏思维/u);

  const archive = mcp.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_work_archive", arguments: { work_id: created.instance.id } }
  });
  assert.match(JSON.stringify(archive), /完整历史不得/u);
  core.close();
});
