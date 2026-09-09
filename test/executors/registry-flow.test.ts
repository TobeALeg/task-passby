import test from "node:test";
import assert from "node:assert/strict";
import { AppService } from "../../dist/app/app-service.js";
import type {
  ExecutorAdapter,
  DeliveryRequest,
} from "../../dist/executors/types.js";
import type { NormalizedThread } from "../../dist/adapters/types.js";
function fixture(id: string) {
  const threads = new Map<string, NormalizedThread>();
  const deliveries: DeliveryRequest[] = [];
  let fail = false;
  let pending = false;
  const add = (cid: string, text = cid) => {
    const externalId = `${id}:${cid}:prompt`;
    const thread = {
      threadId: cid,
      title: text,
      applicationTitle: text,
      cwd: "/tmp",
      createdAt: "2026-09-09T00:00:00Z",
      updatedAt: "2026-09-09T01:00:00Z",
      events: [
        {
          id: externalId,
          externalId,
          sequence: 1,
          kind: "user.prompt",
          content: text,
          timestamp: "2026-09-09T01:00:00Z",
          executorType: "HUMAN",
          environmentType: id,
        },
      ],
    } as NormalizedThread;
    threads.set(cid, thread);
    return thread;
  };
  const adapter: ExecutorAdapter = {
    id,
    name: id,
    mark: id[0]!,
    bundleIds: [`app.${id}`],
    environment: { type: id, name: id },
    source: {
      async listThreadPage() {
        return {
          threads: [...threads.values()].map((t) => ({
            id: t.threadId,
            title: t.title,
            preview: "",
            cwd: t.cwd,
            updatedAt: t.updatedAt,
            status: "idle",
          })),
          nextCursor: null,
        };
      },
      async readThread(cid) {
        if (fail) throw new Error("offline");
        const value = threads.get(cid);
        if (!value) throw new Error("not found");
        return structuredClone(value);
      },
      close() {},
    },
    async inspect() {
      if (fail) throw new Error("offline");
    },
    async resolveCurrent(app) {
      const matches = [...threads.values()].filter(
        (t) => t.title === app.windowTitle,
      );
      return matches.length === 1
        ? {
            id: matches[0]!.threadId,
            title: matches[0]!.title,
            preview: "",
            cwd: "/tmp",
            updatedAt: matches[0]!.updatedAt,
            status: "idle",
          }
        : null;
    },
    async deliver(request) {
      deliveries.push(request);
      if (pending) return {};
      const cid = `delivered-${deliveries.length}`;
      add(cid, `[WORKPET:${request.workId}] received`);
      return { conversationId: cid };
    },
  };
  return {
    adapter,
    add,
    threads,
    deliveries,
    setFail(value: boolean) {
      fail = value;
    },
    setPending(value: boolean) {
      pending = value;
    },
  };
}
test("three peers record identical session IDs independently; failures and unselected conversations stay isolated", async () => {
  const peers = ["codex", "workbuddy", "third"].map(fixture);
  peers.forEach((p) => p.add("same"));
  peers[1]!.add("sleeping", "旧的 WorkBuddy 工作");
  const app = new AppService({
    databasePath: ":memory:",
    executors: peers.map((p) => p.adapter),
  });
  const ids = [];
  try {
    assert.equal((await app.listRecentConversations()).threads.length, 4);
    for (const peer of peers) {
      const result = await app.createWorkFromConversation({
        executorId: peer.adapter.id,
        threadId: "same",
      });
      ids.push(result.selectedWorkId!);
    }
    assert.equal(new Set(ids).size, 3);
    peers[0]!.setFail(true);
    peers[1]!.threads.get("same")!.events.push({
      ...peers[1]!.threads.get("same")!.events[0]!,
      id: "new",
      externalId: "workbuddy:same:next",
      sequence: 2,
      content: "next",
    });
    await app.syncRecordedWorks();
    assert.equal(
      app
        .core()
        .getWork(ids[1]!)!
        .sourceArchive.filter((e) => e.content === "next").length,
      1,
    );
    assert.equal(app.core().findWorkByBinding("workbuddy", "sleeping"), null);
    await app.syncRecordedWorks();
    assert.equal(
      app
        .core()
        .getWork(ids[1]!)!
        .sourceArchive.filter((e) => e.content === "next").length,
      1,
    );
    app.completeWork(ids[1]!);
    assert.equal(
      (await app.syncHook("workbuddy", { session_id: "same" })).accepted,
      false,
    );
  } finally {
    app.close();
  }
});
test("ambiguous foreground opens executor-specific selection without creating a pending or guessing the newest session", async () => {
  const buddy = fixture("workbuddy");
  buddy.add("a");
  buddy.add("b");
  const app = new AppService({
    databasePath: ":memory:",
    executors: [buddy.adapter],
    foreground: {
      async detect() {
        return {
          bundleId: "app.workbuddy",
          name: "WorkBuddy",
          windowTitle: null,
        };
      },
    },
  });
  try {
    assert.equal(
      (await app.getPetView()).currentConversation?.needsSelection,
      true,
    );
    const result = await app.recordCurrentContext();
    assert.equal(result.works.length, 0);
    assert.equal(result.sourceSelection, "workbuddy");
    assert.equal(app.consumeSourceSelection(), "workbuddy");
    assert.equal(app.consumeSourceSelection(), undefined);
    const recorded = await app.createWorkFromConversation({
      executorId: "workbuddy",
      threadId: "a",
    });
    assert.equal(recorded.selectedWork?.captureStatus, "recording");
    await app.createWorkFromConversation({
      executorId: "workbuddy",
      threadId: "b",
    });
    assert.equal(app.dashboard().works.length, 2);
  } finally {
    app.close();
  }
});
test("handoff in both directions and to a third executor preserves work identity and creates separate bound episodes", async () => {
  const a = fixture("codex"),
    b = fixture("workbuddy"),
    c = fixture("third");
  a.add("original");
  const app = new AppService({
    databasePath: ":memory:",
    executors: [a.adapter, b.adapter, c.adapter],
  });
  try {
    const id = (
      await app.createWorkFromConversation({
        executorId: "codex",
        threadId: "original",
      })
    ).selectedWorkId!;
    for (const target of [b, a, c]) {
      const result = await app.handoff(id, target.adapter.id);
      assert.equal(result.selectedWorkId, id);
      assert.equal(
        app.core().getWork(id)!.activeBinding!.adapter,
        target.adapter.id,
      );
      assert.match(target.deliveries[0]!.prompt, new RegExp(id));
      await app.syncRecordedWorks();
    }
    const work = app.core().getWork(id)!;
    assert.equal(work.episodes.length, 4);
    assert.equal(app.dashboard().works.length, 1);
    assert.equal(work.episodes.filter((e) => e.status === "ACTIVE").length, 1);
    const sequences = work.sourceArchive.map((e) => e.sequence);
    assert.equal(new Set(sequences).size, sequences.length);
  } finally {
    app.close();
  }
});
test("pending delivery binds only its selected executor and marker, rejects duplicates, and resumes the last executor", async () => {
  const a = fixture("codex"),
    b = fixture("workbuddy");
  a.add("original");
  b.setPending(true);
  b.add("real");
  const app = new AppService({
    databasePath: ":memory:",
    executors: [a.adapter, b.adapter],
  });
  try {
    const id = (
      await app.createWorkFromConversation({
        executorId: "codex",
        threadId: "original",
      })
    ).selectedWorkId!;
    await app.handoff(id, "workbuddy");
    await assert.rejects(app.handoff(id, "workbuddy"), /尚未确认/);
    assert.equal(b.deliveries.length, 1);
    assert.equal(
      (
        await app.syncHook("workbuddy", {
          hook_event_name: "UserPromptSubmit",
          session_id: "real",
          prompt: "unrelated",
        })
      ).accepted,
      false,
    );
    assert.equal(
      (
        await app.syncHook("codex", {
          hook_event_name: "UserPromptSubmit",
          session_id: "real",
          prompt: b.deliveries.at(-1)!.prompt,
        })
      ).accepted,
      false,
    );
    assert.equal(
      (
        await app.syncHook("workbuddy", {
          hook_event_name: "UserPromptSubmit",
          session_id: "real",
          prompt: b.deliveries.at(-1)!.prompt,
        })
      ).accepted,
      true,
    );
    assert.equal(app.core().getWork(id)!.activeBinding!.conversationId, "real");
    app.completeWork(id);
    app.resumeWork(id);
    assert.equal(app.core().getWork(id)!.activeBinding!.adapter, "workbuddy");
  } finally {
    app.close();
  }
});

