import { makeService } from "../helpers/app-options.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkCore } from "../../dist/core/index.js";
import { DistillationService } from "../../dist/distillation/service.js";
import { buildWorkPackage } from "../../dist/definitions/work-package.js";
import { validateResult } from "../../dist/contracts/definition.js";
import { source, FixtureClient, result } from "./fixtures.ts";
const cid = () => randomUUID();
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "worket-definition-"));
  const core = createWorkCore({ databasePath: join(directory, "work.sqlite") });
  const work = source(core);
  const client = new FixtureClient();
  const service = new DistillationService(core, client);
  const snapshot = service.prepare({
    workIds: [work.instance.id],
    includedFileIds: [],
  });
  return { directory, core, work, client, service, snapshot };
}
async function review(f: any) {
  const job = f.service.start({
    preparationId: f.snapshot.id,
    expectedContentHash: f.snapshot.contentHash,
    consentVersion: "worket-data-v1",
    commandId: cid(),
  });
  await new Promise((r) => setImmediate(r));
  const current = await f.service.get(job.id);
  assert.equal(current.status, "AWAITING_REVIEW");
  return f.core.definitions.read("definition_drafts", current.draftId);
}
function publish(f: any, draft: any, bindings = {}) {
  return f.core.definitions.publish({
    draftId: draft.id,
    expectedRevision: draft.revision,
    materialBindings: bindings,
    commandId: cid(),
  });
}
function create(f: any, d: any) {
  return f.core.createWorkFromDefinition({
    definitionId: d.id,
    inputs: { customer: "客户丙", market: "欧洲" },
    referenceExampleIds: [],
    commandId: cid(),
  });
}

