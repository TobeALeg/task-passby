import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { statSync } from "node:fs";
import type { AppService } from "../app/app-service.js";
import { ensure, object, string } from "../contracts/definition.js";
import {
  buildWorkPackage,
  packageMarkdown,
} from "../definitions/work-package.js";
import { hash } from "../definitions/storage.js";
import type { AIClient } from "../ai-service/client.js";
import { DistillationService } from "./service.js";
export class DistillationDesktop {
  readonly service: DistillationService;
  constructor(
    readonly app: AppService,
    readonly client: AIClient,
  ) {
    this.service = new DistillationService(app.core(), client);
  }
  async call(action: string, input: unknown = {}): Promise<unknown> {
    string(action);
    object(input);
    const r = this.service.repository,
      core = this.app.core();
    // Every command validates in the application/domain layer, including renderer-supplied data.
    switch (action) {
      case "evidence": {
        string(input.snapshotId);
        string(input.workId);
        string(input.eventId);
        const snapshot = r.read<import("./service.js").Snapshot>(
          "source_snapshots",
          input.snapshotId,
        );
        const source = snapshot.sources.find((s) => s.workId === input.workId);
        ensure(source && !source.deleted, "SOURCE_DELETED");
        const event = source.events.find((e) => e.id === input.eventId);
        const file = source.files.find((f) => f.id === input.eventId);
        ensure(event || file, "INVALID_SOURCE_REF");
        return (
          event?.content ?? file?.content ?? "仅引用文件元数据，未分析内容"
        );
      }
      case "capabilities":
        return this.client.capabilities();
      case "prepare":
        return this.service.prepare(
          input as Parameters<DistillationService["prepare"]>[0],
        );
      case "improvementSamples":
        return this.service.improvement.list();
      case "recordingNotice":
        return { required: this.service.recordings.noticeRequired() };
      case "improvementPreference":
        return { enabled: this.service.improvement.enabled() };
      case "setImprovementPreference":
        ensure(typeof input.enabled === "boolean", "INVALID_INPUT");
        this.service.improvement.setEnabled(input.enabled as boolean);
        return { enabled: this.service.improvement.enabled() };
      case "stopImprovement":
        if (input.id !== undefined) string(input.id);
        this.service.improvement.stop(input.id as string | undefined);
        return this.service.improvement.list();
      case "deleteImprovement":
        string(input.id);
        ensure(input.confirmation === "删除样本", "CONFIRMATION_REQUIRED");
        this.service.improvement.remove(input.id);
        void this.service.improvement.flush();
        return this.service.improvement.list();
      case "syncImprovement":
        this.service.collectFeedback();
        await this.service.improvement.flush();
        return this.service.improvement.list();
      case "start": {
        await this.service.improvement.authorize(
          input.improvementConsentVersion,
        );
        const job = this.service.start(
          input as Parameters<DistillationService["start"]>[0],
        );
        if (input.improvementConsentVersion) {
          const snapshot = r.read<import("./service.js").Snapshot>(
            "source_snapshots",
            job.snapshotId,
          );
          this.service.improvement.enroll(
            job.id,
            "DISTILLATION",
            snapshot.sources.map((s) => s.title).join(" / "),
            {
              request: this.service.wire(snapshot),
              appVersion: "0.1.0",
              collectorVersion: 1,
              sourceRefs: snapshot.sources.map((s) => ({
                key: s.key,
                workId: s.workId,
                events: s.events.map((e) => ({
                  key: e.key,
                  id: e.id,
                  hash: e.hash,
                })),
                files: s.files.map((f, i) => ({
                  key: `file-${i + 1}`,
                  id: f.id,
                  hash: f.hash,
                })),
              })),
            },
          );
        }
        return job;
      }
      case "job":
        string(input.jobId);
        return this.service.get(input.jobId);
      case "jobs":
        return r.list("distillation_jobs");
      case "snapshot":
        string(input.id);
        return r.read("source_snapshots", input.id);
      case "cancel":
        string(input.jobId);
        return this.service.cancel(input.jobId);
      case "retry":
        return this.service.retry(
          input as Parameters<DistillationService["retry"]>[0],
        );
      case "draft":
        string(input.id);
        return r.read("definition_drafts", input.id);
      case "update": {
        this.service.collectFeedback();
        const draft = r.update(input as Parameters<typeof r.update>[0]);
        this.service.collectFeedback();
        return draft;
      }
      case "publish": {
        this.service.collectFeedback();
        const definition = r.publish(input as Parameters<typeof r.publish>[0]);
        this.service.collectFeedback();
        return definition;
      }
      case "definitions":
        return r.definitions(input);
      case "definition":
        string(input.id);
        return r.get(input.id);
      case "examples": {
        string(input.definitionId);
        const d = r.get(input.definitionId);
        return [...new Set(d.refs.map((ref) => ref.workId))].flatMap(
          (id) => core.getWork(id)?.artifactRefs ?? [],
        );
      }
      case "versions":
        string(input.key);
        return r.versions(input.key);
      case "revise":
        return r.revise(input as Parameters<typeof r.revise>[0]);
      case "deleteDefinition":
        return r.delete(input as Parameters<typeof r.delete>[0]);
      case "create": {
        await this.service.improvement.authorize(
          input.improvementConsentVersion,
        );
        const work = core.createWorkFromDefinition(
          input as Parameters<typeof core.createWorkFromDefinition>[0],
        );
        if (input.improvementConsentVersion) {
          const definition = r.get(input.definitionId as string);
          const inputs = Object.fromEntries(
            Object.entries(input.inputs as Record<string, unknown>).map(
              ([key, value]) => [
                key,
                definition.content.inputs.find((i) => i.key === key)
                  ?.valueType === "FILE"
                  ? { fileSelected: true, contentCollected: false }
                  : value,
              ],
            ),
          );
          this.service.improvement.enroll(
            work.instance.id,
            "REUSE",
            definition.content.name,
            {
              definitionId: definition.id,
              definitionVersion: definition.version,
              content: definition.content,
              inputs,
              appVersion: "0.1.0",
              collectorVersion: 1,
            },
          );
        }
        return this.app.dashboard(work.instance.id);
      }
      case "package": {
        string(input.workId);
        const work = core.getWork(input.workId);
        ensure(work, "WORK_NOT_FOUND");
        const json = buildWorkPackage(work, r);
        return { json, markdown: packageMarkdown(json) };
      }
      case "artifacts": {
        string(input.workId);
        const work = core.getWork(input.workId);
        ensure(work, "WORK_NOT_FOUND");
        return work.artifactRefs;
      }
      case "attach": {
        string(input.workId);
        string(input.path);
        const bytes = r.materials.read(input.path),
          stat = statSync(input.path);
        return core.addArtifactRef(input.workId, {
          path: input.path,
          filename: basename(input.path),
          role: "DELIVERABLE",
          mimeType: null,
          size: bytes.length,
          sha256: hash(bytes),
          lastModifiedAt: stat.mtime.toISOString(),
          availability: "AVAILABLE",
        }).artifactRefs;
      }
      case "accept":
        r.accept(input as Parameters<typeof r.accept>[0]);
        this.service.collectFeedback();
        return this.app.dashboard(input.workId as string);
      case "dispatch":
        return this.dispatch(
          input as { workId: string; commandId: string; executorId: string },
        );
      default:
        throw new Error("UNKNOWN_COMMAND");
    }
  }
  async dispatch(input: {
    workId: string;
    commandId: string;
    executorId: string;
  }): Promise<unknown> {
    string(input.workId);
    string(input.commandId);
    string(input.executorId);
    const core = this.app.core(),
      r = core.definitions,
      work = core.getWork(input.workId);
    ensure(work?.instance.status === "OPEN", "WORK_NOT_OPEN");
    r.command(
      input.commandId,
      { op: "dispatch", ...input },
      input.workId,
      () => {
        ensure(
          !work.activeBinding,
          "DISPATCH_UNCONFIRMED",
          "已有执行绑定，请在当前对话继续",
        );
        const old = r.db
          .prepare("SELECT * FROM pending_dispatches WHERE work_id=?")
          .get(input.workId);
        ensure(
          !old || old.status === "FAILED",
          "DISPATCH_UNCONFIRMED",
          "上次启动尚未确认，请先检查目标执行者",
        );
        r.db
          .prepare(
            "INSERT INTO pending_dispatches VALUES (?,?,'STARTING',NULL) ON CONFLICT(work_id) DO UPDATE SET command_id=excluded.command_id,status='STARTING',read_at=NULL",
          )
          .run(input.workId, input.commandId);
        return { id: randomUUID() };
      },
    );
    const current = r.db
      .prepare("SELECT * FROM pending_dispatches WHERE work_id=?")
      .get(input.workId);
    if (
      current?.status !== "STARTING" ||
      current.command_id !== input.commandId
    )
      return this.app.dashboard(input.workId);
    // Persist a launch claim before awaiting the external application; repeated commands cannot relaunch.
    r.db
      .prepare("UPDATE pending_dispatches SET status='WAITING' WHERE work_id=?")
      .run(input.workId);
    try {
      await this.app.handoff(input.workId, input.executorId);
    } catch (error) {
      r.db
        .prepare(
          "UPDATE pending_dispatches SET status='FAILED' WHERE work_id=? AND status='WAITING'",
        )
        .run(input.workId);
      throw error;
    }
    return this.app.dashboard(input.workId);
  }
}
