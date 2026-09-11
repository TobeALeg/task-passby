import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppService } from "../../dist/app/app-service.js";
import { DistillationDesktop } from "../../dist/distillation/desktop.js";
import { WorketAIClient } from "../../dist/ai-service/client.js";
import { AutomaticConnection } from "../../dist/ai-service/connection.js";
import { createManagedService } from "../../server/managed.mjs";
import { validateSample, IMPROVEMENT_POLICY } from "../../dist/contracts/improvement.js";

function fixture() {
  const events: any[] = [];
  const add = (kind: string, content: string) => events.push({
    id: `event-${events.length}`, externalId: `event-${events.length}`,
    sequence: events.length + 1, kind, content, timestamp: new Date().toISOString(),
    executorType: kind === "user.prompt" ? "HUMAN" : "AGENT", environmentType: "fixture",
    metadata: { secret: "metadata-must-not-upload" },
  });
  const adapter: any = {
    id: "fixture", name: "Fixture", mark: "F", bundleIds: ["app.fixture"],
    environment: { type: "fixture", name: "Fixture" },
    source: { async readThread(id: string) {
      return { threadId: id, title: id, applicationTitle: id, cwd: "/tmp/private-path",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: structuredClone(events) };
    }, close() {} },
    async inspect() {}, async resolveCurrent() { return { id: "foreground", title: "foreground" }; },
  };
  return { adapter, add };
}

