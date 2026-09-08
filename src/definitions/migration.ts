import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./storage.js";
export function migrateDefinitions(
  db: DatabaseSync,
  databasePath: string,
): void {
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  );
  if (version > 2)
    throw new Error(
      "DATABASE_VERSION_UNSUPPORTED：请使用新版 Worket 或恢复迁移前备份",
    );
  if (version === 2) return;
  if (version === 1) {
    if (
      databasePath !== ":memory:" &&
      !existsSync(`${databasePath}.before-storage-v2.bak`)
    )
      db.prepare("VACUUM INTO ?").run(`${databasePath}.before-storage-v2.bak`);
    transaction(db, () => {
      db.exec(`ALTER TABLE capture_bindings RENAME TO capture_bindings_v2;
        CREATE VIEW capture_bindings AS SELECT '请使用支持沉淀的 Worket；回滚需恢复迁移前备份' AS upgrade_required;
        PRAGMA user_version = 2;`);
    });
    return;
  }
  if (
    databasePath !== ":memory:" &&
    existsSync(databasePath) &&
    !existsSync(`${databasePath}.before-distillation-v1.bak`)
  )
    db.prepare("VACUUM INTO ?").run(
      `${databasePath}.before-distillation-v1.bak`,
    );
  transaction(db, () => {
    db.exec(`
      ALTER TABLE work_definitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'GENERAL';
      ALTER TABLE work_definitions ADD COLUMN payload_json TEXT;
      CREATE TABLE source_snapshots (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE distillation_jobs (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id), payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE definition_drafts (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE definition_materials (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE definition_material_refs (definition_id TEXT NOT NULL REFERENCES work_definitions(id) ON DELETE CASCADE, material_id TEXT NOT NULL REFERENCES definition_materials(id), role TEXT NOT NULL, PRIMARY KEY(definition_id, role)) STRICT;
      CREATE TABLE pending_dispatches (work_id TEXT PRIMARY KEY REFERENCES work_instances(id) ON DELETE CASCADE, command_id TEXT NOT NULL, status TEXT NOT NULL, read_at TEXT) STRICT;
      CREATE TABLE instance_inputs (work_id TEXT PRIMARY KEY REFERENCES work_instances(id) ON DELETE CASCADE, payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE review_events (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload_json TEXT NOT NULL) STRICT;
      CREATE TABLE command_results (id TEXT PRIMARY KEY, hash TEXT NOT NULL, owner_id TEXT NOT NULL, payload_json TEXT NOT NULL) STRICT;
      ALTER TABLE capture_bindings RENAME TO capture_bindings_v2;
      CREATE VIEW capture_bindings AS SELECT '请使用支持沉淀的 Worket；回滚需恢复迁移前备份' AS upgrade_required;
      PRAGMA user_version = 2;
    `);
  });
}
