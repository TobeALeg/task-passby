import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppService } from "../dist/app/app-service.js";
import { createWorkBuddyExecutor } from "../dist/adapters/workbuddy/executor.js";
const directory = await mkdtemp(join(tmpdir(), "worket-workbuddy-read-"));
const executor = createWorkBuddyExecutor({
  launcher: {
    async openNewConversation() {
      throw new Error("Read-only QA cannot deliver tasks");
    },
  },
});
const app = new AppService({
  databasePath: join(directory, "workpet.sqlite"),
  executors: [executor],
  foreground: {
    async detect() {
      return {
        bundleId: executor.bundleIds[0],
        name: executor.name,
        windowTitle: null,
      };
    },
  },
});
try {
  await executor.inspect();
  const sources = await app.listConversations(executor.id);
  assert.ok(sources.length, "WorkBuddy 有可读取的历史");
  const requested = process.env.WORKPET_QA_WORKBUDDY_THREAD;
  const source = requested
    ? sources.find((s) => s.id === requested)
    : sources[0];
  assert.ok(source);
  assert.equal(
    (await app.getPetView()).currentConversation.needsSelection,
    true,
  );
  const selection = await app.recordCurrentContext();
  assert.equal(selection.works.length, 0);
  assert.equal(selection.sourceSelection, "workbuddy");
  const imported = await app.createWorkFromConversation({
    executorId: executor.id,
    threadId: source.id,
    allowCloudExtraction: false,
  });
  const id = imported.selectedWorkId;
  assert.equal(imported.selectedWork.captureStatus, "recording");
  assert.ok(imported.selectedWork.eventCount > 0);
  const count = imported.selectedWork.eventCount;
  const repeated = await app.createWorkFromConversation({
    executorId: executor.id,
    threadId: source.id,
    allowCloudExtraction: false,
  });
  assert.equal(repeated.selectedWorkId, id);
  assert.equal(repeated.works.length, 1);
  await app.syncRecordedWorks();
  const work = app.core().getWork(id);
  assert.equal(
    new Set(work.sourceArchive.map((e) => e.externalId)).size,
    work.sourceArchive.length,
  );
  app.completeWork(id);
  await app.syncRecordedWorks();
  assert.equal(
    app.core().getWork(id).sourceArchive.length,
    work.sourceArchive.length,
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        visibleConversations: sources.length,
        importedEvents: count,
        eventKinds: [...new Set(work.sourceArchive.map((e) => e.kind))],
        sameWorkOnRepeat: true,
        completedStopsRecording: true,
        database: join(directory, "workpet.sqlite"),
      },
      null,
      2,
    ),
  );
} finally {
  app.close();
}
