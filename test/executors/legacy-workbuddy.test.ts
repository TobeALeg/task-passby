import test from "node:test";
import assert from "node:assert/strict";
import { reconcileLegacyEvents } from "../../src/adapters/workbuddy/legacy-events.ts";
import type { SourceEvent } from "../../src/core/types.ts";
import type { NormalizedThread } from "../../src/adapters/types.ts";
test("older WorkBuddy text IDs survive SDK migration without collapsing repeated messages", () => {
  const base = {
    kind: "user.prompt",
    content: "继续",
    timestamp: "2026-09-09T00:00:00Z",
  };
  const archive = [
    { ...base, externalId: "workbuddy:chat:old1:text:0", sequence: 1 },
    { ...base, externalId: "workbuddy:chat:old2:text:0", sequence: 2 },
  ] as SourceEvent[];
  const thread = {
    threadId: "chat",
    events: [1, 2, 3].map((i) => ({
      ...base,
      externalId: `workbuddy:chat:req${i}:user:0`,
      id: `new${i}`,
      sequence: i,
    })),
  } as NormalizedThread;
  const result = reconcileLegacyEvents(thread, archive);
  assert.deepEqual(
    result.events.map((e) => e.externalId),
    [
      "workbuddy:chat:old1:text:0",
      "workbuddy:chat:old2:text:0",
      "workbuddy:chat:req3:user:0",
    ],
  );
  assert.equal(thread.events[0]!.id, "new1");
  assert.deepEqual(reconcileLegacyEvents(thread, archive), result);
});
