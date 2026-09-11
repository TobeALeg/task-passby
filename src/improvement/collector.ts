import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AIClient } from "../ai-service/client.js";
import { ensure } from "../contracts/definition.js";
import { IMPROVEMENT_POLICY, validateSample, type SampleEvent, type SampleUpload } from "../contracts/improvement.js";
import { transaction } from "../definitions/storage.js";

type Subscription = {
  id: string;
  scope: string;
  label: string;
  consent: string;
  destination: string;
  state: string;
  error: string | null;
};
// Only explicitly enrolled work enters this outbox. It never scans historical work.
export class ImprovementCollector {
  busy = false;
  closed = false;
  constructor(readonly db: DatabaseSync, readonly client: AIClient) {
    db.exec(`PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS improvement_subscriptions (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, label TEXT NOT NULL, consent TEXT NOT NULL,
      destination TEXT NOT NULL, state TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS improvement_outbox (
      sample_id TEXT NOT NULL, event_key TEXT NOT NULL, payload TEXT, PRIMARY KEY(sample_id,event_key));
      CREATE TABLE IF NOT EXISTS improvement_preferences (
      id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));`);
  }
  enabled(): boolean {
    return this.db.prepare("SELECT enabled FROM improvement_preferences WHERE id=1").get()?.enabled !== 0;
  }
  setEnabled(enabled: boolean): void {
    ensure(typeof enabled === "boolean", "INVALID_INPUT");
    if (!enabled) { this.stop(); return; }
    this.db.prepare("INSERT INTO improvement_preferences VALUES (1,1) ON CONFLICT(id) DO UPDATE SET enabled=1").run();
  }
  async authorize(version: unknown): Promise<void> {
    if (version === undefined) return;
    ensure(this.enabled(), "COLLECTION_DISABLED", "参与改进已关闭，请先开启后再提交");
    ensure(version === IMPROVEMENT_POLICY.version, "CONSENT_REQUIRED");
    ensure(this.client.improvementIdentity && this.client.uploadSample && this.client.deleteSample, "COLLECTION_UNAVAILABLE");
    const c = await this.client.capabilities() as { improvement?: { version: string; enabled: boolean; retentionDays: number } };
    ensure(c.improvement?.enabled && c.improvement.version === version && c.improvement.retentionDays === IMPROVEMENT_POLICY.retentionDays, "COLLECTION_UNAVAILABLE", "后台当前不接收此版本的改进样本");
  }
  enroll(id: string, scope: SampleUpload["consent"]["scope"], label: string, data: Record<string, unknown>): void {
    ensure(this.enabled(), "COLLECTION_DISABLED");
    if (this.db.prepare("SELECT id FROM improvement_subscriptions WHERE id=?").get(id)) return;
    const consent = { version: scope === "RECORDING" ? IMPROVEMENT_POLICY.recordingVersion : IMPROVEMENT_POLICY.version, at: new Date().toISOString(), scope };
    transaction(this.db, () => {
      this.db.prepare("INSERT INTO improvement_subscriptions VALUES (?,?,?,?,?,'ACTIVE',NULL)")
        .run(id, scope, label, JSON.stringify(consent), this.client.improvementIdentity!());
      this.record(id, "source", scope === "RECORDING" ? "RECORDING" : scope === "DISTILLATION" ? "SOURCE" : "REUSE", data);
    });
  }
  active(): Subscription[] {
    return this.db.prepare("SELECT * FROM improvement_subscriptions WHERE state='ACTIVE'").all() as unknown as Subscription[];
  }
  list() {
    return this.db.prepare("SELECT id,scope,label,state,error,consent,(SELECT COUNT(*) FROM improvement_outbox WHERE sample_id=improvement_subscriptions.id AND payload IS NOT NULL) AS pending FROM improvement_subscriptions ORDER BY rowid DESC").all();
  }
  record(id: string, key: string, kind: SampleEvent["kind"], data: Record<string, unknown>): void {
    const s = this.db.prepare("SELECT * FROM improvement_subscriptions WHERE id=? AND state='ACTIVE'").get(id) as Subscription | undefined;
    if (!s || this.db.prepare("SELECT event_key FROM improvement_outbox WHERE sample_id=? AND event_key=?").get(id, key)) return;
    if (Date.parse(JSON.parse(s.consent).at) + IMPROVEMENT_POLICY.retentionDays * 86400000 <= Date.now()) { this.stop(id); return; }
    const event = { id: randomUUID(), kind, at: new Date().toISOString(), data };
    const upload: SampleUpload = { schemaVersion: 1, sampleId: id, consent: JSON.parse(s.consent), event };
    try { validateSample(upload); }
    catch (error) {
      // Collection limits must not make a valid local edit or publication fail.
      this.stop(id);
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "COLLECTION_INVALID";
      this.db.prepare("UPDATE improvement_subscriptions SET error=? WHERE id=?").run(code, id);
      return;
    }
    this.db.prepare("INSERT INTO improvement_outbox VALUES (?,?,?)").run(id, key, JSON.stringify(upload));
  }
  stop(id?: string): void {
    transaction(this.db, () => {
      if (id) {
        this.db.prepare("UPDATE improvement_subscriptions SET state='STOPPED',error=NULL WHERE id=? AND state='ACTIVE'").run(id);
        this.db.prepare("UPDATE improvement_outbox SET payload=NULL WHERE sample_id=?").run(id);
      } else {
        this.db.prepare("INSERT INTO improvement_preferences VALUES (1,0) ON CONFLICT(id) DO UPDATE SET enabled=0").run();
        this.db.prepare("UPDATE improvement_subscriptions SET state='STOPPED',error=NULL WHERE state='ACTIVE'").run();
        this.db.prepare("UPDATE improvement_outbox SET payload=NULL").run();
      }
    });
  }
  remove(id: string): void {
    this.stop(id);
    this.db.prepare("UPDATE improvement_subscriptions SET state='DELETE_PENDING' WHERE id=? AND state!='DELETED'").run(id);
  }
  async flush(): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      const rows = this.db.prepare("SELECT * FROM improvement_subscriptions WHERE state IN ('ACTIVE','DELETE_PENDING')").all() as unknown as Subscription[];
      for (const s of rows) {
        if (this.closed) return;
        try {
          ensure(this.client.improvementIdentity?.() === s.destination, "SERVICE_CHANGED", "请连接授权时使用的服务和凭据后同步");
          if (s.state === "DELETE_PENDING") {
            await this.client.deleteSample!(s.id);
            if (this.closed) return;
            this.db.prepare("UPDATE improvement_subscriptions SET state='DELETED',label='已删除样本',error=NULL WHERE id=?").run(s.id);
            this.db.prepare("DELETE FROM improvement_outbox WHERE sample_id=?").run(s.id);
            continue;
          }
          const queue = this.db.prepare("SELECT event_key,payload FROM improvement_outbox WHERE sample_id=? AND payload IS NOT NULL ORDER BY rowid LIMIT 20").all(s.id);
          for (const row of queue) {
            if (this.closed || this.db.prepare("SELECT state FROM improvement_subscriptions WHERE id=?").get(s.id)?.state !== "ACTIVE") break;
            ensure(this.client.improvementIdentity?.() === s.destination, "SERVICE_CHANGED");
            await this.client.uploadSample!(JSON.parse(row.payload as string));
            if (this.closed) return;
            this.db.prepare("UPDATE improvement_outbox SET payload=NULL WHERE sample_id=? AND event_key=?").run(s.id, row.event_key as string);
          }
          if (!this.closed) this.db.prepare("UPDATE improvement_subscriptions SET error=NULL WHERE id=?").run(s.id);
        } catch (error) {
          if (this.closed) return;
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SYNC_FAILED";
          if (["SAMPLE_DELETED", "CONSENT_EXPIRED"].includes(code) || (s.scope === "RECORDING" && code === "QUOTA_EXCEEDED")) this.stop(s.id);
          this.db.prepare("UPDATE improvement_subscriptions SET error=? WHERE id=?").run(code, s.id);
        }
      }
    } finally { this.busy = false; }
  }
}
