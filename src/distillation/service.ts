import { ImprovementCollector } from "../improvement/collector.js";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { TextDecoder } from "node:util";
import type { WorkCore } from "../core/types.js";
import {
  ensure,
  object,
  string,
  array,
  LIMITS,
  validateRequest,
  validateResult,
  type SourceRef,
  type ExtractionRequest,
  type ExtractionResult,
} from "../contracts/definition.js";
import type { AIClient, RemoteJob } from "../ai-service/client.js";
import { hash, transaction } from "../definitions/storage.js";
import type { Draft, DefinitionRepository } from "../definitions/repository.js";
export type Snapshot = {
  id: string;
  schemaVersion: 1;
  capturedAt: string;
  contentHash: string;
  sources: {
    workId: string;
    key: string;
    title: string;
    status: string;
    events: {
      id: string;
      key: string;
      sequence: number;
      kind: string;
      content: string;
      hash: string;
    }[];
    files: {
      id: string;
      name: string;
      path: string;
      hash: string;
      content?: string;
    }[];
    deleted?: boolean;
  }[];
};
export type Job = {
  id: string;
  snapshotId: string;
  status:
    | "PREPARED"
    | "SUBMITTED"
    | "RUNNING"
    | "AWAITING_REVIEW"
    | "SAVED"
    | "NEEDS_SELECTION"
    | "FAILED"
    | "INTERRUPTED"
    | "CANCELLED";
  attempt: number;
  commandId: string;
  requestId?: string;
  draftId?: string;
  error?: string;
  ackPending?: boolean;
  cancelPending?: boolean;
  result?: ExtractionResult;
  createdAt: string;
};
const terminal = new Set([
  "SAVED",
  "FAILED",
  "INTERRUPTED",
  "CANCELLED",
  "AWAITING_REVIEW",
  "NEEDS_SELECTION",
]);
export class DistillationService {
  readonly repository: DefinitionRepository;
  readonly improvement: ImprovementCollector;
  readonly active = new Set<string>();
  closed = false;
  close(): void {
    this.closed = true;
    this.improvement.closed = true;
  }
  async tick(): Promise<void> {
    this.collectFeedback();
    void this.improvement.flush();
    for (const job of this.repository.list<Job>("distillation_jobs")) {
      if (this.closed) return;
      if (!terminal.has(job.status) || job.ackPending || job.cancelPending)
        await this.get(job.id).catch(() => {});
    }
  }
  constructor(
    readonly core: WorkCore,
    readonly client: AIClient,
  ) {
    this.repository = core.definitions;
    this.improvement = new ImprovementCollector(this.repository.db, client);
  }
  collectFeedback(): void {
    for (const subscription of this.improvement.active()) {
      if (subscription.scope === "REUSE") {
        for (const row of this.repository.db.prepare("SELECT id,payload_json FROM review_events WHERE owner_id=? ORDER BY rowid").all(subscription.id)) {
          const review = JSON.parse(row.payload_json as string);
          if (review.type === "ACCEPTANCE") this.improvement.record(subscription.id, `accept-${row.id}`, "ACCEPTANCE", {
            criteriaResults: review.criteriaResults, artifactIds: review.artifactIds,
            artifactContentsCollected: false, userConfirmed: true, at: review.at,
          });
        }
        continue;
      }
      // Replay durable domain reviews, including edits made just before an app restart.
      const row = this.repository.db.prepare("SELECT payload_json FROM distillation_jobs WHERE id=?").get(subscription.id);
      if (!row) { this.improvement.stop(subscription.id); continue; }
      const job = JSON.parse(row.payload_json as string) as Job;
      const errorCode = job.error?.match(/^[A-Z][A-Z0-9_]+(?=:|$)/)?.[0] ?? null;
      this.improvement.record(job.id, `status-${job.status}-${errorCode}`, "STATUS", { status: job.status, attempt: job.attempt, requestId: job.requestId ?? null, errorCode });
      if (job.result) this.improvement.record(job.id, "result", "STATUS", { result: job.result });
      if (job.draftId) {
        const draftRow = this.repository.db.prepare("SELECT payload_json FROM definition_drafts WHERE id=?").get(job.draftId);
        if (!draftRow) { this.improvement.stop(job.id); continue; }
        const draft = JSON.parse(draftRow.payload_json as string) as Draft;
        this.improvement.record(job.id, "candidate", "CANDIDATE", { content: draft.originalContent, issues: draft.issues, refs: draft.refs });
        for (const reviewRow of this.repository.db.prepare("SELECT id,payload_json FROM review_events WHERE owner_id=? ORDER BY rowid").all(draft.id)) {
          const review = JSON.parse(reviewRow.payload_json as string);
          if (review.after) this.improvement.record(job.id, `edit-${reviewRow.id}`, "EDIT", { content: review.after, before: review.before, resolutions: review.resolutions, at: review.at });
        }
        if (draft.publishedId) {
          const definition = this.repository.get(draft.publishedId);
          this.improvement.record(job.id, `publish-${definition.id}`, "PUBLISH", { definitionId: definition.id, version: definition.version, content: definition.content, confirmedAt: definition.confirmedAt });
        }
      }
    }
  }
  prepare(input: { workIds: string[]; includedFileIds: string[] }): Snapshot {
    array(input.workIds);
    array(input.includedFileIds);
    input.workIds.forEach(string);
    input.includedFileIds.forEach(string);
    ensure(
      input.workIds.length > 0 &&
        input.workIds.length <= LIMITS.maxSources &&
        new Set(input.workIds).size === input.workIds.length,
      "INVALID_INPUT",
    );
    const chosen = new Set(input.includedFileIds),
      found = new Set<string>();
    const sources = input.workIds.map((id, index) => {
      const work = this.core.getWork(id);
      ensure(work, "SOURCE_DELETED");
      const events = work.sourceArchive
        .filter((e) => e.kind !== "reasoning.summary" && e.content?.trim())
        .map((e, i) => ({
          id: e.id,
          key: `event-${i + 1}`,
          sequence: e.sequence,
          kind: e.kind,
          content: e.content!,
          hash: hash(e.content!),
        }));
      ensure(
        events.length,
        "MISSING_INFORMATION",
        "空工作没有可提交的来源事件",
      );
      const files = work.artifactRefs.map((a) => {
        if (!chosen.has(a.id))
          return { id: a.id, name: a.filename, path: a.path, hash: a.sha256 };
        found.add(a.id);
        ensure(
          [
            ".txt",
            ".md",
            ".csv",
            ".json",
            ".ts",
            ".js",
            ".py",
            ".html",
            ".css",
            ".xml",
            ".yaml",
            ".yml",
            ".log",
          ].includes(extname(a.path).toLowerCase()),
          "UNSUPPORTED_FILE",
          "首版仅分析 UTF-8 文本文件",
        );
        const bytes = this.repository.materials.read(a.path, LIMITS.maxBytes);
        ensure(hash(bytes) === a.sha256, "SOURCE_CHANGED");
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Error("UNSUPPORTED_FILE: 文件不是 UTF-8 文本");
        }
        return {
          id: a.id,
          name: basename(a.path),
          path: a.path,
          hash: hash(bytes),
          content,
        };
      });
      return {
        workId: id,
        key: `work-${index + 1}`,
        title: work.state.objective[0]?.text ?? work.definition.name,
        status: work.instance.status,
        events,
        files,
      };
    });
    ensure(
      [...chosen].every((id) => found.has(id)),
      "INVALID_INPUT",
    );
    const snapshot: Snapshot = {
      id: randomUUID(),
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      contentHash: hash(sources),
      sources,
    };
    validateRequest(this.wire(snapshot));
    transaction(this.repository.db, () =>
      this.repository.db
        .prepare("INSERT INTO source_snapshots VALUES (?,?)")
        .run(snapshot.id, JSON.stringify(snapshot)),
    );
    return snapshot;
  }
  wire(snapshot: Snapshot): ExtractionRequest {
    return {
      schemaVersion: 1,
      snapshotHash: snapshot.contentHash,
      sources: snapshot.sources.map((s) => ({
        key: s.key,
        events: [
          ...s.events.map((e) => ({
            key: e.key,
            sequence: e.sequence,
            kind: e.kind,
            content: e.content,
            hash: e.hash,
          })),
          ...s.files.map((f, i) => ({
            key: `file-${i + 1}`,
            sequence: Math.max(0, ...s.events.map((e) => e.sequence)) + i + 1,
            kind: f.content !== undefined ? "file.content" : "file.metadata",
            content:
              f.content !== undefined
                ? f.content
                : JSON.stringify({
                    type: extname(f.name),
                    contentAnalyzed: false,
                  }),
            hash: f.hash,
          })),
        ],
      })),
    };
  }
  refs(snapshot: Snapshot): SourceRef[] {
    return snapshot.sources.flatMap((s) => [
      ...s.events.map((e) => ({
        snapshotId: snapshot.id,
        workId: s.workId,
        eventId: e.id,
      })),
      ...s.files.map((f) => ({
        snapshotId: snapshot.id,
        workId: s.workId,
        eventId: f.id,
      })),
    ]);
  }
  assertSources(snapshot: Snapshot, unchanged: boolean): void {
    for (const source of snapshot.sources) {
      const work = this.core.getWork(source.workId);
      ensure(work && !source.deleted, "SOURCE_DELETED");
      if (unchanged) {
        const events = work.sourceArchive.filter((e) => e.kind !== "reasoning.summary" && e.content?.trim());
        ensure(
          events.length === source.events.length &&
            events.every(
              (e, i) =>
                e.id === source.events[i]?.id &&
                hash(e.content!) === source.events[i]?.hash,
            ),
          "SOURCE_CHANGED",
        );
        for (const file of source.files.filter((f) => f.content !== undefined))
          ensure(
            hash(this.repository.materials.read(file.path, LIMITS.maxBytes)) ===
              file.hash,
            "SOURCE_CHANGED",
          );
      }
    }
  }
  start(input: {
    preparationId: string;
    expectedContentHash: string;
    consentVersion: string;
    commandId: string;
  }): Job {
    ensure(input.consentVersion === "worket-data-v1", "CONSENT_REQUIRED");
    const id = this.repository.command(
      input.commandId,
      { op: "start", ...input },
      input.preparationId,
      () => {
        const snapshot = this.repository.read<Snapshot>(
          "source_snapshots",
          input.preparationId,
        );
        ensure(
          input.expectedContentHash === snapshot.contentHash,
          "SOURCE_CHANGED",
        );
        this.assertSources(snapshot, true);
        const job: Job = {
          id: randomUUID(),
          snapshotId: snapshot.id,
          status: "PREPARED",
          attempt: 1,
          commandId: input.commandId,
          createdAt: new Date().toISOString(),
        };
        this.repository.db
          .prepare("INSERT INTO distillation_jobs VALUES (?,?,?)")
          .run(job.id, job.snapshotId, JSON.stringify(job));
        return job.id;
      },
    );
    const job = this.repository.read<Job>("distillation_jobs", id);
    if (job.status === "PREPARED") void this.submit(job);
    return job;
  }
  async submit(job: Job): Promise<void> {
    if (this.active.has(job.id)) return;
    this.active.add(job.id);
    try {
      const snapshot = this.repository.read<Snapshot>(
        "source_snapshots",
        job.snapshotId,
      );
      this.assertSources(snapshot, false);
      job.status = "SUBMITTED";
      this.repository.write("distillation_jobs", job);
      const capability = (await this.client.capabilities()) as {
        limits?: { maxSources?: number; maxBytes?: number };
      };
      if (this.closed || this.repository.read<Job>("distillation_jobs", job.id).status === "CANCELLED") return;
      const wire = this.wire(snapshot);
      ensure(
        snapshot.sources.length <=
          (capability.limits?.maxSources ?? LIMITS.maxSources) &&
          Buffer.byteLength(JSON.stringify(wire)) <=
            (capability.limits?.maxBytes ?? LIMITS.maxBytes),
        "INPUT_TOO_LARGE",
      );
      const remote = await this.client.submit(
        this.wire(snapshot),
        job.commandId,
      );
      if (this.closed) return;
      const current = this.repository.read<Job>("distillation_jobs", job.id);
      current.requestId = remote.requestId;
      this.repository.write("distillation_jobs", current);
      if (current.status === "CANCELLED") {
        await this.client.cancel(remote.requestId);
        return;
      }
      current.status = "RUNNING";
      this.repository.write("distillation_jobs", current);
      await this.receive(current, remote);
    } catch (error) {
      if (this.closed) return;
      const current = this.repository.read<Job>("distillation_jobs", job.id);
      if (current.status !== "CANCELLED" && current.status !== "SAVED") {
        current.status = current.requestId ? "FAILED" : "INTERRUPTED";
        current.error =
          error instanceof Error ? error.message : "MODEL_UNAVAILABLE";
        this.repository.write("distillation_jobs", current);
      }
    } finally {
      this.active.delete(job.id);
    }
  }
  async get(id: string): Promise<Job> {
    let job = this.repository.read<Job>("distillation_jobs", id);
    if (job.cancelPending && job.requestId) {
      try {
        await this.client.cancel(job.requestId);
        if (this.closed) return job;
        job = this.repository.read<Job>("distillation_jobs", id);
        job.cancelPending = false;
        job.ackPending = false;
        this.repository.write("distillation_jobs", job);
      } catch {}
      return job;
    }
    if (job.ackPending && job.requestId) {
      try {
        await this.client.ack(job.requestId);
        if (this.closed) return job;
        job.ackPending = false;
        this.repository.write("distillation_jobs", job);
      } catch {}
      return job;
    }
    if (job.status === "SUBMITTED" && !job.requestId && !this.active.has(id)) {
      job.status = "INTERRUPTED";
      job.error = "DISPATCH_UNCONFIRMED: 服务可能已接受请求；不自动再次提交";
      this.repository.write("distillation_jobs", job);
    }
    if (job.requestId && !terminal.has(job.status) && !this.active.has(id)) {
      this.active.add(id);
      try {
        await this.receive(job, await this.client.get(job.requestId));
      } catch (error) {
        if (this.closed) return job;
        job = this.repository.read<Job>("distillation_jobs", id);
        job.error =
          error instanceof Error ? error.message : "MODEL_UNAVAILABLE";
        if (
          error instanceof Error &&
          "code" in error &&
          [
            "INVALID_MODEL_OUTPUT",
            "INVALID_SOURCE_REF",
            "INCOMPLETE_COVERAGE",
            "SOURCE_DELETED",
          ].includes(String(error.code))
        )
          job.status = "FAILED";
        this.repository.write("distillation_jobs", job);
      } finally {
        this.active.delete(id);
      }
    }
    return this.repository.read<Job>("distillation_jobs", id);
  }
  async receive(job: Job, remote: RemoteJob): Promise<void> {
    if (this.closed) return;
    const current = this.repository.read<Job>("distillation_jobs", job.id);
    if (terminal.has(current.status)) return;
    const snapshot = this.repository.read<Snapshot>(
      "source_snapshots",
      job.snapshotId,
    );
    this.assertSources(snapshot, false);
    if (remote.status === "SUCCEEDED") {
      const request = this.wire(snapshot);
      validateResult(remote.result, request);
      const result = structuredClone(remote.result);
      // Map only verified request-local references back to local identities.
      for (const item of result.content
        ? [
            result.content.purpose,
            ...result.content.inputs,
            ...result.content.deliverables,
            ...result.content.constraints,
            ...result.content.acceptanceCriteria,
            ...result.content.methods,
            ...result.content.materialRoles,
          ]
        : []) {
        if (item.basis.type === "USER_AUTHORED")
          throw new Error("INVALID_MODEL_OUTPUT");
        item.basis.refs = item.basis.refs.map((ref) => {
          const s = snapshot.sources.find((s) => s.key === ref.workId);
          ensure(s, "INVALID_SOURCE_REF");
          const e = s.events.find((e) => e.key === ref.eventId);
          const f = ref.eventId.startsWith("file-")
            ? s.files[Number(ref.eventId.slice(5)) - 1]
            : undefined;
          ensure(e || f, "INVALID_SOURCE_REF");
          if (ref.excerpt)
            ensure(
              (e?.content ?? f?.content ?? "").includes(ref.excerpt),
              "INVALID_SOURCE_REF",
            );
          if (
            item.basis.type === "SOURCE" &&
            item.basis.origin === "USER_STATED"
          )
            ensure(
              e?.kind === "user.prompt" || e?.kind.startsWith("work."),
              "INVALID_SOURCE_REF",
            );
          return {
            snapshotId: snapshot.id,
            workId: s.workId,
            eventId: e?.id ?? f!.id,
            ...(ref.excerpt ? { excerpt: ref.excerpt } : {}),
          };
        });
      }
      transaction(this.repository.db, () => {
        const fresh = this.repository.read<Job>("distillation_jobs", job.id);
        ensure(!terminal.has(fresh.status), "JOB_CANCELLED");
        this.assertSources(snapshot, false);
        if (result.compatibility === "UNRELATED") {
          fresh.status = "NEEDS_SELECTION";
          fresh.result = result;
        } else {
          const draft: Draft = {
            id: randomUUID(),
            jobId: job.id,
            revision: 1,
            content: result.content!,
            originalContent: structuredClone(result.content!),
            refs: this.refs(snapshot),
            issues: result.issues,
            resolutions: [],
          };
          for (const method of draft.content.methods)
            if (
              method.obligation === "REQUIRED" &&
              (method.basis.type !== "SOURCE" ||
                method.basis.origin !== "USER_STATED")
            )
              draft.issues.push({
                id: randomUUID(),
                type: "UNSUPPORTED_SOURCE",
                field: method.key,
                message: "此强制步骤缺少明确用户来源，请改为参考或明确保留。",
                blocking: true,
              });
          this.repository.saveDraft(draft);
          fresh.draftId = draft.id;
          fresh.status = "AWAITING_REVIEW";
          fresh.result = { ...result, content: null };
        }
        fresh.ackPending = true;
        delete fresh.error;
        this.repository.write("distillation_jobs", fresh);
      });
      try {
        await this.client.ack(remote.requestId);
        if (this.closed) return;
        const fresh = this.repository.read<Job>("distillation_jobs", job.id);
        fresh.ackPending = false;
        this.repository.write("distillation_jobs", fresh);
      } catch {}
    } else if (
      [
        "FAILED",
        "INTERRUPTED",
        "EXPIRED",
        "CANCELLED",
        "ACKNOWLEDGED",
      ].includes(remote.status)
    ) {
      current.status = "FAILED";
      current.error = remote.error?.code ?? "RESULT_EXPIRED";
      this.repository.write("distillation_jobs", current);
    }
  }
  async cancel(id: string): Promise<Job> {
    const job = transaction(this.repository.db, () => {
      const job = this.repository.read<Job>("distillation_jobs", id);
      if (job.status === "SAVED") return job;
      job.status = "CANCELLED";
      job.cancelPending = true;
      if (job.draftId) {
        const draft = this.repository.read<Draft>(
          "definition_drafts",
          job.draftId,
        );
        draft.invalidated = true;
        this.repository.write("definition_drafts", draft);
      }
      this.repository.write("distillation_jobs", job);
      return job;
    });
    if (job.status === "CANCELLED" && job.requestId)
      try {
        await this.client.cancel(job.requestId);
      } catch {}
    return job;
  }
  retry(input: {
    jobId: string;
    expectedContentHash: string;
    commandId: string;
  }): Job {
    const id = this.repository.command(
      input.commandId,
      { op: "retry", ...input },
      input.jobId,
      () => {
        const old = this.repository.read<Job>("distillation_jobs", input.jobId);
        ensure(["FAILED", "INTERRUPTED"].includes(old.status), "INVALID_STATE");
        const snapshot = this.repository.read<Snapshot>(
          "source_snapshots",
          old.snapshotId,
        );
        ensure(
          snapshot.contentHash === input.expectedContentHash,
          "SOURCE_CHANGED",
        );
        this.assertSources(snapshot, false);
        const job: Job = {
          id: randomUUID(),
          snapshotId: old.snapshotId,
          status: "PREPARED",
          attempt: old.attempt + 1,
          commandId: input.commandId,
          createdAt: new Date().toISOString(),
        };
        this.repository.db
          .prepare("INSERT INTO distillation_jobs VALUES (?,?,?)")
          .run(job.id, job.snapshotId, JSON.stringify(job));
        return job.id;
      },
    );
    const job = this.repository.read<Job>("distillation_jobs", id);
    if (job.status === "PREPARED") void this.submit(job);
    return job;
  }
}
