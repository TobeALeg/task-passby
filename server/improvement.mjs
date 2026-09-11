import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { IMPROVEMENT_POLICY, validateSample } from "../dist/contracts/improvement.js";
import { ensure } from "../dist/contracts/definition.js";
import { canonical, hash, transaction } from "../dist/definitions/storage.js";

// Body-bearing data stays in this store; tombstones carry only opaque identifiers.
export class ImprovementStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL);
      INSERT OR IGNORE INTO settings VALUES (1,1);
      CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, subject TEXT NOT NULL, client_id TEXT NOT NULL, consent TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, review TEXT NOT NULL DEFAULT '{"status":"DRAFT","note":""}', UNIQUE(subject,client_id));
      CREATE TABLE IF NOT EXISTS events (sample_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(sample_id,id));
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY);
    `);
    this.expire();
  }
  policy() { return { ...IMPROVEMENT_POLICY, enabled: !!this.db.prepare("SELECT enabled FROM settings WHERE id=1").get().enabled }; }
  setEnabled(enabled) {
    ensure(typeof enabled === "boolean", "INVALID_INPUT");
    this.db.prepare("UPDATE settings SET enabled=? WHERE id=1").run(Number(enabled));
    return this.policy();
  }
  key(subject, clientId) { return hash([subject, clientId]); }
  expire() {
    for (const row of this.db.prepare("SELECT id FROM samples WHERE expires<=?").all(Date.now())) this.delete(row.id);
  }
  receive(subject, input) {
    validateSample(input);
    this.expire();
    const id = this.key(subject, input.sampleId);
    ensure(!this.db.prepare("SELECT id FROM tombstones WHERE id=?").get(id), "SAMPLE_DELETED");
    ensure(this.policy().enabled, "COLLECTION_PAUSED");
    return transaction(this.db, () => {
      let sample = this.db.prepare("SELECT * FROM samples WHERE id=?").get(id);
      if (!sample) {
        ensure(["SOURCE", "REUSE", "RECORDING"].includes(input.event.kind), "SAMPLE_SOURCE_REQUIRED");
        ensure(this.db.prepare("SELECT COUNT(*) AS n FROM samples WHERE subject=?").get(subject).n < 1000, "QUOTA_EXCEEDED");
        this.db.prepare("INSERT INTO samples (id,subject,client_id,consent,created,expires) VALUES (?,?,?,?,?,?)").run(id, subject, input.sampleId, canonical(input.consent), Date.now(), Date.parse(input.consent.at) + IMPROVEMENT_POLICY.retentionDays * 86400000);
        sample = this.db.prepare("SELECT * FROM samples WHERE id=?").get(id);
      }
      ensure(sample.consent === canonical(input.consent), "CONSENT_REQUIRED");
      const previous = this.db.prepare("SELECT digest FROM events WHERE sample_id=? AND id=?").get(id, input.event.id);
      const digest = hash(input.event);
      if (previous) ensure(previous.digest === digest, "IDEMPOTENCY_CONFLICT");
      else {
        ensure(this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE sample_id=?").get(id).n < 1000, "QUOTA_EXCEEDED");
        this.db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(id, input.event.id, JSON.stringify(input.event), digest);
      }
      return { id, received: true };
    });
  }
  list() {
    this.expire();
    return this.db.prepare("SELECT id,subject,client_id,consent,created,expires,review,(SELECT COUNT(*) FROM events WHERE sample_id=samples.id) AS eventCount FROM samples ORDER BY created DESC LIMIT 1000").all().map(row => ({ ...row, consent: JSON.parse(row.consent), review: JSON.parse(row.review) }));
  }
  get(id) {
    this.expire();
    const row = this.db.prepare("SELECT * FROM samples WHERE id=?").get(id);
    ensure(row, "NOT_FOUND");
    return { ...row, consent: JSON.parse(row.consent), review: JSON.parse(row.review), events: this.db.prepare("SELECT payload FROM events WHERE sample_id=? ORDER BY rowid").all(id).map(e => JSON.parse(e.payload)) };
  }
  review(id, input) {
    this.get(id);
    ensure(input && ["DRAFT", "REVIEWED"].includes(input.status) && typeof input.note === "string" && input.note.length <= 10000, "INVALID_INPUT");
    this.db.prepare("UPDATE samples SET review=? WHERE id=?").run(JSON.stringify({ status: input.status, note: input.note, at: new Date().toISOString() }), id);
    return this.get(id);
  }
  delete(id) {
    transaction(this.db, () => {
      this.db.prepare("INSERT OR IGNORE INTO tombstones VALUES (?)").run(id);
      this.db.prepare("DELETE FROM events WHERE sample_id=?").run(id);
      this.db.prepare("DELETE FROM samples WHERE id=?").run(id);
    });
    return { deleted: true };
  }
  close() { this.db.close(); }
}
