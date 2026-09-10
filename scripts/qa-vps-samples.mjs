// Live HTTPS/collector/admin QA. Synthetic samples only; no model or executor calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium, _electron as electron } from "playwright";
import { AutomaticConnection } from "../dist/ai-service/connection.js";
import { WorketAIClient } from "../dist/ai-service/client.js";
import { ImprovementCollector } from "../dist/improvement/collector.js";
import { IMPROVEMENT_POLICY } from "../dist/contracts/improvement.js";

const url = "https://124.223.223.215";
const directory = mkdtempSync(join(tmpdir(), "worket-vps-samples-"));
const output = join(process.cwd(), "output/vps-samples");
mkdirSync(output, { recursive: true });
const credentials = JSON.parse(readFileSync(".worket-server/vps-admin-access.json", "utf8"));
const adminUrl = process.env.WORKET_QA_ADMIN_URL ?? "http://127.0.0.1:8789";
const marker = `WORKET-SYNTHETIC-${randomUUID().slice(0, 8)}`;
let config = { url: "", token: "" };
const store = { read: () => config, write: value => { config = value; } };
let connection = new AutomaticConnection(store, url);
const client = new WorketAIClient(store.read, () => connection.ready());
let db = new DatabaseSync(join(directory, "collector.sqlite"));
let collector = new ImprovementCollector(db, client);
let app, browser;
async function launch() {
  app = await electron.launch({
    executablePath: join(process.cwd(), "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    args: [".", `--user-data-dir=${join(directory, "desktop")}`, "--dev"],
    env: { ...process.env, WORKPET_SKIP_INTEGRATIONS: "1", WORKPET_DATA_DIR: join(directory, "desktop"),
      WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json"), WORKET_SERVICE_URL: url },
  });
  let panel;
  for (let i = 0; i < 100; i++) {
    panel = app.windows().find(p => p.url().endsWith("/panel.html"));
    if (panel) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(panel);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html"))?.show());
  return panel;
}
try {
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/admin/`)).status, 404);
  assert.equal((await fetch(`${url}/v1/capabilities`)).status, 401);
  connection.initialize();
  const destination = client.improvementIdentity();
  await collector.authorize(IMPROVEMENT_POLICY.version);
  assert.equal(client.improvementIdentity(), destination);
  const subject = config.subject;
  connection = new AutomaticConnection(store, url);
  config.expiresAt = new Date(0).toISOString();
  await connection.ready();
  assert.equal(config.subject, subject);
  assert.equal(client.improvementIdentity(), destination);
  const sourceId = randomUUID(), reuseId = randomUUID();
  const request = { schemaVersion: 1, snapshotHash: "synthetic", sources: [{ key: "work-1", events: [
    { key: "event-1", sequence: 1, kind: "user.prompt", content: `${marker}：合成项目周报材料，用于验证数据传输。`, hash: "synthetic" },
  ] }] };
  collector.enroll(sourceId, "DISTILLATION", marker, { request, synthetic: true });
  for (const kind of ["CANDIDATE", "EDIT", "PUBLISH"]) collector.record(sourceId, kind, kind, { synthetic: true, marker, text: `合成 ${kind} 事件；没有执行真实沉淀。` });
  collector.enroll(reuseId, "REUSE", marker, { synthetic: true, marker, inputs: { project: "测试项目" } });
  collector.record(reuseId, "acceptance", "ACCEPTANCE", { synthetic: true, marker, text: "合成验收事件；没有执行真实工作。" });
  await collector.flush();
  assert.ok(collector.list().every(s => s.pending === 0 && !s.error));

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await admin.goto(`${adminUrl}/admin/`);
  await admin.locator("#admin-password").fill(credentials.password);
  await admin.locator("#login-submit").click();
  await admin.locator('[data-tab="samples"]').click();
  const list = () => admin.evaluate(() => fetch("/admin/api/samples").then(r => r.json()));
  const owned = (await list()).items.filter(s => s.subject === subject);
  assert.equal(owned.length, 2);
  const savedSource = owned.find(s => s.client_id === sourceId);
  assert.ok(savedSource);
  const details = await admin.evaluate(ids => Promise.all(ids.map(id => fetch(`/admin/api/samples/${id}`).then(r => r.json()))), owned.map(s => s.id));
  const kinds = details.flatMap(s => s.events).map(e => e.kind);
  for (const kind of ["SOURCE", "CANDIDATE", "EDIT", "PUBLISH", "REUSE", "ACCEPTANCE"]) assert.ok(kinds.includes(kind), kind);
  const stranger = await fetch(`${url}/v1/installations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "") }) }).then(r => r.json());
  await new WorketAIClient(() => ({ url, token: stranger.token })).deleteSample(sourceId);
  assert.ok((await list()).items.some(s => s.id === savedSource.id), "另一安装不能删除当前安装样本");
  await admin.locator("#samples-list .client-item").filter({ hasText: `自动接入 ${subject.slice(0, 8)}` }).filter({ hasText: "工作沉淀" }).getByRole("button").click();
  await admin.locator("#sample-detail details").first().locator("summary").first().click();
  await admin.screenshot({ path: join(output, "01-admin-sample.png"), fullPage: true });
  collector.setEnabled(false);
  collector.record(sourceId, "after-stop", "EDIT", { marker, mustNotUpload: true });
  await collector.flush();
  assert.equal((await list()).items.find(s => s.id === savedSource.id).eventCount, 4);
  collector.remove(reuseId); await collector.flush();
  assert.equal(collector.list().find(s => s.id === reuseId).state, "DELETED");
  assert.ok(!(await list()).items.some(s => s.client_id === reuseId));
  db.close(); db = new DatabaseSync(join(directory, "collector.sqlite"));
  collector = new ImprovementCollector(db, client);
  assert.equal(collector.enabled(), false);
  assert.equal(collector.list().find(s => s.id === reuseId).state, "DELETED");
  console.log("VPS 样本接收、管理查看、跨安装隔离、停止与删除已通过（全部为合成材料）");

  let panel = await launch();
  assert.equal((await panel.evaluate(() => window.workpet.getWorketServiceStatus())).automatic, true);
  await panel.locator(".secondary-menu summary").click();
  await panel.locator("#service-settings").click();
  await panel.locator("#check-service").click();
  await panel.getByText("已连接", { exact: true }).waitFor({ timeout: 25000 });
  assert.equal((await panel.evaluate(() => window.workpet.getWorketServiceStatus())).hasCredential, true);
  await panel.screenshot({ path: join(output, "02-desktop-connected.png") });
  await panel.locator("#improvement-data").click();
  assert.equal(await panel.locator("#improvement-consent").isChecked(), true);
  await panel.locator("#improvement-consent").uncheck();
  await panel.waitForFunction(() => !document.querySelector("#improvement-consent")?.disabled);
  await panel.screenshot({ path: join(output, "03-desktop-opt-out.png") });
  await app.close(); app = null;
  panel = await launch();
  assert.equal((await panel.evaluate(() => window.workpet.getWorketServiceStatus())).hasCredential, true);
  assert.deepEqual(await panel.evaluate(() => window.workpet.distillation("improvementPreference", {})), { enabled: false });
  await panel.evaluate(() => window.workpet.distillation("capabilities", {}));
  // Remove only earlier synthetic artifacts from this QA script, retaining one inspectable example.
  const session = await admin.evaluate(() => fetch("/admin/api/session").then(r => r.json()));
  for (const sample of (await list()).items) {
    if (sample.id === savedSource.id) continue;
    const detail = await admin.evaluate(id => fetch(`/admin/api/samples/${id}`).then(r => r.json()), sample.id);
    if (!detail.events?.length || !detail.events.every(e => e.data.synthetic === true) ||
      !JSON.stringify(detail.events).includes("WORKET-SYNTHETIC-")) continue;
    const status = await admin.evaluate(async ({ id, csrf }) => (await fetch(`/admin/api/samples/${id}`, {
      method: "DELETE", headers: { "X-Worket-CSRF": csrf },
    })).status, { id: sample.id, csrf: session.csrf });
    assert.equal(status, 200);
  }
  await admin.evaluate(async ({ id, csrf, marker }) => {
    const response = await fetch(`/admin/api/samples/${id}`, { method: "PUT", headers: {
      "Content-Type": "application/json", "X-Worket-CSRF": csrf,
    }, body: JSON.stringify({ status: "REVIEWED", note: `${marker}：VPS 数据传输验收专用合成样本，不是真实用户或模型产出。` }) });
    if (!response.ok) throw Error("QA review failed");
  }, { id: savedSource.id, csrf: session.csrf, marker });
  await Promise.all([
    admin.waitForResponse(response => response.url().endsWith("/admin/api/samples") && response.ok()),
    admin.locator("#refresh-samples").click(),
  ]);
  await admin.locator("#samples-list .client-item").filter({ hasText: `自动接入 ${subject.slice(0, 8)}` }).getByRole("button", { name: /工作沉淀/ }).click();
  await admin.locator("#sample-detail details").first().locator("summary").first().click();
  await admin.screenshot({ path: join(output, "04-final-admin-sample.png"), fullPage: true });
  const report = { passed: true, marker, subject, retainedSourceSample: savedSource.id, https: true,
    desktopAutomaticConnection: true, collectorUpload: true, adminUi: true, installationIsolation: true,
    stableRenewalIdentity: true, stopPreventsUpload: true, deletionConfirmed: true, desktopRestartOptOut: true,
    syntheticEvents: true, realModel: false, realExecutor: false, desktopPackaged: false };
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close(); await browser?.close(); db.close();
}