test("A01/A02 prepare, viewing and completion never call definition model", async () => {
  const f = await setup();
  f.core.getWork(f.work.instance.id);
  f.core.createHandoffPackage(f.work.instance.id);
  f.core.completeWork(f.work.instance.id);
  assert.equal(f.client.calls, 0);
  f.core.close();
});
test("A10/A15 candidate publication and new instance leave source untouched and contain only new inputs", async () => {
  const f = await setup(),
    before = f.core.getWork(f.work.instance.id),
    draft = await review(f),
    definition = publish(f, draft),
    work = create(f, definition);
  assert.deepEqual(f.core.getWork(f.work.instance.id), before);
  assert.notEqual(work.instance.id, f.work.instance.id);
  assert.equal(work.activeBinding, null);
  assert.equal(work.activeEpisode, null);
  assert.equal(work.definition.id, definition.id);
  assert.deepEqual(work.state.completedActions, []);
  assert.deepEqual(work.state.decisions, []);
  assert.deepEqual(work.state.pendingActions, []);
  assert.equal(work.sourceArchive.length, 2);
  assert.ok(
    work.state.facts.every((i: any) =>
      work.sourceArchive.some((e: any) => i.sourceMessageIds.includes(e.id)),
    ),
  );
  const pkg = buildWorkPackage(work, f.core.definitions);
  assert.equal(pkg.purpose, "START");
  assert.equal(pkg.inputs.customer, "客户丙");
  assert.ok(!JSON.stringify(pkg).includes("客户甲"));
  assert.deepEqual(pkg.referenceExamples, []);
  assert.throws(
    () => f.core.completeWork(work.instance.id),
    /USER_ACCEPTANCE_REQUIRED/,
  );
  f.core.close();
});
test("A11 preparation change rejected, submitted snapshot stays fixed", async () => {
  const f = await setup();
  const draft = await review(f);
  f.core.appendSourceEvents(f.work.instance.id, [
    {
      externalId: cid(),
      sequence: 2,
      kind: "user.prompt",
      content: "新增敏感内容",
      timestamp: new Date().toISOString(),
      executorType: "HUMAN",
      environmentType: "CODEX_DESKTOP",
      metadata: {},
      artifactRefs: [],
    },
  ]);
  assert.ok(!JSON.stringify(f.client.request).includes("新增敏感内容"));
  assert.throws(
    () =>
      f.service.start({
        preparationId: f.snapshot.id,
        expectedContentHash: f.snapshot.contentHash,
        consentVersion: "worket-data-v1",
        commandId: cid(),
      }),
    /SOURCE_CHANGED/,
  );
  assert.ok(publish(f, draft).id);
  f.core.close();
});
test("A09 rejects forged reference, missing coverage, undeclared variables and model authored provenance", async () => {
  const f = await setup(),
    request = f.service.wire(f.snapshot);
  for (const mutate of [
    (r: any) => (r.content.purpose.basis.refs[0].eventId = "fake"),
    (r: any) => (r.coverage.processedEvents = 0),
    (r: any) => (r.content.purpose.text = "{{undeclared}}"),
    (r: any) =>
      (r.content.purpose.basis = {
        type: "USER_AUTHORED",
        reviewEventId: "fake",
      }),
  ]) {
    const r = result(request);
    mutate(r);
    assert.throws(() => validateResult(r, request));
  }
  f.core.close();
});
test("A06 unrelated records cannot publish; A07 unresolved conflicts block", async () => {
  const f = await setup();
  f.client.get = async (id: string) => {
    const r: any = result(f.client.request);
    r.compatibility = "UNRELATED";
    r.content = null;
    r.groups = [{ sourceKeys: ["work-1"], reason: "不同工作" }];
    return { requestId: id, status: "SUCCEEDED", result: r };
  };
  const job = f.service.start({
    preparationId: f.snapshot.id,
    expectedContentHash: f.snapshot.contentHash,
    consentVersion: "worket-data-v1",
    commandId: cid(),
  });
  await new Promise((r) => setImmediate(r));
  assert.equal((await f.service.get(job.id)).status, "NEEDS_SELECTION");
  assert.equal(f.core.definitions.definitions().items.length, 0);
  f.core.close();
});
test("A17 submit/publish/create same key idempotent and different payload conflicts", async () => {
  const f = await setup();
  const command = {
    preparationId: f.snapshot.id,
    expectedContentHash: f.snapshot.contentHash,
    consentVersion: "worket-data-v1",
    commandId: cid(),
  };
  assert.equal(f.service.start(command).id, f.service.start(command).id);
  await new Promise((r) => setImmediate(r));
  assert.equal(f.client.calls, 1);
  const job = await f.service.get(f.service.start(command).id);
  const draft = f.core.definitions.read<any>("definition_drafts", job.draftId!);
  const pub = {
    draftId: draft.id,
    expectedRevision: draft.revision,
    materialBindings: {},
    commandId: cid(),
  };
  const d = f.core.definitions.publish(pub);
  assert.equal(f.core.definitions.publish(pub).id, d.id);
  assert.throws(
    () => f.core.definitions.publish({ ...pub, expectedRevision: 99 }),
    /IDEMPOTENCY_CONFLICT/,
  );
  const input = {
    definitionId: d.id,
    inputs: { customer: "C", market: "EU" },
    referenceExampleIds: [],
    commandId: cid(),
  };
  assert.equal(
    f.core.createWorkFromDefinition(input).instance.id,
    f.core.createWorkFromDefinition(input).instance.id,
  );
  assert.throws(
    () =>
      f.core.createWorkFromDefinition({
        ...input,
        inputs: { customer: "D", market: "EU" },
      }),
    /IDEMPOTENCY_CONFLICT/,
  );
  f.core.close();
});
test("A14/A24 immutable versions, revision conflicts and no empty versions", async () => {
  const f = await setup(),
    draft = await review(f),
    v1 = publish(f, draft),
    work = create(f, v1);
  let revision = f.core.definitions.revise({
    definitionId: v1.id,
    commandId: cid(),
  });
  assert.equal(publish(f, revision).id, v1.id);
  revision = f.core.definitions.revise({
    definitionId: v1.id,
    commandId: cid(),
  });
  const content = structuredClone(revision.content);
  content.constraints[0].text = "同时附上来源日期";
  const v2draft = f.core.definitions.update({
    draftId: revision.id,
    expectedRevision: 1,
    content,
    issueResolutions: [],
  });
  assert.throws(
    () =>
      f.core.definitions.update({
        draftId: revision.id,
        expectedRevision: 1,
        content,
        issueResolutions: [],
      }),
    /REVISION_CONFLICT/,
  );
  const v2 = publish(f, v2draft);
  assert.equal(v2.version, 2);
  assert.equal(f.core.getWork(work.instance.id)!.definition.version, 1);
  assert.equal(
    buildWorkPackage(f.core.getWork(work.instance.id)!, f.core.definitions)
      .definition!.content.constraints[0]!.text,
    v1.content.constraints[0].text,
  );
  assert.equal(v2.content.constraints[0].basis.type, "USER_AUTHORED");
  f.core.close();
});
test("A08 issue requires concrete field edit or explicit choice; save does not relabel agent provenance", async () => {
  const f = await setup(),
    draft = await review(f);
  draft.content.methods = [
    {
      key: "step",
      text: "执行建议步骤",
      obligation: "REQUIRED",
      basis: {
        type: "SOURCE",
        origin: "AGENT_PROPOSED",
        refs: [
          {
            snapshotId: f.snapshot.id,
            workId: f.work.instance.id,
            eventId: f.work.sourceArchive[0].id,
          },
        ],
      },
    },
  ];
  draft.issues = [
    {
      id: "conflict",
      type: "CONFLICT",
      field: "constraints.sources",
      message: "要求冲突",
      blocking: true,
    },
  ];
  f.core.definitions.write("definition_drafts", draft);
  assert.throws(() => publish(f, draft), /UNRESOLVED_ISSUES/);
  const content = structuredClone(draft.content);
  content.name = "仅改名称";
  assert.throws(
    () =>
      f.core.definitions.update({
        draftId: draft.id,
        expectedRevision: 1,
        content,
        issueResolutions: [
          { issueId: "conflict", action: "REWRITE", explanation: "已改" },
        ],
      }),
    /UNRESOLVED_ISSUES/,
  );
  f.core.close();
});
test("A16 fixed materials survive original deletion, missing copy blocks reuse", async () => {
  const f = await setup(),
    draft = await review(f);
  draft.content.materialRoles = [
    {
      key: "template",
      text: "报告模板",
      required: true,
      basis: draft.content.purpose.basis,
    },
  ];
  f.core.definitions.write("definition_drafts", draft);
  const path = join(f.directory, "template.md");
  writeFileSync(path, "fixed template");
  const d = publish(f, draft, { template: path });
  unlinkSync(path);
  const work = create(f, d);
  assert.ok(work.instance.id);
  assert.equal(readFileSync(d.materials[0].path, "utf8"), "fixed template");
  unlinkSync(d.materials[0].path);
  assert.throws(() => create(f, d), /MATERIAL_MISSING/);
  f.core.close();
});
test("A13 cancelled late result discarded and source deletion invalidates draft", async () => {
  const f = await setup();
  const job = f.service.start({
    preparationId: f.snapshot.id,
    expectedContentHash: f.snapshot.contentHash,
    consentVersion: "worket-data-v1",
    commandId: cid(),
  });
  await new Promise((r) => setImmediate(r));
  await f.service.cancel(job.id);
  await f.service.receive(job, {
    requestId: "x",
    status: "SUCCEEDED",
    result: result(f.client.request) as any,
  });
  assert.equal((await f.service.get(job.id)).status, "CANCELLED");
  assert.equal(f.core.definitions.list("definition_drafts").length, 0);
  f.core.close();
});
test("A26 delete source clears snapshot file body and excerpts, keeps confirmed version, prevents deleting in-use definition", async () => {
  const f = await setup(),
    draft = await review(f);
  const file = join(f.directory, "sensitive.md");
  writeFileSync(file, "EXCLUSIVE_SECRET_SOURCE");
  const a = f.core.addArtifactRef(f.work.instance.id, {
    path: file,
    filename: "sensitive.md",
    role: "source",
    mimeType: null,
    size: 23,
    sha256: (await import("../../dist/definitions/storage.js")).hash(
      "EXCLUSIVE_SECRET_SOURCE",
    ),
    lastModifiedAt: new Date().toISOString(),
    availability: "AVAILABLE",
  }).artifactRefs[0]!;
  f.service.prepare({ workIds: [f.work.instance.id], includedFileIds: [a.id] });
  const d = publish(f, draft),
    work = create(f, d);
  assert.throws(
    () =>
      f.core.definitions.delete({
        definitionKey: d.definitionKey,
        confirmation: "永久删除",
        commandId: cid(),
      }),
    /DEFINITION_IN_USE/,
  );
  f.core.deleteWorkPermanently(f.work.instance.id, {
    confirmation: f.work.instance.id,
  });
  assert.ok(
    !JSON.stringify(f.core.definitions.list("source_snapshots")).includes(
      "EXCLUSIVE_SECRET_SOURCE",
    ),
  );
  assert.equal(f.core.definitions.get(d.id).refs[0]!.deleted, true);
  assert.equal(
    existsSync(join(f.directory, "work.sqlite.before-distillation-v1.bak")),
    false,
  );
  assert.ok(
    buildWorkPackage(f.core.getWork(work.instance.id)!, f.core.definitions),
  );
  f.core.close();
});
test("A20 acceptance requires current artifacts and all checks pass; needs revision remains OPEN", async () => {
  const f = await setup(),
    d = publish(f, await review(f)),
    w = create(f, d);
  assert.throws(
    () =>
      f.core.definitions.accept({
        workId: w.instance.id,
        artifactIds: [],
        criteriaResults: { traceable: "PASS" },
        commandId: cid(),
      }),
    /MATERIAL_MISSING/,
  );
  const path = join(f.directory, "output.md");
  writeFileSync(path, "current delivery");
  const a = f.core.addArtifactRef(w.instance.id, {
    path,
    filename: "output.md",
    role: "DELIVERABLE",
    mimeType: null,
    size: 16,
    sha256: (await import("../../dist/definitions/storage.js")).hash(
      "current delivery",
    ),
    lastModifiedAt: new Date().toISOString(),
    availability: "AVAILABLE",
  }).artifactRefs[0]!;
  const args = { workId: w.instance.id, artifactIds: [a.id] };
  f.core.definitions.accept({
    ...args,
    criteriaResults: { traceable: "NEEDS_REVISION" },
    commandId: cid(),
  });
  assert.equal(f.core.getWork(w.instance.id)!.instance.status, "OPEN");
  f.core.definitions.accept({
    ...args,
    criteriaResults: { traceable: "PASS" },
    commandId: cid(),
  });
  assert.equal(f.core.getWork(w.instance.id)!.instance.status, "COMPLETED");
  f.core.close();
});
test("A21/A22 restart retains definitions, inputs and archive with migration backup", async () => {
  const f = await setup(),
    d = publish(f, await review(f)),
    work = create(f, d);
  f.core.archiveWork(f.work.instance.id);
  f.core.close();
  assert.ok(
    existsSync(join(f.directory, "work.sqlite.before-distillation-v1.bak")),
  );
  const reopened = createWorkCore({
    databasePath: join(f.directory, "work.sqlite"),
  });
  assert.equal(
    reopened.getWork(f.work.instance.id)!.instance.status,
    "ARCHIVED",
  );
  assert.equal(reopened.getWork(work.instance.id)!.definition.id, d.id);
  assert.equal(reopened.definitions.definitions().items.length, 1);
  assert.equal(
    reopened.definitions.inputs(work.instance.id).inputs.customer,
    "客户丙",
  );
  reopened.close();
});

