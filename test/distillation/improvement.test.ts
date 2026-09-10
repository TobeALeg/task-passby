import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ImprovementStore } from "../../server/improvement.mjs";
import { createManagedService } from "../../server/managed.mjs";
import { WorketAIClient } from "../../dist/ai-service/client.js";
import { ImprovementCollector } from "../../dist/improvement/collector.js";
import { DistillationDesktop } from "../../dist/distillation/desktop.js";
import { createWorkCore } from "../../dist/core/index.js";
import { source, FixtureClient } from "./fixtures.ts";
import { IMPROVEMENT_POLICY } from "../../dist/contracts/improvement.js";
const request = { schemaVersion: 1, snapshotHash: "hash", sources: [{ key: "work-1", events: [{ key: "event-1", sequence: 1, kind: "user.prompt", content: "synthetic-private-body <script>bad()</script>", hash: "hash" }] }] };
const upload = (id = "sample-1") => ({ schemaVersion: 1, sampleId: id, consent: { version: IMPROVEMENT_POLICY.version, at: new Date().toISOString(), scope: "DISTILLATION" }, event: { id: "event-1", kind: "SOURCE", at: new Date().toISOString(), data: { request } } });

test("improvement store: explicit consent, immutable events, isolation, restart, secure deletion, expiry, pause", () => {
  const directory = mkdtempSync(join(tmpdir(), "worket-samples-"));
  const path = join(directory, "samples.sqlite");
  let store = new ImprovementStore(path);
  try {
    const input = upload();
    assert.throws(() => store.receive("alice", { ...input, consent: { ...input.consent, version: "worket-data-v1" } }), /CONSENT_REQUIRED/);
    assert.equal(store.list().length, 0);
    const saved = store.receive("alice", input);
    store.receive("alice", input);
    assert.equal(store.get(saved.id).events.length, 1);
    assert.throws(() => store.receive("alice", { ...input, event: { ...input.event, data: { request, extra: "changed" } } }), /IDEMPOTENCY_CONFLICT/);
    const other = store.receive("bob", input);
    assert.notEqual(saved.id, other.id);
    store.delete(store.key("mallory", input.sampleId));
    assert.equal(store.list().length, 2);
    store.review(saved.id, { status: "REVIEWED", note: "Need preserve user's correction" });
    store.close(); store = new ImprovementStore(path);
    assert.equal(store.get(saved.id).review.status, "REVIEWED");
    store.setEnabled(false);
    assert.throws(() => store.receive("alice", upload("new-sample")), /COLLECTION_PAUSED/);
    store.setEnabled(true);
    store.delete(saved.id); store.delete(other.id);
    assert.equal(store.list().length, 0);
    assert.throws(() => store.receive("alice", input), /SAMPLE_DELETED/);
    assert.ok(!readFileSync(path).includes(Buffer.from("synthetic-private-body")));
    const expired = store.receive("alice", upload("expired"));
    store.db.prepare("UPDATE samples SET expires=0 WHERE id=?").run(expired.id);
    store.expire();
    assert.throws(() => store.get(expired.id), /NOT_FOUND/);
    const hidden = upload("hidden"); hidden.event.data.request = structuredClone(request);
    hidden.event.data.request.sources[0].events[0].kind = "reasoning.summary";
    assert.throws(() => store.receive("alice", hidden), /INVALID_INPUT/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("improvement HTTP: no model call, client isolation, admin auth/CSRF, pause and delete while offline", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worket-sample-http-"));
  let calls = 0;
  const service = createManagedService({ directory, providerFactory: () => ({ model: "fake", async call() { calls++; throw Error("must not call"); } }) });
  await new Promise<void>(r => service.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(service.server.address() as any).port}`;
  service.store.setup("123456");
  const alice = service.store.issue({ name: "alice", days: 1 });
  const bob = service.store.issue({ name: "bob", days: 1 });
  const client = new WorketAIClient(() => ({ url, token: alice.token, development: true }));
  const stranger = new WorketAIClient(() => ({ url, token: bob.token, development: true }));
  try {
    assert.equal((await fetch(url + "/admin/api/samples")).status, 401);
    assert.equal((await client.capabilities()).improvement.retentionDays, 90);
    const input = upload(); const saved = await client.uploadSample(input as any);
    assert.equal((await fetch(url + `/v1/improvement-samples/${input.sampleId}`, { headers: { Authorization: `Bearer ${bob.token}` } })).status, 404);
    await stranger.deleteSample(input.sampleId);
    const login = await fetch(url + "/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "123456" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const { csrf } = await login.json();
    const headers = { Cookie: cookie, "X-Worket-CSRF": csrf, "Content-Type": "application/json" };
    const list = await fetch(url + "/admin/api/samples", { headers }).then(r => r.json());
    assert.equal(list.items.length, 1);
    assert.ok(!JSON.stringify(list).includes("synthetic-private-body"));
    assert.equal((await fetch(url + `/admin/api/samples/${saved.id}`, { method: "DELETE", headers: { Cookie: cookie } })).status, 401);
    await fetch(url + "/admin/api/samples-policy", { method: "PUT", headers, body: JSON.stringify({ enabled: false }) });
    await assert.rejects(() => client.uploadSample(upload("paused") as any), /COLLECTION_PAUSED/);
    await client.deleteSample(input.sampleId);
    const after = await fetch(url + "/admin/api/samples", { headers }).then(r => r.json());
    assert.equal(after.items.length, 0);
    service.store.revoke(alice.id);
    await assert.rejects(() => client.uploadSample(upload("revoked") as any), /AUTH_EXPIRED/);
    assert.equal(calls, 0);
  } finally { await service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("local collector: submitted scopes only, durable retry, stop, service changes and deletion prevent resurrection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worket-outbox-"));
  const path = join(directory, "local.sqlite");
  let db = new DatabaseSync(path), destination = "first", offline = true;
  const store = new ImprovementStore(":memory:");
  let calls = 0;
  const client: any = {
    capabilities: async () => ({ improvement: store.policy() }),
    improvementIdentity: () => destination,
    uploadSample: async (value: any) => { calls++; if (offline) throw Error("offline"); return store.receive("alice", value); },
    deleteSample: async (id: string) => { if (offline) throw Error("offline"); return store.delete(store.key("alice", id)); },
  };
  let c = new ImprovementCollector(db, client);
  try {
    c.record("historical", "edit", "EDIT", { text: "must not collect" }); await c.flush();
    assert.equal(calls, 0);
    await c.authorize(IMPROVEMENT_POLICY.version);
    c.enroll("job", "DISTILLATION", "synthetic", { request });
    c.record("job", "edit-1", "EDIT", { text: "new revision" });
    await c.flush(); assert.equal(c.list()[0].pending, 2);
    db.close(); db = new DatabaseSync(path); c = new ImprovementCollector(db, client);
    destination = "second"; offline = false;
    await c.flush(); assert.equal(store.list().length, 0);
    destination = "first";
    await c.flush(); assert.equal(store.list()[0].eventCount, 2);
    c.record("job", "edit-1", "EDIT", { text: "same command" }); await c.flush();
    assert.equal(store.list()[0].eventCount, 2);
    c.record("job", "edit-2", "EDIT", { text: "never send" });
    c.stop(); await c.flush(); assert.equal(store.list()[0].eventCount, 2);
    c.record("job", "edit-3", "EDIT", { text: "stopped" }); assert.equal(c.list()[0].pending, 0);
    offline = true; c.remove("job"); await c.flush(); assert.equal(c.list()[0].state, "DELETE_PENDING");
    offline = false; await c.flush(); assert.equal(c.list()[0].state, "DELETED"); assert.equal(store.list().length, 0);
  } finally { db.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("improvement preference: default on, persistent opt-out, no historical restart and independent sample stop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worket-preference-"));
  const path = join(directory, "work.sqlite");
  let db = new DatabaseSync(path);
  const client: any = {
    improvementIdentity: () => "fixture",
    capabilities: async () => ({ improvement: { ...IMPROVEMENT_POLICY, enabled: true } }),
    uploadSample: async () => {}, deleteSample: async () => {},
  };
  let c = new ImprovementCollector(db, client);
  try {
    assert.equal(c.enabled(), true);
    assert.equal(c.list().length, 0);
    c.enroll("first", "DISTILLATION", "first", { request });
    c.enroll("second", "DISTILLATION", "second", { request });
    c.stop("first");
    assert.equal(c.enabled(), true);
    assert.equal(c.active().length, 1);
    c.setEnabled(false);
    assert.ok(c.list().every(s => s.state === "STOPPED" && s.pending === 0));
    await assert.rejects(() => c.authorize(IMPROVEMENT_POLICY.version), /参与改进已关闭/);
    assert.throws(() => c.enroll("blocked", "DISTILLATION", "blocked", { request }), /COLLECTION_DISABLED/);
    db.close(); db = new DatabaseSync(path); c = new ImprovementCollector(db, client);
    assert.equal(c.enabled(), false);
    await c.authorize(undefined); // Local work without improvement collection remains available.
    c.setEnabled(true);
    assert.equal(c.active().length, 0);
    c.enroll("first", "DISTILLATION", "first", { request });
    assert.equal(c.active().length, 0);
    c.enroll("new", "DISTILLATION", "new", { request });
    assert.equal(c.active().length, 1);
    c.stop();
    assert.equal(c.enabled(), false);
    assert.throws(() => c.setEnabled("false" as any), /INVALID_INPUT/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("opting out during an upload discards queued bodies and prevents further feedback", async () => {
  const db = new DatabaseSync(":memory:");
  let finishUpload!: () => void;
  const pendingUpload = new Promise<void>(resolve => { finishUpload = resolve; });
  let calls = 0;
  const c = new ImprovementCollector(db, {
    improvementIdentity: () => "fixture",
    uploadSample: async () => { calls++; await pendingUpload; },
  } as any);
  try {
    c.enroll("work", "DISTILLATION", "work", { request });
    c.record("work", "edit", "EDIT", { text: "queued feedback" });
    const flushing = c.flush();
    assert.equal(calls, 1);
    c.setEnabled(false);
    finishUpload(); await flushing;
    c.record("work", "later", "EDIT", { text: "after opt-out" });
    await c.flush();
    assert.equal(calls, 1);
    assert.equal(c.list()[0].pending, 0);
    assert.equal(c.list()[0].state, "STOPPED");
  } finally { db.close(); }
});

test("desktop collection: opted source, original candidate, edits, publication; separate reuse consent and acceptance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worket-collection-domain-"));
  const core = createWorkCore({ databasePath: join(directory, "work.sqlite") });
  const work = source(core);
  const remote = new ImprovementStore(":memory:");
  const client: any = new FixtureClient();
  client.capabilities = async () => ({ improvement: remote.policy() });
  client.improvementIdentity = () => "fixture";
  client.uploadSample = async (v: any) => remote.receive("alice", v);
  client.deleteSample = async (id: string) => remote.delete(remote.key("alice", id));
  const app: any = { core: () => core, dashboard: (id: string) => core.getWork(id) };
  const desktop = new DistillationDesktop(app, client);
  try {
    const snapshot: any = await desktop.call("prepare", { workIds: [work.instance.id], includedFileIds: [] });
    const job: any = await desktop.call("start", { preparationId: snapshot.id, expectedContentHash: snapshot.contentHash, consentVersion: "worket-data-v1", improvementConsentVersion: IMPROVEMENT_POLICY.version, commandId: "start-1" });
    await new Promise(r => setImmediate(r));
    const current: any = await desktop.call("job", { jobId: job.id });
    assert.equal(current.status, "AWAITING_REVIEW");
    let draft: any = await desktop.call("draft", { id: current.draftId });
    const originalName = draft.content.name;
    draft.content.name = "Changed by user";
    draft = await desktop.call("update", { draftId: draft.id, expectedRevision: draft.revision, content: draft.content, issueResolutions: [] });
    const definition: any = await desktop.call("publish", { draftId: draft.id, expectedRevision: draft.revision, materialBindings: {}, commandId: "publish-1" });
    await desktop.call("syncImprovement");
    const detail = remote.get(remote.list()[0].id);
    assert.equal(detail.events.find((e: any) => e.kind === "CANDIDATE").data.content.name, originalName);
    assert.equal(detail.events.find((e: any) => e.kind === "EDIT").data.content.name, "Changed by user");
    assert.equal(detail.events.find((e: any) => e.kind === "PUBLISH").data.definitionId, definition.id);
    await desktop.call("create", { definitionId: definition.id, inputs: { customer: "unconsented customer", market: "Europe" }, referenceExampleIds: [], commandId: "reuse-without-consent" });
    await desktop.call("syncImprovement"); assert.equal(remote.list().length, 1);
    const reused: any = await desktop.call("create", { definitionId: definition.id, inputs: { customer: "consented customer", market: "Europe" }, referenceExampleIds: [], commandId: "reuse-consented", improvementConsentVersion: IMPROVEMENT_POLICY.version });
    await desktop.call("syncImprovement");
    assert.equal(remote.list().length, 2);
    assert.ok(!JSON.stringify(remote.list().map((s: any) => remote.get(s.id))).includes("unconsented customer"));
    assert.equal(desktop.service.improvement.list().find(s => s.id === reused.instance.id)?.scope, "REUSE");
    const artifactPath = join(directory, "synthetic-delivery.md");
    writeFileSync(artifactPath, "synthetic result");
    const artifacts: any = await desktop.call("attach", { workId: reused.instance.id, path: artifactPath });
    const criteriaResults = Object.fromEntries(definition.content.acceptanceCriteria.map((c: any) => [c.key, "NEEDS_REVISION"]));
    await desktop.call("accept", { workId: reused.instance.id, artifactIds: [artifacts[0].id], criteriaResults, commandId: "accept-revision" });
    await desktop.call("syncImprovement");
    const reuseSample = remote.get(remote.list().find((s: any) => s.client_id === reused.instance.id).id);
    assert.deepEqual(reuseSample.events.find((e: any) => e.kind === "ACCEPTANCE").data.criteriaResults, criteriaResults);
    assert.ok(!JSON.stringify(reuseSample).includes(artifactPath));
    await desktop.call("stopImprovement");
  } finally { desktop.service.close(); core.close(); remote.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("collection size errors stop the sample without breaking local work", async () => {
  const db = new DatabaseSync(":memory:");
  const c = new ImprovementCollector(db, { improvementIdentity: () => "local" } as any);
  try {
    c.enroll("large-sample", "DISTILLATION", "large", { request });
    assert.doesNotThrow(() => c.record("large-sample", "edit", "EDIT", { text: "x".repeat(4 * 1024 * 1024) }));
    assert.equal(c.list()[0].state, "STOPPED");
    assert.equal(c.list()[0].error, "INPUT_TOO_LARGE");
    assert.equal(c.list()[0].pending, 0);
  } finally { db.close(); }
});
