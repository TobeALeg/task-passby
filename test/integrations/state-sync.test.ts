import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalRuleExtractor } from "../../dist/extractor/local-rule-extractor.js";
import { makeService } from "../helpers/app-options.ts";
import type { NormalizedThread } from "../../dist/adapters/types.js";

test("重启后补算已归档但未提炼的进展，后台轮询和 Hook 同样更新状态", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "worket-state-sync-"));
  const thread: NormalizedThread = {
    threadId: "video", title: "制作视频", applicationTitle: "制作视频", cwd: directory,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    events: [{ id: "p1", externalId: "p1", sequence: 1, kind: "user.prompt", content: "制作视频", timestamp: new Date().toISOString(), executorType: "HUMAN", environmentType: "CODEX_DESKTOP" }],
  };
  const options = { databasePath: join(directory, "work.sqlite"), codex: { async listRecentThreads() { return []; }, async readThread() { return thread; }, close() {} }, foreground: { async detect() { return null; } } };
  let service = makeService(options);
  try {
    const created = await service.createWorkFromConversation({ executorId: "codex", threadId: "video", allowCloudExtraction: false });
    const id = created.selectedWorkId!;
    const completed = { ...thread.events[0]!, id: "a1", externalId: "a1", sequence: 2, kind: "agent.response" as const, executorType: "AGENT" as const, content: "已完成配音提速。" };
    thread.events.push(completed);
    // Previous versions saved new events without updating Work State.
    service.core().appendSourceEvents(id, [{ ...completed, metadata: {}, artifactRefs: [] }]);
    service.core().definitions.db.exec("ALTER TABLE work_records DROP COLUMN extracted_sequence");
    service.close(); service = makeService(options);
    await service.syncRecordedWorks();
    assert.ok(service.dashboard(id).selectedWork!.state.completedActions.some(item => item.text.includes("已完成配音提速")), "已保存的最新进展必须在重启后补回详情");
    thread.events.push({ ...completed, id: "a2", externalId: "a2", sequence: 3, content: "已修复聚焦动画。" });
    await service.syncRecordedWorks();
    assert.ok(service.dashboard(id).selectedWork!.state.completedActions.some(item => item.sourceMessageIds.includes("a2")));
    thread.events.push({ ...completed, id: "a3", externalId: "a3", sequence: 4, content: "下一步：导出最终视频。" });
    await service.syncHook("codex", { session_id: "video" });
    assert.ok(service.dashboard(id).selectedWork!.state.pendingActions.some(item => item.sourceMessageIds.includes("a3")));
    assert.equal(service.dashboard(id).selectedWork!.latestActivity?.sourceMessageId, "a3");
    thread.events.push({ ...completed, id: "a4", externalId: "a4", sequence: 5, content: "正在调整声束动画与配音。" });
    await Promise.all([service.syncRecordedWorks(), service.syncHook("codex", { session_id: "video" })]);
    assert.equal(service.dashboard(id).selectedWork!.latestActivity?.text, "正在调整声束动画与配音。");
    assert.equal(service.core().getWork(id)!.sourceArchive.filter(event => event.externalId === "a4").length, 1);
    const sequence = service.core().extractedSequence(id);
    service.close(); service = makeService(options);
    assert.equal(service.core().extractedSequence(id), sequence);
    const snapshot = service.dashboard(id).selectedWork!.state;
    await service.syncRecordedWorks();
    assert.deepEqual(service.dashboard(id).selectedWork!.state, snapshot);
    thread.events.push({ ...completed, id: "a5", externalId: "a5", sequence: 6, content: "已完成最终导出。" });
    const originalExtract = LocalRuleExtractor.prototype.extract;
    let fail = true;
    t.mock.method(LocalRuleExtractor.prototype, "extract", async function(input) {
      if (fail) throw new Error("temporary extraction failure");
      return originalExtract.call(this, input);
    });
    await service.syncRecordedWorks();
    assert.ok(service.core().getWork(id)!.sourceArchive.some(event => event.externalId === "a5"), "状态更新失败不能丢弃已经记录的消息");
    assert.equal(service.core().extractedSequence(id), sequence, "失败时不能越过尚未处理的消息");
    service.close(); service = makeService(options); fail = false;
    await service.syncRecordedWorks();
    assert.ok(service.dashboard(id).selectedWork!.state.completedActions.some(item => item.sourceMessageIds.includes("a5")), "重启后必须重试状态更新失败的消息");
  } finally { service.close(); await rm(directory, { recursive: true, force: true }); }
});