test("A19 actual Hook binding and MCP read evidence gate reusable dispatch; launch failure preserves inputs", async () => {
  const { AppService } = await import("../../dist/app/app-service.js");
  const { DistillationDesktop } =
    await import("../../dist/distillation/desktop.js");
  const { WorkPetMcpHandler } =
    await import("../../dist/bridge/mcp-handler.js");
  const directory = mkdtempSync(join(tmpdir(), "worket-dispatch-"));
  let launches = 0,
    fail = false;
  const launcher = {
    async openNewConversation() {
      launches++;
      if (fail) throw new Error("EXECUTOR_UNAVAILABLE");
    },
  };
  const app = makeService({
    databasePath: join(directory, "work.sqlite"),
    launcher,
    codex: {
      async listRecentThreads() {
        return [];
      },
      async readThread() {
        throw new Error("unavailable");
      },
      close() {},
    },
    foreground: {
      async current() {
        return null;
      },
    } as any,
  });
  const core = app.core(),
    original = source(core),
    client = new FixtureClient(),
    desktop = new DistillationDesktop(app, client as any),
    snapshot = desktop.service.prepare({
      workIds: [original.instance.id],
      includedFileIds: [],
    }),
    f = { core, service: desktop.service, snapshot };
  const d = publish(f, await review(f)),
    work = create(f, d),
    command = { workId: work.instance.id, commandId: cid(),executorId:"workbuddy" };
  await desktop.dispatch(command);
  await desktop.dispatch(command);
  assert.equal(launches, 1);
  assert.ok(core.getWork(work.instance.id)!.activeBinding?.conversationId.startsWith("pending:"));
  assert.equal(
    app.dashboard(work.instance.id).selectedWork!.captureStatus,
    "waiting",
  );
  await app.syncHook("workbuddy", {
    hook_event_name: "UserPromptSubmit",
    session_id: "real-session",
    prompt: `[WORKPET:${work.instance.id}] [DELIVERY:${core.getWork(work.instance.id)!.activeBinding!.conversationId.slice(8)}] 读取工作包`,
    turn_id: "one",
  });
  assert.equal(
    core.getWork(work.instance.id)!.activeBinding!.conversationId,
    "real-session",
  );
  assert.equal(
    app.dashboard(work.instance.id).selectedWork!.captureStatus,
    "waiting",
  );
  const mcp = new WorkPetMcpHandler(core);
  const response: any = mcp.handle({
    id: 1,
    method: "tools/call",
    params: {
      name: "get_work_context",
      arguments: { work_id: work.instance.id },
    },
  });
  assert.ok(!response.error);
  assert.equal(
    JSON.parse(response.result.content[0].text).workPackage.inputs.customer,
    "客户丙",
  );
  assert.equal(
    app.dashboard(work.instance.id).selectedWork!.captureStatus,
    "recording",
  );
  const another = create(f, d);
  fail = true;
  await assert.rejects(
    desktop.dispatch({ workId: another.instance.id, commandId: cid(),executorId:"workbuddy" }),
    /EXECUTOR_UNAVAILABLE/,
  );
  assert.equal(core.getWork(another.instance.id)!.activeBinding, null);
  assert.equal(
    core.definitions.inputs(another.instance.id).inputs.customer,
    "客户丙",
  );
  app.close();
});

