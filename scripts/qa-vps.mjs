// Explicit live QA: uploads synthetic work only and makes real configured model calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { _electron as electron, chromium } from "playwright";
import { createWorkCore } from "../dist/core/index.js";
import { source } from "../test/distillation/fixtures.ts";

assert.ok(process.argv.includes("--live-model"), "需要 --live-model，确认使用合成材料执行真实模型调用");
const output = join(process.cwd(), "output", "vps-live");
mkdirSync(output, { recursive: true });
const resumed = process.argv.includes("--resume-feedback")
  ? JSON.parse(readFileSync(join(output, "run.json"), "utf8")) : null;
const directory = resumed?.directory ?? mkdtempSync(join(tmpdir(), "worket-vps-live-"));
const marker = resumed?.marker ?? `WORKET-QA-${randomUUID().slice(0, 8)}`;
writeFileSync(join(output, "run.json"), JSON.stringify({ marker, directory }, null, 2));
if (!resumed) {
  const core = createWorkCore({ databasePath: join(directory, "workpet.sqlite") });
  const original = source(core, `${marker}，端到端验证专用合成材料。请完成一项可复用工作：项目周报整理。每次输入恰好是两个必填文本字段：project_name（项目名称）和 progress_notes（本周进展记录）。目标：仅依据本次输入整理周报。交付物：一份 Markdown 周报，包含状态、已完成事项、风险、下一步四个小节。约束：不虚构事实，不查询外部资料，不发送消息；没有记录的事项明确写未提供。验收标准：四个小节齐全，事实均来自本次输入，未提供的信息明确标记。无固定附件或材料，方法仅供参考。本次项目叫测试项目甲，进展是文档已完成、界面待验收，风险未提供，下一步检查界面。`);
  core.completeWork(original.instance.id);
  core.close();
}
const credentials = JSON.parse(readFileSync(".worket-server/vps-admin-access.json", "utf8"));
const adminUrl = process.env.WORKET_QA_ADMIN_URL ?? "http://127.0.0.1:8789";
let app, panel, browser;
async function launch() {
  app = await electron.launch({
    executablePath: join(process.cwd(), "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    args: [".", `--user-data-dir=${directory}`, "--dev"],
    env: { ...process.env, WORKPET_SKIP_INTEGRATIONS: "1", WORKPET_DATA_DIR: directory,
      WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json"), WORKET_SERVICE_URL: "https://124.223.223.215" },
  });
  for (let i = 0; i < 100; i++) {
    panel = app.windows().find(p => p.url().endsWith("/panel.html"));
    if (panel) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(panel);
  panel.on("dialog", d => d.accept());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html"))?.show());
}
const call = (action, input = {}) => panel.evaluate(({ action, input }) => window.workpet.distillation(action, input), { action, input });
async function waitForSamples(check) {
  for (let i = 0; i < 60; i++) {
    await call("syncImprovement");
    const rows = await call("improvementSamples");
    if (check(rows)) return rows;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.fail("样本同步未在 15 秒内完成");
}
try {
  await launch();
  let subscriptions;
  if (!resumed) {
    const initial = await panel.evaluate(() => window.workpet.getWorketServiceStatus());
    assert.equal(initial.automatic, true);
    assert.equal(initial.hasCredential, false);
    if (!await panel.locator(".secondary-menu").first().evaluate(element => element.open)) await panel.locator(".secondary-menu summary").first().click();
    await panel.locator("#service-settings").click();
    await panel.locator("#check-service").click();
    await panel.getByText("已连接", { exact: true }).waitFor({ timeout: 25000 });
    assert.equal((await panel.evaluate(() => window.workpet.getWorketServiceStatus())).hasCredential, true);
    await panel.screenshot({ path: join(output, "01-auto-connected.png") });
    await panel.locator("[data-close]").click();
    console.log("公网自动领取独立凭据并连接成功");
    await panel.locator("#tab-completed").click();
    await panel.locator("[data-distill-work]").check();
    await panel.locator("#distill-selected").click();
    assert.equal(await panel.locator("#improvement-consent").isChecked(), true);
    await panel.locator("#consent").check();
    await panel.locator("#start-distillation").click();
    let job;
    for (let i = 0; i < 330; i++) {
      const jobs = await call("jobs");
      if (jobs[0]) job = await call("job", { jobId: jobs[0].id });
      if (["AWAITING_REVIEW", "FAILED", "INTERRUPTED", "NEEDS_SELECTION"].includes(job?.status)) break;
      if (i % 15 === 0) console.log(`真实模型任务：${job?.status ?? "提交中"}`);
      await new Promise(r => setTimeout(r, 2000));
    }
    writeFileSync(join(output, "model-job.json"), JSON.stringify(job, null, 2));
    assert.equal(job?.status, "AWAITING_REVIEW", job?.error);
    const draft = await call("draft", { id: job.draftId });
    writeFileSync(join(output, "model-draft.json"), JSON.stringify(draft, null, 2));
    assert.equal(draft.issues.length, 0, "模型提出待确认问题，需检查合成案例结果，不自动绕过评审");
    await panel.getByRole("heading", { name: "检查候选定义", exact: true }).waitFor({ timeout: 15000 });
    await panel.locator("#definition-name").fill(`${marker} 项目周报（合成验收）`);
    await panel.screenshot({ path: join(output, "02-real-model-review.png") });
    await panel.locator("#publish-definition").click();
    await panel.locator("#use-definition").waitFor();
    const definition = (await call("definitions")).items[0];
    assert.deepEqual(definition.content.inputs.map(i => i.key).sort(), ["progress_notes", "project_name"]);
    await panel.locator("#use-definition").click();
    await panel.locator('[data-input="project_name"]').fill("测试项目乙");
    await panel.locator('[data-input="progress_notes"]').fill("测试已完成。下一步整理文档。风险未提供。");
    await panel.locator("#create-defined-work").click();
    await panel.locator("#definition-dialog").waitFor({ state: "hidden" });
    const dashboard = await panel.evaluate(() => window.workpet.getDashboard());
    const workId = dashboard.selectedWorkId;
    const delivery = join(directory, "synthetic-weekly-report.md");
    writeFileSync(delivery, "# 测试项目乙\n## 状态\n测试已完成。\n## 已完成事项\n测试已完成。\n## 风险\n未提供。\n## 下一步\n整理文档。\n");
    await call("attach", { workId, path: delivery });
    await panel.locator('[data-action="complete"]').click();
    for (const select of await panel.locator("[data-criterion]").all()) await select.selectOption("PASS");
    await panel.locator("[data-output]").check();
    await panel.locator("#accept-output").click();
    await panel.locator("#definition-dialog").waitFor({ state: "hidden" });
    subscriptions = await waitForSamples(rows => rows.length === 2 && rows.every(s => s.pending === 0 && !s.error));
    assert.equal(subscriptions.length, 2);
    assert.ok(subscriptions.every(s => s.pending === 0 && !s.error));
    console.log("真实模型沉淀、人工修改、复用与合成成果验收已同步至 VPS");
  } else {
    const job = (await call("jobs"))[0];
    assert.equal(job.status, "SAVED");
    subscriptions = await waitForSamples(rows => rows.length === 2 && rows.every(s => s.pending === 0 && !s.error));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const admin = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await admin.goto(`${adminUrl}/admin/`);
  await admin.locator("#admin-password").fill(credentials.password);
  await admin.locator("#login-submit").click();
  await admin.locator('[data-tab="samples"]').click();
  const sampleList = await admin.evaluate(() => fetch("/admin/api/samples").then(r => r.json()));
  const owned = sampleList.items.filter(s => subscriptions.some(local => local.id === s.client_id));
  assert.equal(owned.length, 2);
  const details = await admin.evaluate(ids => Promise.all(ids.map(id => fetch(`/admin/api/samples/${id}`).then(r => r.json()))), owned.map(s => s.id));
  for (const kind of ["SOURCE", "CANDIDATE", "EDIT", "PUBLISH", "REUSE", "ACCEPTANCE"]) {
    assert.ok(details.flatMap(s => s.events).some(e => e.kind === kind), kind);
  }
  assert.ok(details.some(d => JSON.stringify(d).includes(marker)));
  await admin.locator("#samples-list button").filter({ hasText: "工作沉淀" }).first().click();
  await admin.locator("#sample-detail details").first().locator("summary").first().click();
  await admin.screenshot({ path: join(output, "03-server-sample.png"), fullPage: true });
  if (!await panel.locator(".secondary-menu").first().evaluate(element => element.open)) await panel.locator(".secondary-menu summary").first().click();
  await panel.locator("#service-settings").click();
  await panel.locator("#improvement-data").click();
  await panel.locator("#improvement-consent").uncheck();
  await panel.waitForFunction(() => !document.querySelector("#improvement-consent")?.disabled);
  assert.ok((await call("improvementSamples")).every(s => s.state === "STOPPED"));
  const reuse = subscriptions.find(s => s.scope === "REUSE");
  await call("deleteImprovement", { id: reuse.id, confirmation: "删除样本" });
  await waitForSamples(rows => rows.find(s => s.id === reuse.id)?.state === "DELETED");
  const after = await admin.evaluate(() => fetch("/admin/api/samples").then(r => r.json()));
  assert.ok(!after.items.some(s => s.client_id === reuse.id));
  await panel.screenshot({ path: join(output, "04-stop-and-delete.png") });
  const subject = owned[0].subject;
  await app.close(); app = null;
  await launch();
  await call("capabilities");
  assert.deepEqual(await call("improvementPreference"), { enabled: false });
  const saved = await call("improvementSamples");
  assert.equal(saved.find(s => s.id === reuse.id).state, "DELETED");
  const clients = await admin.evaluate(() => fetch("/admin/api/config").then(r => r.json()));
  assert.ok(clients.clients.some(client => client.id === subject));
  // Report public identifiers only; never include the access token or installation secret.
  const report = { passed: true, marker, directory, subject, sourceSampleId: owned.find(s => s.client_id !== reuse.id).id,
    https: true, automaticConnection: true, realModel: true, syntheticSource: true, realExecutor: false,
    sampleKinds: ["SOURCE", "CANDIDATE", "EDIT", "PUBLISH", "REUSE", "ACCEPTANCE"],
    restartOptOut: true, deletionConfirmed: true, retainedSamples: 1, installedClientVisible: JSON.stringify(clients).includes(subject),
    desktopPackaged: false };
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
  await browser?.close();
}
