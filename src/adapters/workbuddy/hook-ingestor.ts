import { createHash } from "node:crypto";

import { resolveArtifact } from "../../artifacts/resolver.js";
import type { SourceEventInput, WorkCore, WorkSnapshot } from "../../core/index.js";
import { parseWorkBuddyTranscript } from "./transcript.js";

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

export class WorkBuddyHookIngestor {
  readonly #core: WorkCore;

  constructor(core: WorkCore) {
    this.#core = core;
  }

  async ingest(payload: HookPayload): Promise<HookIngestResult> {
    const eventName = stringField(payload, "hook_event_name");
    const sessionId = stringField(payload, "session_id");
    if (!eventName || !sessionId) return { accepted: false, appendedCount: 0, reason: "缺少 Hook 身份字段" };

    let work = this.#core.findWorkByBinding("workbuddy", sessionId);
    const prompt = stringField(payload, "prompt");
    if (!work && prompt) {
      const workId = marker(prompt);
      const candidate = workId ? this.#core.getWork(workId) : null;
      const pending = candidate?.activeBinding?.adapter === "workbuddy" && candidate.activeBinding.conversationId.startsWith("pending:")
        ? candidate.activeBinding
        : null;
      if (candidate && pending) {
        work = this.#core.bindConversation(candidate.instance.id, "workbuddy", pending.conversationId, sessionId);
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
      await this.#attachArtifacts(work.instance.id, fresh);
      return { accepted: true, workInstanceId: work.instance.id, appendedCount: appended };
    }

    return { accepted: true, workInstanceId: work.instance.id, appendedCount: 0 };
  }

  #nextSequence(work: WorkSnapshot): number {
    return Math.max(0, ...work.sourceArchive.map((event) => event.sequence)) + 1;
  }

  async #attachArtifacts(workId: string, events: SourceEventInput[]): Promise<void> {
    const work = this.#core.getWork(workId);
    const known = new Set(work?.artifactRefs.map((artifact) => `${artifact.path}:${artifact.sha256}`) ?? []);
    for (const event of events) {
      if (event.kind !== "artifact.added") continue;
      const path = typeof event.metadata.path === "string" ? event.metadata.path : event.content;
      if (!path) continue;
      const artifact = await resolveArtifact(path, typeof event.metadata.role === "string" ? event.metadata.role : "INPUT");
      if (known.has(`${artifact.path}:${artifact.sha256}`)) continue;
      this.#core.addArtifactRef(workId, artifact);
      known.add(`${artifact.path}:${artifact.sha256}`);
    }
  }
}