test("A10 identical keys in separate collections retain their distinct provenance", async () => {
  const f = await setup(),
    draft = await review(f);
  draft.content.constraints[0].key = "shared";
  draft.content.acceptanceCriteria[0].key = "shared";
  draft.content.acceptanceCriteria[0].basis = {
    type: "INFERRED",
    refs: [],
    rationale: "可判断的完成标准",
  };
  f.core.definitions.write("definition_drafts", draft);
  const updated = f.core.definitions.update({
    draftId: draft.id,
    expectedRevision: 1,
    content: draft.content,
    issueResolutions: [],
  });
  assert.equal(updated.content.constraints[0].basis.type, "SOURCE");
  assert.equal(updated.content.acceptanceCriteria[0].basis.type, "INFERRED");
  f.core.close();
});
test("resolved field changes can be saved then published without redoing the same edit", async () => {
  const f = await setup(),
    draft = await review(f);
  draft.issues = [
    {
      id: "issue",
      field: "constraints.sources",
      type: "CONFLICT",
      message: "选择来源范围",
      blocking: true,
    },
  ];
  f.core.definitions.write("definition_drafts", draft);
  const content = structuredClone(draft.content);
  content.constraints[0].text = "事实均引用可追溯的原始资料";
  const resolution = {
    issueId: "issue",
    action: "REWRITE",
    explanation: "统一为原始来源",
  };
  const first = f.core.definitions.update({
    draftId: draft.id,
    expectedRevision: 1,
    content,
    issueResolutions: [resolution],
  });
  const again = f.core.definitions.update({
    draftId: draft.id,
    expectedRevision: first.revision,
    content: first.content,
    issueResolutions: [resolution],
  });
  assert.ok(publish(f, again).id);
  f.core.close();
});

