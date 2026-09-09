import { makeService } from "../helpers/app-options.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { AppService } from "../../dist/app/app-service.js";
import type { NormalizedThread } from "../../dist/adapters/types.js";

function fixture() {
  const now = Date.now();
  const threads: NormalizedThread[] = ["活动 A", "活动 B", "沉睡 C"].map((title, i) => ({
    threadId: String(i), title, applicationTitle: title, cwd: "/tmp",
    createdAt: new Date(now - 100_000).toISOString(),
    updatedAt: new Date(now - (i === 2 ? 86_400_000 : i * 1000)).toISOString(),
    events: [{ id: `prompt-${i}`, externalId: `prompt-${i}`, sequence: 1, kind: "user.prompt", content: `请处理${title}`,
      timestamp: new Date(now).toISOString(), executorType: "HUMAN", environmentType: "CODEX_DESKTOP" }]
  }));
  const reads: string[] = [];
  let unavailable: string | null = null;
  const codex = {
    async listRecentThreads() { return threads.slice(0, 2).map((t) => ({ id: t.threadId, title: t.title, cwd: t.cwd, updatedAt: t.updatedAt, preview: "", status: { type: "notLoaded" } })); },
    async listThreadPage(_limit?: number, cursor?: string) {
      return cursor
        ? { threads: [{ id: "2", title: threads[2]!.title, cwd: "/tmp", updatedAt: threads[2]!.updatedAt, preview: "", status: { type: "notLoaded" } }], nextCursor: null }
        : { threads: await this.listRecentThreads(), nextCursor: "older" };
    },
    async readThread(id: string) { reads.push(id); if (unavailable === id) throw new Error("暂时不可读"); return threads.find((t) => t.threadId === id)!; },
    close() {}
  };
  const service = makeService({ databasePath: ":memory:", codex,
    foreground: { async detect() { return { bundleId: "DOVE.tauri", name: "Codex", windowTitle: null }; } },
    launcher: { async openNewConversation() { return "opened" as const; } }
  });
  return { service, threads, codex, reads, fail: (id: string | null) => { unavailable = id; } };
}

test("并行活动导致前台不唯一时，面板来源仍列出两项，沉睡聊天可以翻页加入", async () => {
  const { service, reads } = fixture();
  try {
    assert.equal((await service.getPetView()).currentConversation?.needsSelection, true);
    const sources = await service.listConversations("codex");
    assert.deepEqual(sources.map((s) => s.title), ["活动 A", "活动 B"]);
    assert.equal(service.dashboard().works.length, 0);
    assert.deepEqual(reads, [], "列出候选不归档聊天正文");
    for (const source of sources) await service.createWorkFromConversation({executorId: "codex",  threadId: source.id });
    const firstPage = await service.listConversationHistory("codex");
    assert.ok(firstPage.threads.every((t) => t.workId));
    const older = await service.listConversationHistory("codex", firstPage.nextCursor!);
    assert.equal(older.threads[0]?.title, "沉睡 C");
    await service.createWorkFromConversation({executorId: "codex",  threadId: older.threads[0]!.id });
    const repeated = await service.createWorkFromConversation({executorId: "codex",  threadId: "0" });
    assert.equal(repeated.works.length, 3);
    assert.ok(repeated.works.every((w) => w.captureStatus === "recording" && w.eventCount >= 2));
  } finally { service.close(); }
});

test("未收到 Hook 时所有已选聊天仍增量同步，未选聊天不读取，单项失败不阻塞其他工作", async () => {
  const { service, threads, reads, fail } = fixture();
  try {
    await service.createWorkFromConversation({executorId: "codex",  threadId: "0" });
    await service.createWorkFromConversation({executorId: "codex",  threadId: "1" });
    for (const thread of threads) thread.events.push({ ...thread.events[0]!, id: `next-${thread.threadId}`, externalId: `next-${thread.threadId}`, sequence: 2, content: "新增可见消息" });
    reads.length = 0;
    fail("0");
    await service.syncRecordedWorks();
    assert.equal(service.core().findWorkByBinding("codex", "1")?.sourceArchive.length, 3);
    assert.equal(service.core().findWorkByBinding("codex", "0")?.sourceArchive.length, 2);
    assert.ok(!reads.includes("2"));
    fail(null);
    await service.syncRecordedWorks();
    await service.syncRecordedWorks();
    assert.ok(service.dashboard().works.every((w) => w.eventCount === 3));
    service.completeWork(service.core().findWorkByBinding("codex", "0")!.instance.id);
    reads.length = 0;
    await service.syncRecordedWorks();
    assert.deepEqual(reads, ["1"]);
  } finally { service.close(); }
});

test("会话读取期间用户完成工作，返回的数据不再写入", async () => {
  const { service, codex, threads } = fixture();
  try {
    const created = await service.createWorkFromConversation({executorId: "codex",  threadId: "0" });
    codex.readThread = async () => {
      service.completeWork(created.selectedWorkId!);
      return { ...threads[0]!, events: [...threads[0]!.events, { ...threads[0]!.events[0]!, externalId: "late", id: "late" }] };
    };
    assert.equal((await service.syncHook("codex", { session_id: "0" })).accepted, false);
    assert.equal(service.dashboard().selectedWork?.eventCount, 2);
  } finally { service.close(); }
});

test("来源目录不可用时仍能显示已记录的工作", async () => {
  const { service, codex } = fixture();
  try {
    await service.createWorkFromConversation({executorId: "codex",  threadId: "0" });
    codex.listRecentThreads = async () => { throw new Error("App Server 暂时退出"); };
    assert.equal((await service.dashboardWithVerification()).works.length, 1);
  } finally { service.close(); }
});
