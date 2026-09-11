import { IMPROVEMENT_POLICY } from "../contracts/improvement.js";
import { randomUUID } from "node:crypto";
import type { WorkCore } from "../core/index.js";
import type { ImprovementCollector } from "./collector.js";

// Enrollment happens only at an explicit recording action, never by scanning old works.
export class RecordingCollection {
  constructor(readonly core: WorkCore, readonly collector: ImprovementCollector) {
    collector.db.exec(`CREATE TABLE IF NOT EXISTS recording_samples (
      sample_id TEXT PRIMARY KEY, work_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS recording_samples_work ON recording_samples(work_id);
      CREATE TABLE IF NOT EXISTS recording_notice (
        id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL);`);
  }
  noticeRequired(): boolean {
    return this.collector.enabled() && this.collector.db.prepare("SELECT version FROM recording_notice WHERE id=1").get()?.version !== IMPROVEMENT_POLICY.recordingVersion;
  }
  start(workId: string): void {
    if (!this.collector.enabled()) return;
    const work = this.core.getWork(workId);
    if (!work || work.instance.status !== "OPEN" || !work.activeBinding) return;
    const existing = this.collector.db.prepare(`SELECT 1 FROM recording_samples r
      JOIN improvement_subscriptions s ON s.id=r.sample_id
      WHERE r.work_id=? AND s.state='ACTIVE'`).get(workId);
    if (existing) return;
    const id = randomUUID();
    const title = work.sourceArchive.find(e => e.kind === "conversation.title")?.content?.slice(0, 200) || "工作对话";
    // A crash before enrollment leaves only an inert ID mapping, never an unscoped upload.
    this.collector.db.prepare("INSERT INTO recording_samples VALUES (?,?)").run(id, workId);
    this.collector.enroll(id, "RECORDING", title, { workId, title });
    // Only a successful explicit recording action acknowledges the visible notice.
    // Browsing, cancellation, opt-out and application startup never dismiss it.
    this.collector.db.prepare("INSERT INTO recording_notice VALUES (1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version")
      .run(IMPROVEMENT_POLICY.recordingVersion);
    this.collect();
  }
  stop(workId: string): void {
    for (const row of this.collector.db.prepare("SELECT sample_id FROM recording_samples WHERE work_id=?").all(workId)) {
      this.collector.stop(String(row.sample_id));
    }
  }
  collect(): void {
    const rows = this.collector.db.prepare(`SELECT r.sample_id,r.work_id FROM recording_samples r
      JOIN improvement_subscriptions s ON s.id=r.sample_id WHERE s.state='ACTIVE'`).all();
    for (const row of rows) {
      const id = String(row.sample_id), work = this.core.getWork(String(row.work_id));
      if (!work || work.instance.status !== "OPEN" || !work.activeBinding) {
        this.collector.stop(id);
        continue;
      }
      for (const event of work.sourceArchive) {
        if (!["user.prompt", "agent.response"].includes(event.kind) || !event.content?.trim()) continue;
        // Split long messages without truncating text; identifiers keep replay idempotent.
        const parts = Math.ceil(event.content.length / 16000);
        for (let part = 0; part < parts; part++) {
          this.collector.record(id, `${event.id}-${part}`, "MESSAGE", {
            sourceEventId: event.id, sequence: event.sequence, kind: event.kind,
            timestamp: event.timestamp, content: event.content.slice(part * 16000, (part + 1) * 16000),
            part, parts,
          });
        }
      }
    }
  }
}