test("record selection uploads messages over HTTP without distillation; durable retry, boundaries, stop and delete", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worket-recording-"));
  let modelCalls = 0;
  const server = createManagedService({ directory: join(directory, "server"), automaticEnrollment: true, providerFactory: () => ({
    model: "fixture", async call() { modelCalls++; throw Error("must not call model"); },
  }) });
  await new Promise<void>(r => server.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.server.address() as any).port}`;
  let config: any = { url, token: "", development: true, installationSecret: "a".repeat(64) };
  const connection = new AutomaticConnection({ read: () => config, write: value => { config = value; } });
  const http = new WorketAIClient(() => config, () => connection.ready());
  let offline = true;
  const client: any = {
    improvementIdentity: () => http.improvementIdentity(),
    uploadSample: (v: any) => { if (offline) throw Error("offline"); return http.uploadSample(v); },
    deleteSample: (id: string) => { if (offline) throw Error("offline"); return http.deleteSample(id); },
  };
  const f = fixture();
  f.add("user.prompt", "selected user message"); f.add("agent.response", "selected AI reply");
  f.add("tool.result", "tool-must-not-upload"); f.add("reasoning.summary", "reasoning-must-not-upload");
  let desktop: DistillationDesktop;
  const open = () => {
    const app = new AppService({ databasePath: join(directory, "local.sqlite"), executors: [f.adapter],
      onRecordingStarted: id => desktop.service.recordings.start(id),
      onRecordingStopped: id => desktop.service.recordings.stop(id),
    });
    desktop = new DistillationDesktop(app, client);
    return app;
  };
  let app = open();
  server.store.setup("123456");
  let cookie = "";
  let csrf = "";
  const admin = async (path: string, method = "GET") => {
    const res = await fetch(`${url}/admin/api/${path}`, { method, headers: { Cookie: cookie, "X-Worket-CSRF": csrf } });
    assert.ok(res.ok, `admin ${path}: ${res.status}`); return res.json();
  };
  try {
    const login = await fetch(`${url}/admin/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "123456" }) });
    cookie = login.headers.get("set-cookie")!.split(";")[0]; csrf = (await login.json()).csrf;
    // A pre-existing local work remains unregistered, including after upgrade/restart.
    app.core().createWork({ definition: { key: "old", name: "old", version: 1 }, executor: { type: "AGENT", name: "Fixture" }, environment: { type: "fixture", name: "Fixture" }, source: { adapter: "fixture", conversationId: "old" } });
    desktop!.service.collectFeedback(); assert.equal(desktop!.service.improvement.list().length, 0);
    const selected = await app.createWorkFromConversation({ executorId: "fixture", threadId: "chosen" });
    const workId = selected.selectedWorkId!;
    await desktop!.call("syncImprovement");
    assert.equal(desktop!.service.improvement.list()[0].pending, 3);
    assert.equal(app.core().getWork(workId)!.sourceArchive.length, 5);
    desktop!.service.close(); app.close(); app = open();
    offline = false;
    await desktop!.call("syncImprovement");
    const rows = (await admin("samples")).items;
    assert.equal(rows.length, 1, JSON.stringify(desktop!.service.improvement.list()));
    const id = rows[0].id;
    let detail = await admin(`samples/${id}`);
    assert.equal(detail.consent.scope, "RECORDING");
    assert.equal(detail.consent.version, IMPROVEMENT_POLICY.recordingVersion);
    assert.deepEqual(detail.events.filter((e: any) => e.kind === "MESSAGE").map((e: any) => e.data.content), ["selected user message", "selected AI reply"]);
    for (const excluded of ["tool-must-not-upload", "reasoning-must-not-upload", "metadata-must-not-upload", "/tmp/private-path"]) assert.ok(!JSON.stringify(detail).includes(excluded));
    const long = "回答😀".repeat(9000);
    f.add("agent.response", long);
    await app.syncRecordedWorks(); await desktop!.call("syncImprovement");
    detail = await admin(`samples/${id}`);
    const pieces = detail.events.filter((e: any) => e.kind === "MESSAGE" && e.data.sequence === 5);
    assert.equal(pieces.map((e: any) => e.data.content).join(""), long);
    const count = detail.events.length;
    await desktop!.call("syncImprovement"); assert.equal((await admin(`samples/${id}`)).events.length, count);
    // Closing preference discards pending data and does not restart old subscriptions.
    offline = true; f.add("user.prompt", "discard-on-opt-out");
    await app.syncRecordedWorks(); await desktop!.call("syncImprovement");
    await desktop!.call("setImprovementPreference", { enabled: false });
    offline = false; await desktop!.call("syncImprovement");
    assert.equal((await admin(`samples/${id}`)).events.length, count);
    await desktop!.call("setImprovementPreference", { enabled: true });
    await desktop!.call("syncImprovement"); assert.equal((await admin("samples")).items.length, 1);
    app.completeWork(workId); app.resumeWork(workId);
    await desktop!.call("syncImprovement"); assert.equal((await admin("samples")).items.length, 2);
    offline = true; f.add("user.prompt", "cancel-pending"); await app.syncRecordedWorks();
    await desktop!.call("syncImprovement"); app.cancelRecording(workId, "取消记录");
    offline = false; await desktop!.call("syncImprovement");
    for (const row of (await admin("samples")).items) assert.ok(!JSON.stringify(await admin(`samples/${row.id}`)).includes("cancel-pending"));
    for (const sample of desktop!.service.improvement.list()) await desktop!.call("deleteImprovement", { id: sample.id, confirmation: "删除样本" });
    // deleteImprovement starts async flush; wait for it, then drain any later delete commands.
    while (desktop!.service.improvement.busy) await new Promise(r => setTimeout(r, 5));
    await desktop!.call("syncImprovement"); assert.equal((await admin("samples")).items.length, 0);
    assert.equal(modelCalls, 0);
  } finally { desktop!.service.close(); app.close(); await server.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("recording protocol rejects old consent, hidden events, and extra metadata", () => {
  const input: any = { schemaVersion: 1, sampleId: "recording", consent: { scope: "RECORDING", version: IMPROVEMENT_POLICY.recordingVersion, at: new Date().toISOString() }, event: { id: "message", kind: "MESSAGE", at: new Date().toISOString(), data: { sourceEventId: "event", sequence: 1, kind: "user.prompt", timestamp: new Date().toISOString(), content: "hello", part: 0, parts: 1 } } };
  assert.doesNotThrow(() => validateSample(input));
  const old = structuredClone(input); old.consent.version = IMPROVEMENT_POLICY.version;
  assert.throws(() => validateSample(old), /CONSENT_REQUIRED/);
  const hidden = structuredClone(input); hidden.event.data.kind = "reasoning.summary";
  assert.throws(() => validateSample(hidden), /INVALID_INPUT/);
  const extra = structuredClone(input); extra.event.data.metadata = { path: "/private" };
  assert.throws(() => validateSample(extra), /INVALID_INPUT/);
});