test("cancelled delivery restores the previous source and late prompts cannot bind a retry", async () => {
  const a = fixture("codex"),
    b = fixture("workbuddy");
  a.add("original");
  b.setPending(true);
  b.add("real");
  const app = new AppService({
    databasePath: ":memory:",
    executors: [a.adapter, b.adapter],
  });
  try {
    const id = (
      await app.createWorkFromConversation({
        executorId: "codex",
        threadId: "original",
      })
    ).selectedWorkId!;
    await app.handoff(id, "workbuddy");
    const oldPrompt = b.deliveries[0]!.prompt;
    app.cancelHandoff(id, "已确认未接手");
    assert.equal(
      app.core().getWork(id)!.activeBinding!.conversationId,
      "original",
    );
    await app.handoff(id, "workbuddy");
    assert.equal(
      (
        await app.syncHook("workbuddy", {
          hook_event_name: "UserPromptSubmit",
          session_id: "real",
          prompt: oldPrompt,
        })
      ).accepted,
      false,
    );
    assert.equal(
      (
        await app.syncHook("workbuddy", {
          hook_event_name: "UserPromptSubmit",
          session_id: "real",
          prompt: b.deliveries[1]!.prompt,
        })
      ).accepted,
      true,
    );
    assert.throws(() => app.cancelHandoff(id, "已确认未接手"), /已确认/);
  } finally {
    app.close();
  }
});
