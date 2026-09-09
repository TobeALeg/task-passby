import type { NormalizedThread } from "../types.js";
import type { SourceEvent } from "../../core/types.js";

/** Reuse original evidence IDs when an older transcript record is read through the SDK. */
export function reconcileLegacyEvents(
  thread: NormalizedThread,
  archive: readonly SourceEvent[],
): NormalizedThread {
  const prefix = `workbuddy:${thread.threadId}:`;
  const legacy = archive
    .filter(
      (event) =>
        event.externalId.startsWith(prefix) &&
        /:(text|artifact):\d+$/.test(event.externalId),
    )
    .sort((a, b) => a.sequence - b.sequence);
  if (!legacy.length) return thread;
  const claimed = new Set<string>();
  return {
    ...thread,
    events: thread.events.map((event) => {
      const previous = legacy.find(
        (old) =>
          !claimed.has(old.externalId) &&
          old.kind === event.kind &&
          old.content?.trim() === event.content?.trim() &&
          Date.parse(old.timestamp) === Date.parse(event.timestamp),
      );
      if (!previous) return event;
      claimed.add(previous.externalId);
      return {
        ...event,
        id: previous.externalId,
        externalId: previous.externalId,
      };
    }),
  };
}
