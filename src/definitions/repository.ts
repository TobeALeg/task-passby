import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ensure,
  validateContent,
  string,
  object,
  array,
  LIMITS,
  type DefinitionContent,
  type DefinedItem,
  type Issue,
  type Resolution,
  type SourceRef,
} from "../contracts/definition.js";
import {
  hash,
  canonical,
  transaction,
  MaterialStore,
  type Material,
} from "./storage.js";
import type { WorkSnapshot, WorkState } from "../core/types.js";
export type Draft = {
  id: string;
  jobId?: string;
  baseDefinitionId?: string;
  revision: number;
  content: DefinitionContent;
  originalContent: DefinitionContent;
  refs: SourceRef[];
  issues: Issue[];
  resolutions: Resolution[];
  publishedId?: string;
  invalidated?: boolean;
};
export type Definition = {
  id: string;
  definitionKey: string;
  version: number;
  kind: "REUSABLE";
  content: DefinitionContent;
  refs: SourceRef[];
  confirmedAt: string;
  contentHash: string;
  materials: Material[];
};
export type Inputs = Record<string, string | number | boolean>;
export type CreateFromDefinition = {
  definitionId: string;
  inputs: Inputs;
  referenceExampleIds: string[];
  commandId: string;
};
const fieldItems = (content: DefinitionContent, field: string): unknown => {
  const parts = field.split(".");
  const collection = (content as unknown as Record<string, unknown>)[parts[0]!];
  if (parts.length === 1 && collection !== undefined) return collection;
  if (Array.isArray(collection))
    return collection.find((i: DefinedItem) => i.key === parts[1]);
  return allItems(content).find((i) => i.key === field);
};
const allItems = (content: DefinitionContent): DefinedItem[] => [
  content.purpose,
  ...content.inputs,
  ...content.deliverables,
  ...content.constraints,
  ...content.acceptanceCriteria,
  ...content.methods,
  ...content.materialRoles,
];
export class DefinitionRepository {
  readonly materials: MaterialStore;
  constructor(
    readonly db: DatabaseSync,
    directory: string,
  ) {
    this.materials = new MaterialStore(directory);
  }
  read<T>(
    table: "source_snapshots" | "distillation_jobs" | "definition_drafts",
    id: string,
  ): T {
    string(id);
    const row = this.db
      .prepare(`SELECT payload_json FROM ${table} WHERE id = ?`)
      .get(id);
    ensure(row, "NOT_FOUND");
    return JSON.parse(row.payload_json as string) as T;
  }
  write(
    table: "source_snapshots" | "distillation_jobs" | "definition_drafts",
    value: { id: string },
  ): void {
    this.db
      .prepare(`UPDATE ${table} SET payload_json = ? WHERE id = ?`)
      .run(JSON.stringify(value), value.id);
  }
  list<T>(
    table: "source_snapshots" | "distillation_jobs" | "definition_drafts",
  ): T[] {
    return this.db
      .prepare(`SELECT payload_json FROM ${table} ORDER BY rowid DESC`)
      .all()
      .map((r) => JSON.parse(r.payload_json as string) as T);
  }
  command<T>(id: string, input: unknown, owner: string, run: () => T): T {
    string(id);
    const digest = hash(input);
    return transaction(this.db, () => {
      const old = this.db
        .prepare("SELECT * FROM command_results WHERE id = ?")
        .get(id);
      if (old) {
        ensure(old.hash === digest, "IDEMPOTENCY_CONFLICT");
        return JSON.parse(old.payload_json as string) as T;
      }
      const result = run();
      this.db
        .prepare("INSERT INTO command_results VALUES (?, ?, ?, ?)")
        .run(id, digest, owner, JSON.stringify(result));
      return result;
    });
  }
  get(id: string): Definition {
    string(id);
    const row = this.db
      .prepare(
        "SELECT payload_json FROM work_definitions WHERE id = ? AND kind = 'REUSABLE'",
      )
      .get(id);
    ensure(row, "DEFINITION_NOT_FOUND");
    return JSON.parse(row.payload_json as string) as Definition;
  }
  definitions(input: { cursor?: string; limit?: number } = {}): {
    items: Definition[];
    cursor: string | null;
  } {
    const limit = input.limit ?? 50;
    ensure(
      Number.isInteger(limit) && limit > 0 && limit <= 100,
      "INVALID_INPUT",
    );
    const all = this.db
      .prepare(
        "SELECT payload_json FROM work_definitions WHERE kind = 'REUSABLE' ORDER BY definition_key, version DESC",
      )
      .all()
      .map((r) => JSON.parse(r.payload_json as string) as Definition);
    const latest = all
      .filter(
        (d, i) =>
          !all.slice(0, i).some((x) => x.definitionKey === d.definitionKey),
      )
      .filter((d) => !input.cursor || d.definitionKey > input.cursor);
    const items = latest.slice(0, limit);
    return {
      items,
      cursor: latest.length > limit ? items.at(-1)!.definitionKey : null,
    };
  }
  versions(key: string): Definition[] {
    string(key);
    return this.db
      .prepare(
        "SELECT payload_json FROM work_definitions WHERE definition_key = ? AND kind = 'REUSABLE' ORDER BY version DESC",
      )
      .all(key)
      .map((r) => JSON.parse(r.payload_json as string) as Definition);
  }
  saveDraft(draft: Draft): Draft {
    validateContent(draft.content);
    this.db
      .prepare("INSERT INTO definition_drafts VALUES (?, ?)")
      .run(draft.id, JSON.stringify(draft));
    return draft;
  }
  revise(input: { definitionId: string; commandId: string }): Draft {
    return this.command(
      input.commandId,
      { op: "revise", ...input },
      input.definitionId,
      () => {
        const definition = this.get(input.definitionId);
        return this.saveDraft({
          id: randomUUID(),
          baseDefinitionId: definition.id,
          revision: 1,
          content: definition.content,
          originalContent: definition.content,
          refs: definition.refs,
          issues: [],
          resolutions: [],
        });
      },
    );
  }
  update(input: {
    draftId: string;
    expectedRevision: number;
    content: DefinitionContent;
    issueResolutions: Resolution[];
  }): Draft {
    validateContent(input.content);
    array(input.issueResolutions);
    return transaction(this.db, () => {
      const draft = this.read<Draft>("definition_drafts", input.draftId);
      ensure(!draft.invalidated && !draft.publishedId, "DRAFT_NOT_EDITABLE");
      ensure(draft.revision === input.expectedRevision, "REVISION_CONFLICT");
      const content = structuredClone(input.content);
      const reviewId = randomUUID();
      // Collection identity matters: keys are unique within each collection, not globally.
      const collections = [
        "purpose",
        "inputs",
        "deliverables",
        "constraints",
        "acceptanceCriteria",
        "methods",
        "materialRoles",
      ] as const;
      for (const collection of collections) {
        const previous =
          collection === "purpose"
            ? [draft.content.purpose]
            : draft.content[collection];
        const items =
          collection === "purpose" ? [content.purpose] : content[collection];
        for (const item of items) {
          const old = previous.find((v) => v.key === item.key);
          const changed =
            !old ||
            canonical({ ...old, basis: null }) !==
              canonical({ ...item, basis: null });
          item.basis = changed
            ? { type: "USER_AUTHORED", reviewEventId: reviewId }
            : old.basis;
        }
      }
      for (const resolution of input.issueResolutions) {
        object(resolution);
        string(resolution.issueId);
        string(resolution.explanation);
        ensure(
          ["REWRITE", "DELETE", "CHOOSE", "ACCEPT"].includes(resolution.action),
        );
        if (
          draft.resolutions.some(
            (old) => canonical(old) === canonical(resolution),
          )
        )
          continue;
        const issue = draft.issues.find((i) => i.id === resolution.issueId);
        ensure(issue, "INVALID_INPUT");
        ensure(
          !issue.blocking || resolution.action !== "ACCEPT",
          "UNRESOLVED_ISSUES",
        );
        if (resolution.action === "REWRITE" || resolution.action === "DELETE")
          ensure(
            canonical(fieldItems(content, issue.field)) !==
              canonical(fieldItems(draft.content, issue.field)),
            "UNRESOLVED_ISSUES",
            "请实际修改或删除问题涉及的要求",
          );
      }
      this.db.prepare("INSERT INTO review_events VALUES (?, ?, ?)").run(
        reviewId,
        draft.id,
        JSON.stringify({
          at: new Date().toISOString(),
          before: draft.content,
          after: content,
          resolutions: input.issueResolutions,
        }),
      );
      draft.content = content;
      draft.revision++;
      draft.resolutions = [
        ...draft.resolutions.filter(
          (r) => !input.issueResolutions.some((n) => n.issueId === r.issueId),
        ),
        ...input.issueResolutions,
      ];
      this.write("definition_drafts", draft);
      return draft;
    });
  }
  publish(input: {
    draftId: string;
    expectedRevision: number;
    materialBindings: Record<string, string>;
    commandId: string;
  }): Definition {
    object(input.materialBindings);
    Object.values(input.materialBindings).forEach(string);
    const saved = this.db
      .prepare("SELECT * FROM command_results WHERE id=?")
      .get(input.commandId);
    if (saved) {
      ensure(
        saved.hash === hash({ op: "publish", ...input }),
        "IDEMPOTENCY_CONFLICT",
      );
      return JSON.parse(saved.payload_json as string) as Definition;
    }
    const draft = this.read<Draft>("definition_drafts", input.draftId);
    // Copy explicit material choices before taking the SQL write lock. Referenced blobs are immutable.
    ensure(
      Object.keys(input.materialBindings).length <= LIMITS.maxMaterials,
      "INPUT_TOO_LARGE",
    );
    const inherited = draft.baseDefinitionId
      ? this.get(draft.baseDefinitionId).materials
      : [];
    const materials = draft.content.materialRoles.flatMap((role) => {
      const path = input.materialBindings[role.key];
      const old = inherited.find((m) => m.role === role.key);
      return path ? [this.materials.copy(path, role.key)] : old ? [old] : [];
    });
    ensure(
      materials.reduce((n, m) => n + m.size, 0) <= LIMITS.maxMaterialBytes,
      "INPUT_TOO_LARGE",
    );
    return this.command(
      input.commandId,
      { op: "publish", ...input },
      draft.id,
      () => {
        const current = this.read<Draft>("definition_drafts", draft.id);
        if (current.publishedId) return this.get(current.publishedId);
        ensure(!current.invalidated, "SOURCE_DELETED");
        ensure(
          current.revision === input.expectedRevision,
          "REVISION_CONFLICT",
        );
        validateContent(current.content);
        if (current.jobId) {
          const job = this.read<{ status: string }>(
            "distillation_jobs",
            current.jobId,
          );
          ensure(job.status === "AWAITING_REVIEW", "JOB_NOT_PUBLISHABLE");
        }
        ensure(
          current.content.deliverables.length &&
            current.content.acceptanceCriteria.length,
          "MISSING_INFORMATION",
        );
        ensure(
          current.issues.every((i) =>
            current.resolutions.some((r) => r.issueId === i.id),
          ),
          "UNRESOLVED_ISSUES",
        );
        for (const role of current.content.materialRoles)
          ensure(
            !role.required || materials.some((m) => m.role === role.key),
            "MATERIAL_MISSING",
          );
        materials.forEach((m) => this.materials.verify(m));
        for (const method of current.content.methods)
          ensure(
            method.obligation !== "REQUIRED" ||
              method.basis.type === "USER_AUTHORED" ||
              (method.basis.type === "SOURCE" &&
                method.basis.origin === "USER_STATED") ||
              current.resolutions.some(
                (r) =>
                  r.action === "CHOOSE" &&
                  current.issues.some(
                    (i) => i.id === r.issueId && i.field === method.key,
                  ),
              ),
            "UNSUPPORTED_SOURCE",
            "强制步骤需要明确确认",
          );
        const base = current.baseDefinitionId
          ? this.get(current.baseDefinitionId)
          : null;
        if (
          base &&
          hash({
            content: JSON.parse(
              JSON.stringify(current.content, (k, v) =>
                k === "basis" ? undefined : v,
              ),
            ),
            materials,
          }) ===
            hash({
              content: JSON.parse(
                JSON.stringify(base.content, (k, v) =>
                  k === "basis" ? undefined : v,
                ),
              ),
              materials: base.materials,
            })
        ) {
          current.publishedId = base.id;
          this.write("definition_drafts", current);
          return base;
        }
        const key = base?.definitionKey ?? randomUUID();
        const version =
          Math.max(0, ...this.versions(key).map((d) => d.version)) + 1;
        const definition: Definition = {
          id: randomUUID(),
          definitionKey: key,
          version,
          kind: "REUSABLE",
          content: current.content,
          refs: current.refs,
          confirmedAt: new Date().toISOString(),
          contentHash: hash({ content: current.content, materials }),
          materials,
        };
        this.db
          .prepare(
            "INSERT INTO work_definitions (id,definition_key,name,version,kind,payload_json) VALUES (?,?,?,?,'REUSABLE',?)",
          )
          .run(
            definition.id,
            key,
            definition.content.name,
            version,
            JSON.stringify(definition),
          );
        for (const material of materials) {
          this.db
            .prepare("INSERT OR IGNORE INTO definition_materials VALUES (?,?)")
            .run(material.id, JSON.stringify(material));
          this.db
            .prepare("INSERT INTO definition_material_refs VALUES (?,?,?)")
            .run(definition.id, material.id, material.role);
        }
        const confirmationId = randomUUID();
        this.db.prepare("INSERT INTO review_events VALUES (?,?,?)").run(
          confirmationId,
          definition.id,
          JSON.stringify({
            type: "CONFIRMED",
            draftId: current.id,
            at: definition.confirmedAt,
          }),
        );
        current.publishedId = definition.id;
        this.write("definition_drafts", current);
        if (current.jobId) {
          const job = this.read<{ id: string; status: string }>(
            "distillation_jobs",
            current.jobId,
          );
          job.status = "SAVED";
          this.write("distillation_jobs", job);
        }
        return definition;
      },
    );
  }
  create(input: CreateFromDefinition): string {
    object(input.inputs);
    array(input.referenceExampleIds);
    ensure(
      new Set(input.referenceExampleIds).size ===
        input.referenceExampleIds.length,
      "INVALID_INPUT",
    );
    return this.command(
      input.commandId,
      { op: "create", ...input },
      input.definitionId,
      () => {
        const definition = this.get(input.definitionId);
        definition.materials.forEach((m) => this.materials.verify(m));
        const values: Inputs = {};
        ensure(
          Object.keys(input.inputs).every((key) =>
            definition.content.inputs.some((i) => i.key === key),
          ),
          "INVALID_INPUT",
        );
        for (const spec of definition.content.inputs) {
          const value = input.inputs[spec.key] ?? spec.defaultValue;
          ensure(
            !spec.required || (value !== undefined && value !== ""),
            "INPUT_REQUIRED",
            spec.key,
          );
          if (value === undefined || value === "") continue;
          ensure(
            spec.valueType === "NUMBER"
              ? typeof value === "number" && Number.isFinite(value)
              : spec.valueType === "BOOLEAN"
                ? typeof value === "boolean"
                : typeof value === "string",
            "INVALID_INPUT",
            spec.key,
          );
          if (spec.valueType === "CHOICE")
            ensure(
              spec.choices?.includes(value as string),
              "INVALID_INPUT",
              spec.key,
            );
          if (spec.valueType === "FILE") this.materials.read(value as string);
          values[spec.key] = value;
        }
        const examples = input.referenceExampleIds.map((id) => {
          string(id);
          const r = this.db
            .prepare(
              "SELECT path,sha256,filename FROM artifact_refs WHERE id = ?",
            )
            .get(id);
          ensure(r, "MATERIAL_MISSING");
          ensure(
            hash(this.materials.read(r.path as string)) === r.sha256,
            "MATERIAL_MISSING",
          );
          return {
            id,
            path: r.path,
            hash: r.sha256,
            filename: r.filename,
            role: "REFERENCE_EXAMPLE",
          };
        });
        const id = randomUUID(),
          at = new Date().toISOString(),
          adopted = randomUUID(),
          provided = randomUUID();
        const interpolate = (text: string) =>
          text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) =>
            String(values[key] ?? "（待提供）"),
          );
        const state: WorkState = {
          objective: [],
          constraints: [],
          successCriteria: [],
          facts: [],
          decisions: [],
          completedActions: [],
          pendingActions: [],
          artifacts: [],
        };
        const item = (text: string, event = adopted) => ({
          id: randomUUID(),
          text: interpolate(text),
          origin: "USER_STATED" as const,
          sourceMessageIds: [event],
        });
        state.objective = [item(definition.content.purpose.text)];
        state.constraints = definition.content.constraints.map((i) =>
          item(i.text),
        );
        state.successCriteria = definition.content.acceptanceCriteria.map((i) =>
          item(i.text),
        );
        state.facts = Object.entries(values).map(([key, value]) =>
          item(`${key}: ${value}`, provided),
        );
        this.db
          .prepare("INSERT INTO work_instances VALUES (?,?,'OPEN',?,?)")
          .run(id, definition.id, at, at);
        this.db
          .prepare("INSERT INTO work_records (id,work_instance_id,state_json,tombstones_json) VALUES (?,?,?,'[]')")
          .run(randomUUID(), id, JSON.stringify(state));
        this.db
          .prepare("INSERT INTO instance_inputs VALUES (?,?)")
          .run(
            id,
            JSON.stringify({ inputs: values, referenceExamples: examples }),
          );
        for (const [eventId, kind, content, sequence] of [
          [
            adopted,
            "work.definition_applied",
            JSON.stringify({
              definitionId: definition.id,
              version: definition.version,
            }),
            1,
          ],
          [provided, "work.input_provided", JSON.stringify(values), 2],
        ] as const)
          this.db
            .prepare(
              "INSERT INTO source_events (work_instance_id,id,external_id,sequence,kind,content,timestamp,executor_type,environment_type,metadata_json,artifact_refs_json) VALUES (?,?,?,?,?,?,?,'HUMAN','WORKPET_LOCAL','{}','[]')",
            )
            .run(id, eventId, eventId, sequence, kind, content, at);
        return id;
      },
    );
  }
  inputs(workId: string): { inputs: Inputs; referenceExamples: unknown[] } {
    const row = this.db
      .prepare("SELECT payload_json FROM instance_inputs WHERE work_id=?")
      .get(workId);
    return row
      ? JSON.parse(row.payload_json as string)
      : { inputs: {}, referenceExamples: [] };
  }
  accept(input: {
    workId: string;
    artifactIds: string[];
    criteriaResults: Record<string, "PASS" | "NEEDS_REVISION">;
    commandId: string;
  }): { completed: boolean } {
    array(input.artifactIds);
    object(input.criteriaResults);
    return this.command(
      input.commandId,
      { op: "accept", ...input },
      input.workId,
      () => {
        const work = this.db
          .prepare("SELECT * FROM work_instances WHERE id=?")
          .get(input.workId);
        ensure(work?.status === "OPEN", "WORK_NOT_OPEN");
        const definition = this.get(work.definition_id as string);
        const criteria = definition.content.acceptanceCriteria;
        ensure(
          Object.keys(input.criteriaResults).length === criteria.length &&
            criteria.every((c) =>
              ["PASS", "NEEDS_REVISION"].includes(
                input.criteriaResults[c.key]!,
              ),
            ),
          "INPUT_REQUIRED",
        );
        ensure(
          input.artifactIds.length > 0,
          "MATERIAL_MISSING",
          "请关联本次交付物",
        );
        for (const id of input.artifactIds) {
          const artifact = this.db
            .prepare(
              "SELECT * FROM artifact_refs WHERE id=? AND work_instance_id=?",
            )
            .get(id, input.workId);
          ensure(
            artifact &&
              hash(this.materials.read(artifact.path as string)) ===
                artifact.sha256,
            "MATERIAL_MISSING",
          );
        }
        const at = new Date().toISOString(),
          completed = criteria.every(
            (c) => input.criteriaResults[c.key] === "PASS",
          );
        this.db.prepare("INSERT INTO review_events VALUES (?,?,?)").run(
          randomUUID(),
          input.workId,
          JSON.stringify({
            type: "ACCEPTANCE",
            definitionId: definition.id,
            at,
            ...input,
          }),
        );
        if (completed) {
          this.db
            .prepare(
              "UPDATE work_instances SET status='COMPLETED',updated_at=? WHERE id=?",
            )
            .run(at, input.workId);
          this.db
            .prepare(
              "UPDATE execution_episodes SET status='ENDED',ended_at=? WHERE work_instance_id=? AND status='ACTIVE'",
            )
            .run(at, input.workId);
          this.db
            .prepare(
              "UPDATE capture_bindings_v2 SET status='INACTIVE' WHERE work_instance_id=?",
            )
            .run(input.workId);
        }
        return { completed };
      },
    );
  }
  delete(input: {
    definitionKey: string;
    confirmation: string;
    commandId: string;
  }): void {
    ensure(input.confirmation === "永久删除", "CONFIRMATION_REQUIRED");
    this.command(
      input.commandId,
      { op: "delete", ...input },
      input.definitionKey,
      () => {
        const versions = this.versions(input.definitionKey);
        ensure(
          !versions.some((d) =>
            this.db
              .prepare("SELECT id FROM work_instances WHERE definition_id=?")
              .get(d.id),
          ),
          "DEFINITION_IN_USE",
        );
        for (const d of versions) {
          this.db.prepare("DELETE FROM work_definitions WHERE id=?").run(d.id);
          this.db
            .prepare("DELETE FROM review_events WHERE owner_id=?")
            .run(d.id);
          this.db
            .prepare("DELETE FROM command_results WHERE owner_id=?")
            .run(d.id);
        }
        for (const draft of this.list<Draft>("definition_drafts"))
          if (
            versions.some(
              (d) =>
                draft.baseDefinitionId === d.id || draft.publishedId === d.id,
            )
          ) {
            this.db
              .prepare("DELETE FROM definition_drafts WHERE id=?")
              .run(draft.id);
            this.db
              .prepare("DELETE FROM review_events WHERE owner_id=?")
              .run(draft.id);
            this.db
              .prepare("DELETE FROM command_results WHERE owner_id=?")
              .run(draft.id);
          }
        return null;
      },
    );
    for (const row of this.db
      .prepare(
        "SELECT * FROM definition_materials WHERE id NOT IN (SELECT material_id FROM definition_material_refs)",
      )
      .all()) {
      const material = JSON.parse(row.payload_json as string) as Material;
      this.materials.remove(material);
      this.db
        .prepare("DELETE FROM definition_materials WHERE id=?")
        .run(row.id as string);
    }
  }
  // Called inside the core delete transaction: sanitize every local evidence copy, including command caches.
  redactSource(workId: string): void {
    const sanitize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sanitize);
      if (value && typeof value === "object") {
        const v = { ...value } as Record<string, unknown>;
        if (v.workId === workId || v.workInstanceId === workId) {
          delete v.content;
          delete v.excerpt;
          if ("events" in v) v.events = [];
          if ("files" in v) v.files = [];
          if ("title" in v) v.title = "来源已删除";
          v.deleted = true;
        }
        for (const key of Object.keys(v)) v[key] = sanitize(v[key]);
        return v;
      }
      return value;
    };
    const snapshots = this.list<{ id: string; sources: { workId: string }[] }>(
      "source_snapshots",
    ).filter((s) => s.sources.some((w) => w.workId === workId));
    for (const snapshot of snapshots) {
      this.write("source_snapshots", sanitize(snapshot) as { id: string });
      for (const job of this.list<{
        id: string;
        snapshotId: string;
        status: string;
        draftId?: string;
        cancelPending?: boolean;
      }>("distillation_jobs").filter((j) => j.snapshotId === snapshot.id)) {
        delete (job as { result?: unknown }).result;
        if (job.status !== "SAVED") {
          job.status = "CANCELLED";
          job.cancelPending = true;
          if (job.draftId) {
            const draft = this.read<Draft>("definition_drafts", job.draftId);
            draft.invalidated = true;
            draft.content = draft.originalContent = {
              schemaVersion: 1,
              name: "来源已删除",
              purpose: {
                key: "deleted",
                text: "来源已删除",
                basis: { type: "INFERRED", refs: [], rationale: "来源已删除" },
              },
              inputs: [],
              deliverables: [],
              constraints: [],
              acceptanceCriteria: [],
              methods: [],
              materialRoles: [],
            };
            draft.issues = [];
            draft.resolutions = [];
            this.write("definition_drafts", draft);
            this.db
              .prepare("DELETE FROM review_events WHERE owner_id=?")
              .run(draft.id);
            this.db
              .prepare("DELETE FROM command_results WHERE owner_id=?")
              .run(draft.id);
          }
        }
        this.write("distillation_jobs", job);
      }
    }
    for (const table of [
      "work_definitions",
      "definition_drafts",
      "review_events",
      "command_results",
      "handoff_packages",
    ] as const) {
      const rows = this.db
        .prepare(
          `SELECT id,payload_json FROM ${table} WHERE payload_json IS NOT NULL`,
        )
        .all();
      for (const row of rows)
        this.db
          .prepare(`UPDATE ${table} SET payload_json=? WHERE id=?`)
          .run(
            JSON.stringify(sanitize(JSON.parse(row.payload_json as string))),
            row.id as string,
          );
    }
    this.db.prepare("DELETE FROM review_events WHERE owner_id=?").run(workId);
    this.db.prepare("DELETE FROM command_results WHERE owner_id=?").run(workId);
  }
}