test("A21 old binary schema initialization is blocked before accessing upgraded records", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { createSchema } = await import("../../dist/core/schema.js");
  const f = await setup();
  const d = publish(f, await review(f));
  const id = create(f, d).instance.id;
  f.core.close();
  const legacy = new DatabaseSync(join(f.directory, "work.sqlite"));
  assert.throws(() => createSchema(legacy), /view|column/i);
  legacy.close();
  const current = createWorkCore({
    databasePath: join(f.directory, "work.sqlite"),
  });
  assert.equal(current.getWork(id)!.definition.id, d.id);
  current.close();
});

test("A09 malformed remote result becomes FAILED instead of polling as RUNNING forever", async () => {
  const f = await setup();
  f.client.get = async (id: string) =>
    ({
      requestId: id,
      status: "SUCCEEDED",
      result: { schemaVersion: 999 },
    }) as any;
  const job = f.service.start({
    preparationId: f.snapshot.id,
    expectedContentHash: f.snapshot.contentHash,
    consentVersion: "worket-data-v1",
    commandId: cid(),
  });
  await new Promise((r) => setImmediate(r));
  const failed = await f.service.get(job.id);
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error!, /INVALID_MODEL_OUTPUT/);
  assert.equal(f.core.definitions.list("definition_drafts").length, 0);
  f.core.close();
});

