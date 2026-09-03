import { createHash } from "node:crypto";

import { ArtifactTracker } from "../../artifacts/tracker.js";
import type { SourceEventInput, WorkCore, WorkSnapshot } from "../../core/index.js";
import { parseWorkBuddyTranscript } from "./transcript.js";
import { createWorkBuddyWindowLocator, matchesPendingWorkBuddyWindow } from "./pending-capture.js";

type HookPayload = Record<string, unknown>;

export interface HookIngestResult {
  accepted: boolean;
  workInstanceId?: string;
  appendedCount: number;
  reason?: string;
}

function marker(prompt: string): string | null {
  return prompt.match(/\[WORKPET:([a-zA-Z0-9-]+)\]/u)?.[1] ?? null;
}

function stringField(payload: HookPayload, key: string): string | null {
  return typeof payload[key] === "string" ? payload[key] as string : null;
}

function waitingBinding(core: WorkCore, windowTitle: string | null): WorkSnapshot | null {
  const candidates = core.listWorks("OPEN").filter((work) => {
    const conversationId = work.activeBinding?.adapter === "workbuddy" ? work.activeBinding.conversationId : "";
    return matchesPendingWorkBuddyWindow(conversationId, windowTitle);
  });
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

export class WorkBuddyHookIngestor {
  readonly #core: WorkCore;
  readonly #artifacts: ArtifactTracker;

  constructor(core: WorkCore) {
    this.#core = core;
    this.#artifacts = new ArtifactTracker(core);
  }

  async ingest(payload: HookPayload): Promise<HookIngestResult> {
    const eventName = stringField(payload, "hook_event_name");
    const sessionId = stringField(payload, "session_id");
    const windowTitle = stringField(payload, "workpet_window_title");
    const sourceLocator = windowTitle?.trim() ? createWorkBuddyWindowLocator(windowTitle) : undefined;
    if (!eventName || !sessionId) return { accepted: false, appendedCount: 0, reason: "缺少 Hook 身份字段" };

    let work = this.#core.findWorkByBinding("workbuddy", sessionId);
    if (work?.activeBinding && sourceLocator && work.activeBinding.sourceLocator !== sourceLocator) {
      work = this.#core.bindConversation(work.instance.id, "workbuddy", sessionId, sessionId, sourceLocator);
    }
    const prompt = stringField(payload, "prompt");
    if (!work && prompt) {
      const workId = marker(prompt);
      const candidate = workId ? this.#core.getWork(workId) : null;
      const pending = candidate?.activeBinding?.adapter === "workbuddy" && candidate.activeBinding.conversationId.startsWith("pending:")
        ? candidate.activeBinding
        : null;
      if (candidate && pending) {
        work = this.#core.bindConversation(candidate.instance.id, "workbuddy", pending.conversationId, sessionId, sourceLocator);
      }
      if (!work && eventName === "UserPromptSubmit") {
        const waiting = waitingBinding(this.#core, windowTitle);
        const pending = waiting?.activeBinding;
        if (waiting && pending) {
          work = this.#core.bindConversation(waiting.instance.id, "workbuddy", pending.conversationId, sessionId, sourceLocator);
        }
      }
    }
    if (!work || work.instance.status !== "OPEN" || work.activeBinding?.adapter !== "workbuddy") {
      return { accepted: false, appendedCount: 0, reason: "会话未被用户绑定到 OPEN WorkInstance" };
    }

    if (eventName === "UserPromptSubmit" && prompt) {
      const turnId = stringField(payload, "turn_id");
      const contentHash = createHash("sha256").update(prompt).digest("hex").slice(0, 20);
      const event: SourceEventInput = {
        externalId: `workbuddy:${sessionId}:prompt:${turnId ?? contentHash}`,
        sequence: this.#nextSequence(work),
        kind: "user.prompt",
        content: prompt,
        timestamp: new Date().toISOString(),
        executorType: "HUMAN",
        environmentType: "WORKBUDDY_DESKTOP",
        metadata: { sessionId, hookEvent: eventName },
        artifactRefs: []
      };
      const result = this.#core.appendSourceEvents(work.instance.id, [event]);
      return { accepted: true, workInstanceId: work.instance.id, appendedCount: result.appendedCount };
    }

    if (eventName === "Stop") {
      const transcriptPath = stringField(payload, "transcript_path");
      if (!transcriptPath) return { accepted: true, workInstanceId: work.instance.id, appendedCount: 0, reason: "没有 transcript_path" };
      const parsed = await parseWorkBuddyTranscript(transcriptPath, sessionId);
      const knownIds = new Set(work.sourceArchive.map((event) => event.externalId));
      const knownUserContent = new Set(
        work.sourceArchive
          .filter((event) => event.kind === "user.prompt" && event.metadata.sessionId === sessionId)
          .map((event) => event.content)
      );
      let offset = this.#nextSequence(work) - 1;
      const fresh = parsed
        .filter((event) => !knownIds.has(event.externalId))
        .filter((event) => event.kind !== "user.prompt" || !knownUserContent.has(event.content))
        .map((event) => ({ ...event, sequence: ++offset, metadata: { ...event.metadata, sessionId, transcriptPath } }));
      const appended = fresh.length ? this.#core.appendSourceEvents(work.instance.id, fresh).appendedCount : 0;
      const latest = this.#core.getWork(work.instance.id);
      if (latest) await this.#artifacts.attach(latest, fresh);
      return { accepted: true, workInstanceId: work.instance.id, appendedCount: appended };
    }

    return { accepted: true, workInstanceId: work.instance.id, appendedCount: 0 };
  }

  #nextSequence(work: WorkSnapshot): number {
    return Math.max(0, ...work.sourceArchive.map((event) => event.sequence)) + 1;
  }
}
