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
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'INACTIVE')),
      UNIQUE(adapter, conversation_id, status)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_events (
      row_id INTEGER PRIMARY KEY,
      work_instance_id TEXT NOT NULL REFERENCES work_instances(id) ON DELETE CASCADE,
      source_event_id TEXT NOT NULL,
      episode_id TEXT REFERENCES execution_episodes(id),
      event_type TEXT NOT NULL,
      message_id TEXT,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(work_instance_id, source_event_id)
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
  `);
}