test('MCP read preceding Hook is retained independently of the later session binding',async()=>{
 const f=await setup(),definition=publish(f,await review(f)),work=create(f,definition);f.core.definitions.db.prepare("INSERT INTO pending_dispatches VALUES (?,?,'WAITING',NULL)").run(work.instance.id,cid());const {WorkPetMcpHandler}=await import('../../dist/bridge/mcp-handler.js');const mcp=new WorkPetMcpHandler(f.core);mcp.handle({id:1,method:'tools/call',params:{name:'get_work_context',arguments:{work_id:work.instance.id}}});assert.ok(f.core.getWork(work.instance.id)!.packageReadAt);assert.equal(f.core.getWork(work.instance.id)!.activeBinding,null);f.core.close();
});

test('cancel while reading capabilities never submits source content afterward',async()=>{
 const f=await setup();let release!:()=>void;f.client.capabilities=async()=>{await new Promise<void>(resolve=>release=resolve);return {};};const job=f.service.start({preparationId:f.snapshot.id,expectedContentHash:f.snapshot.contentHash,consentVersion:'worket-data-v1',commandId:cid()});await f.service.cancel(job.id);release();await new Promise(r=>setImmediate(r));assert.equal(f.client.calls,0);assert.equal((await f.service.get(job.id)).status,'CANCELLED');f.core.close();
});
