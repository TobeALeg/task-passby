import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { createSchema } from "./schema.js";
import {
  WORK_STATE_FIELDS,
  type CaptureBinding,
  type CreateWorkInput,
  type ExecutionEpisode,
  type WorkCore,
  type WorkCoreOptions,
  type WorkDefinition,
  type WorkInstance,
  type WorkRecord,
  type WorkSnapshot,
  type WorkState,
  type SourceEvent,
  type SourceEventInput,
  type WorkStateField,
  type WorkStatePatch,
} from "./types.js";

type Row = Record<string, unknown>;
type WorkStateTombstone = { field: WorkStateField; itemId: string };

function emptyWorkState(): WorkState {
  return {
    objective: [],
    successCriteria: [],
    constraints: [],
    facts: [],
    decisions: [],
    completedActions: [],
    pendingActions: [],
    artifacts: [],
  };
}

export class SqliteWorkCore implements WorkCore {
  readonly #database: DatabaseSync;
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(options: WorkCoreOptions) {
    this.#database = new DatabaseSync(options.databasePath);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#id = options.id ?? randomUUID;
    createSchema(this.#database);
  }

  createWork(input: CreateWorkInput): WorkSnapshot {
    const definitionId = this.#id();
    const instanceId = this.#id();
    const recordId = this.#id();
    const episodeId = this.#id();
    const bindingId = this.#id();
    const createdAt = this.#now();
    const state = emptyWorkState();

    if (input.objective) {
      state.objective.push({
        id: this.#id(),
        text: input.objective,
        origin: "USER_STATED",
        sourceMessageIds: [],
      });
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existingDefinition = this.#database
        .prepare(
          "SELECT id FROM work_definitions WHERE definition_key = ? AND version = ?",
        )
        .get(input.definition.key, input.definition.version) as Row | undefined;
      const resolvedDefinitionId = (existingDefinition?.id as string | undefined) ?? definitionId;

      if (!existingDefinition) {
        this.#database
          .prepare(
            "INSERT INTO work_definitions (id, definition_key, name, version) VALUES (?, ?, ?, ?)",
          )
          .run(
            resolvedDefinitionId,
            input.definition.key,
            input.definition.name,
            input.definition.version,
          );
      }

      this.#database
        .prepare(
          "INSERT INTO work_instances (id, definition_id, status, created_at, updated_at) VALUES (?, ?, 'OPEN', ?, ?)",
        )
        .run(instanceId, resolvedDefinitionId, createdAt, createdAt);
      this.#database
        .prepare(
          "INSERT INTO work_records (id, work_instance_id, state_json, tombstones_json) VALUES (?, ?, ?, '[]')",
        )
        .run(recordId, instanceId, JSON.stringify(state));
      this.#database
        .prepare(
          "INSERT INTO execution_episodes (id, work_instance_id, executor_json, environment_json, status, started_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
        )
        .run(
          episodeId,
          instanceId,
          JSON.stringify(input.executor),
          JSON.stringify(input.environment),
          createdAt,
        );
      this.#database
        .prepare(
          "INSERT INTO capture_bindings (id, work_instance_id, episode_id, adapter, conversation_id, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')",
        )
        .run(
          bindingId,
          instanceId,
          episodeId,
          input.source.adapter,
          input.source.conversationId,
        );
      this.#database.exec("COMMIT");

      const definition: WorkDefinition = {
        id: resolvedDefinitionId,
        ...input.definition,
      };
      const instance: WorkInstance = {
        id: instanceId,
        definitionId: resolvedDefinitionId,
        status: "OPEN",
        createdAt,
        updatedAt: createdAt,
      };
      const record: WorkRecord = { id: recordId, workInstanceId: instanceId };
      const activeEpisode: ExecutionEpisode = {
        id: episodeId,
        workInstanceId: instanceId,
        executor: input.executor,
        environment: input.environment,
        status: "ACTIVE",
        startedAt: createdAt,
        endedAt: null,
      };
      const activeBinding: CaptureBinding = {
        id: bindingId,
        workInstanceId: instanceId,
        episodeId,
        adapter: input.source.adapter,
        conversationId: input.source.conversationId,
        status: "ACTIVE",
      };

      return {
        definition,
        instance,
        record,
        episodes: [activeEpisode],
        bindings: [activeBinding],
        activeEpisode,
        activeBinding,
        state,
        sourceArchive: [],
        artifactRefs: [],
      };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getWork(workInstanceId: string): WorkSnapshot | null {
    const instanceRow = this.#database
      .prepare(
        `SELECT i.id, i.definition_id, i.status, i.created_at, i.updated_at,
                d.id AS d_id, d.definition_key, d.name, d.version,
                r.id AS r_id, r.state_json
         FROM work_instances i
         JOIN work_definitions d ON d.id = i.definition_id
         JOIN work_records r ON r.work_instance_id = i.id
         WHERE i.id = ?`,
      )
      .get(workInstanceId) as Row | undefined;

    if (!instanceRow) return null;

    const episodes = this.#database
      .prepare(
        `SELECT id, work_instance_id, executor_json, environment_json, status,
                started_at, ended_at
         FROM execution_episodes
         WHERE work_instance_id = ?
         ORDER BY started_at, rowid`,
      )
      .all(workInstanceId)
      .map((row) => this.#episodeFromRow(row as Row));
    const bindings = this.#database
      .prepare(
        `SELECT id, work_instance_id, episode_id, adapter, conversation_id, status
         FROM capture_bindings
         WHERE work_instance_id = ?
         ORDER BY rowid`,
      )
      .all(workInstanceId)
      .map((row) => this.#bindingFromRow(row as Row));
    const sourceArchive = this.#database
      .prepare(
        `SELECT id, work_instance_id, external_id, sequence, episode_id, kind,
                content, timestamp, executor_type, environment_type,
                metadata_json, artifact_refs_json
         FROM source_events
         WHERE work_instance_id = ?
         ORDER BY sequence, row_id`,
      )
      .all(workInstanceId)
      .map((row) => this.#sourceEventFromRow(row as Row));

    const definition: WorkDefinition = {
      id: instanceRow.d_id as string,
      key: instanceRow.definition_key as string,
      name: instanceRow.name as string,
      version: Number(instanceRow.version),
    };
    const instance: WorkInstance = {
      id: instanceRow.id as string,
      definitionId: instanceRow.definition_id as string,
      status: instanceRow.status as WorkInstance["status"],
      createdAt: instanceRow.created_at as string,
      updatedAt: instanceRow.updated_at as string,
    };
    const activeEpisode = episodes.find((episode) => episode.status === "ACTIVE") ?? null;
    const activeBinding = bindings.find((binding) => binding.status === "ACTIVE") ?? null;

    return {
      definition,
      instance,
      record: { id: instanceRow.r_id as string, workInstanceId },
      episodes,
      bindings,
      activeEpisode,
      activeBinding,
      state: JSON.parse(instanceRow.state_json as string) as WorkState,
      sourceArchive,
      artifactRefs: [],
    };
  }

  appendSourceEvents(
    workInstanceId: string,
    events: SourceEventInput[],
  ): { appendedCount: number; duplicateCount: number; work: WorkSnapshot } {
    const work = this.#requireWork(workInstanceId);
    if (work.instance.status !== "OPEN" || !work.activeBinding) {
      throw new Error("WORK_NOT_CAPTURING");
    }

    const insert = this.#database.prepare(
      `INSERT OR IGNORE INTO source_events
       (work_instance_id, id, external_id, sequence, episode_id, kind, content,
        timestamp, executor_type, environment_type, metadata_json, artifact_refs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let appendedCount = 0;

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) {
        const result = insert.run(
          workInstanceId,
          this.#id(),
          event.externalId,
          event.sequence,
          event.episodeId ?? work.activeEpisode?.id ?? null,
          event.kind,
          event.content,
          event.timestamp,
          event.executorType,
          event.environmentType,
          JSON.stringify(event.metadata),
          JSON.stringify(event.artifactRefs),
        );
        appendedCount += Number(result.changes);
      }
      if (appendedCount > 0) {
        this.#database
          .prepare("UPDATE work_instances SET updated_at = ? WHERE id = ?")
          .run(this.#now(), workInstanceId);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

    return {
      appendedCount,
      duplicateCount: events.length - appendedCount,
      work: this.#requireWork(workInstanceId),
    };
  }

  applyExtractorPatch(workInstanceId: string, patch: WorkStatePatch): WorkSnapshot {
    const work = this.#requireWork(workInstanceId);
    const nextState = structuredClone(work.state);
    const tombstones = this.#loadTombstones(workInstanceId);

    for (const field of WORK_STATE_FIELDS) {
      const incomingItems = patch[field];
      if (!incomingItems) continue;

      for (const incomingItem of incomingItems) {
        if (
          tombstones.some(
            (tombstone) =>
              tombstone.field === field && tombstone.itemId === incomingItem.id,
          )
        ) {
          continue;
        }
        const existingIndex = nextState[field].findIndex(
          (existing) => existing.id === incomingItem.id,
        );
        const existing = nextState[field][existingIndex];
        if (existing?.origin === "USER_EDITED") continue;

        if (existingIndex === -1) {
          nextState[field].push(structuredClone(incomingItem));
        } else {
          nextState[field][existingIndex] = structuredClone(incomingItem);
        }
      }
    }

    this.#saveState(workInstanceId, nextState);
    return this.#requireWork(workInstanceId);
  }

  editWorkStateItem(
    workInstanceId: string,
    field: WorkStateField,
    itemId: string,
    text: string,
  ): WorkSnapshot {
    const work = this.#requireWork(workInstanceId);
    const nextState = structuredClone(work.state);
    const item = nextState[field].find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("WORK_STATE_ITEM_NOT_FOUND");

    item.text = text;
    item.origin = "USER_EDITED";
    this.#saveState(workInstanceId, nextState);
    return this.#requireWork(workInstanceId);
  }

  deleteWorkStateItem(
    workInstanceId: string,
    field: WorkStateField,
    itemId: string,
  ): WorkSnapshot {
    const work = this.#requireWork(workInstanceId);
    const nextState = structuredClone(work.state);
    const existingIndex = nextState[field].findIndex((item) => item.id === itemId);
    if (existingIndex === -1) throw new Error("WORK_STATE_ITEM_NOT_FOUND");

    nextState[field].splice(existingIndex, 1);
    const tombstones = this.#loadTombstones(workInstanceId);
    if (
      !tombstones.some(
        (tombstone) => tombstone.field === field && tombstone.itemId === itemId,
      )
    ) {
      tombstones.push({ field, itemId });
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `UPDATE work_records
           SET state_json = ?, tombstones_json = ?
           WHERE work_instance_id = ?`,
        )
        .run(JSON.stringify(nextState), JSON.stringify(tombstones), workInstanceId);
      this.#database
        .prepare("UPDATE work_instances SET updated_at = ? WHERE id = ?")
        .run(this.#now(), workInstanceId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

    return this.#requireWork(workInstanceId);
  }

  #loadTombstones(workInstanceId: string): WorkStateTombstone[] {
    const row = this.#database
      .prepare(
        "SELECT tombstones_json FROM work_records WHERE work_instance_id = ?",
      )
      .get(workInstanceId) as Row | undefined;
    if (!row) throw new Error("WORK_NOT_FOUND");
    return JSON.parse(row.tombstones_json as string) as WorkStateTombstone[];
  }

  #saveState(workInstanceId: string, state: WorkState): void {
    const result = this.#database
      .prepare(
        `UPDATE work_records SET state_json = ? WHERE work_instance_id = ?`,
      )
      .run(JSON.stringify(state), workInstanceId);
    if (result.changes === 0) throw new Error("WORK_NOT_FOUND");
    this.#database
      .prepare("UPDATE work_instances SET updated_at = ? WHERE id = ?")
      .run(this.#now(), workInstanceId);
  }

  #requireWork(workInstanceId: string): WorkSnapshot {
    const work = this.getWork(workInstanceId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    return work;
  }

  #episodeFromRow(row: Row): ExecutionEpisode {
    return {
      id: row.id as string,
      workInstanceId: row.work_instance_id as string,
      executor: JSON.parse(row.executor_json as string),
      environment: JSON.parse(row.environment_json as string),
      status: row.status as ExecutionEpisode["status"],
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string | null) ?? null,
    };
  }

  #bindingFromRow(row: Row): CaptureBinding {
    return {
      id: row.id as string,
      workInstanceId: row.work_instance_id as string,
      episodeId: row.episode_id as string,
      adapter: row.adapter as string,
      conversationId: row.conversation_id as string,
      status: row.status as CaptureBinding["status"],
    };
  }

  #sourceEventFromRow(row: Row): SourceEvent {
    return {
      id: row.id as string,
      workInstanceId: row.work_instance_id as string,
      externalId: row.external_id as string,
      sequence: Number(row.sequence),
      episodeId: (row.episode_id as string | null) ?? null,
      kind: row.kind as SourceEvent["kind"],
      content: (row.content as string | null) ?? null,
      timestamp: row.timestamp as string,
      executorType: row.executor_type as SourceEvent["executorType"],
      environmentType: row.environment_type as string,
      metadata: JSON.parse(row.metadata_json as string),
      artifactRefs: JSON.parse(row.artifact_refs_json as string),
    };
  }

  close(): void {
    this.#database.close();
  }
}
