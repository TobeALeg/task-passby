import type { DatabaseSync } from "node:sqlite";

export function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS work_definitions (
      id TEXT PRIMARY KEY,
      definition_key TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      UNIQUE(definition_key, version)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS work_instances (
      id TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL REFERENCES work_definitions(id),
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'COMPLETED', 'ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS work_records (
      id TEXT PRIMARY KEY,
      work_instance_id TEXT NOT NULL UNIQUE REFERENCES work_instances(id) ON DELETE CASCADE,
      state_json TEXT NOT NULL,
      tombstones_json TEXT NOT NULL DEFAULT '[]'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS execution_episodes (
      id TEXT PRIMARY KEY,
      work_instance_id TEXT NOT NULL REFERENCES work_instances(id) ON DELETE CASCADE,
      executor_json TEXT NOT NULL,
      environment_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ENDED')),
      started_at TEXT NOT NULL,
      ended_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS capture_bindings (
      id TEXT PRIMARY KEY,
      work_instance_id TEXT NOT NULL REFERENCES work_instances(id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL REFERENCES execution_episodes(id) ON DELETE CASCADE,
      adapter TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      source_locator TEXT,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'INACTIVE'))
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS one_active_capture_per_conversation
      ON capture_bindings(adapter, conversation_id)
      WHERE status = 'ACTIVE';

    CREATE TABLE IF NOT EXISTS source_events (
      row_id INTEGER PRIMARY KEY,
      work_instance_id TEXT NOT NULL REFERENCES work_instances(id) ON DELETE CASCADE,
      id TEXT NOT NULL UNIQUE,
      external_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      episode_id TEXT REFERENCES execution_episodes(id),
      kind TEXT NOT NULL,
      content TEXT,
      timestamp TEXT NOT NULL,
      executor_type TEXT NOT NULL,
      environment_type TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      artifact_refs_json TEXT NOT NULL,
      UNIQUE(work_instance_id, external_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS artifact_refs (
      id TEXT PRIMARY KEY,
      work_instance_id TEXT NOT NULL REFERENCES work_instances(id) ON DELETE CASCADE,
      episode_id TEXT REFERENCES execution_episodes(id),
      path TEXT NOT NULL,
      role TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      last_modified_at TEXT NOT NULL,
      availability TEXT NOT NULL CHECK(availability IN ('AVAILABLE', 'CHANGED', 'MISSING'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS handoff_packages (
      row_id INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      work_instance_id TEXT NOT NULL REFERENCES work_instances(id) ON DELETE CASCADE,
      generated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
  `);
  const bindingColumns = database.prepare("PRAGMA table_info(capture_bindings)").all() as Array<{ name: string }>;
  if (!bindingColumns.some((column) => column.name === "source_locator")) {
    database.exec("ALTER TABLE capture_bindings ADD COLUMN source_locator TEXT");
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS capture_bindings_source_locator
      ON capture_bindings(adapter, source_locator);
  `);
}
