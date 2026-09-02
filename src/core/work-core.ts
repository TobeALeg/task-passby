import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { createSchema } from "./schema.ts";
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
} from "./types.ts";

type Row = Record<string, unknown>;

function emptyWorkState(): WorkState {
  return Object.fromEntries(WORK_STATE_FIELDS.map((field) => [field, []])) as WorkState;
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

  close(): void {
    this.#database.close();
  }
}
