import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { _electron as electron } from "playwright";
import { createWorkCore } from "../dist/core/index.js";
import { ImprovementStore } from "../server/improvement.mjs";
import { createAIService } from "../server/service.mjs";
import { source, result } from "../test/distillation/fixtures.ts";
const directory = mkdtempSync(join(tmpdir(), "worket-distillation-desktop-"));
const improvementQA = process.argv.includes("--improvement");
const output = join(process.cwd(), "output", improvementQA ? "improvement-desktop" : "distillation");
const improvement = improvementQA ? new ImprovementStore(join(directory, "samples.sqlite")) : null;
mkdirSync(output, { recursive: true });
const core = createWorkCore({
  databasePath: join(directory, "workpet.sqlite"),
});
const original = source(core);
core.completeWork(original.instance.id);
core.close();
let calls = 0,
  wire;
const service = createAIService({
  improvement,
  mode: "development",
  devSecret: "local-ui-fixture-secret",
  issuer: "ui-test",
  audience: "worket-ai",
  providerName: "合成桌面测试供应商，不是真实模型",
  provider: {
    model: "fixture",
    async call(messages) {
      calls++;
      const data = JSON.parse(messages[1].content);
      if (data.phase === "extract") {
        wire = {
          schemaVersion: 1,
          snapshotHash: "test",
          sources: [
            {
              key: "work-1",
              events: data.events.map((e) => ({
                key: e.key,
                sequence: e.sequence,
                kind: e.kind,
                content: e.content,
                hash: e.hash,
              })),
            },
          ],
        };
        return {
          result: {
            requirements: [],
            issues: [],
            eventKeys: data.events.map((e) => `${e.sourceKey}/${e.key}`),
          },
          usage: { total_tokens: 1 },
        };
      }
      const candidate = result(wire);
      candidate.issues.push({ id: 'ui-review', type: 'UNCERTAIN_GENERALIZATION', field: 'methods', message: '请确认固定资料的使用范围', blocking: false });
      return { result: candidate, usage: { total_tokens: 1 } };
    },
  },
});
await new Promise((resolve) => service.server.listen(0, "127.0.0.1", resolve));
const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString(
    "base64url",
  ),
  body = Buffer.from(
    JSON.stringify({
      sub: "ui-user",
      iss: "ui-test",
      aud: "worket-ai",
      exp: Date.now() / 1000 + 3600,
    }),
  ).toString("base64url");
const token = `${header}.${body}.${createHmac("sha256", "local-ui-fixture-secret").update(`${header}.${body}`).digest("base64url")}`;
const unpackaged = process.argv.includes("--unpackaged");
const executable = process.env.WORKPET_EXECUTABLE_PATH ?? join(
  process.cwd(),
  unpackaged ? "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    : "release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket",
);
async function launch() {
  const app = await electron.launch({
    executablePath: executable,
    args: [...(unpackaged ? ["."] : []), `--user-data-dir=${directory}`, "--dev"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKPET_SKIP_INTEGRATIONS: "1",
      WORKPET_DATA_DIR: directory,
      WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json"),
    },
  });
  let panel;
  for (let i = 0; i < 100; i++) {
    panel = app.windows().find((p) => p.url().endsWith("/panel.html"));
    if (panel) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!panel) throw new Error("Panel did not start");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith("/panel.html"))
      ?.show(),
  );
  panel.on("dialog", (d) => d.accept());
  return { app, panel };
}
let app, panel, workId;
try {
  ({ app, panel } = await launch());
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.evaluate(
    ({ url, token }) => window.workpet.configureWorketService({ url, token }),
    { url: `http://127.0.0.1:${service.server.address().port}`, token },
  );
  await panel.locator("#tab-completed").click();
  await panel.locator("[data-distill-work]").check();
  await panel.locator("#tab-open").click();
  await panel.locator("#tab-completed").click();
  assert.equal(await panel.locator("[data-distill-work]").isChecked(), true);
  await panel.locator("#distill-selected").click();
  await panel.locator("#consent").check();
  assert.equal(await panel.locator("#improvement-consent").isChecked(), true);
  assert.equal(await panel.locator("#improvement-consent").isVisible(), true);
  // An unchecked choice survives closing, reopening, and refreshing the material range.
  await panel.locator("#improvement-consent").uncheck();
  await panel.locator("[data-close]").click();
  await panel.locator("#distill-selected").click();
  assert.equal(await panel.locator("#improvement-consent").isChecked(), false);
  await panel.locator("#apply-range").click();
  await panel.getByRole("heading", { name: "确认沉淀范围", exact: true }).waitFor();
  assert.equal(await panel.locator("#improvement-consent").isChecked(), false);
  if (improvementQA) await panel.locator("#improvement-consent").check();
  await panel.locator("#consent").check();
  assert.equal(calls, 0);
  await panel.screenshot({ path: join(output, "01-confirm-range.png") });
  await panel.locator("#start-distillation").click();
  await panel
    .getByRole("heading", { name: "检查候选定义", exact: true })
    .waitFor({ timeout: 20000 });
  await panel.locator("#definition-name").fill("可复用竞品报告");
  await panel.screenshot({ path: join(output, "02-review-draft.png") });
  const firstInput = panel.locator('[data-section="inputs"]').first();
  await firstInput.locator('[data-type]').selectOption('CHOICE');
  assert.equal(await firstInput.locator('[data-choices]').isVisible(), true);
  await firstInput.locator('[data-type]').selectOption('TEXT');
  assert.equal(await firstInput.locator('[data-choices]').isVisible(), false);
  await panel.locator('[data-resolution]').selectOption('ACCEPT');
  await panel.locator('[data-explanation]').fill('固定格式可复用');
  await panel.locator('[data-add="materialRoles"]').click();
  assert.equal(await panel.locator('[data-explanation]').inputValue(), '固定格式可复用');
  const material = panel.locator('[data-section="materialRoles"]').last();
  await material.locator('[data-text]').fill('报告格式');
  const materialPath = join(directory, 'report-format.txt');
  writeFileSync(materialPath, '合成固定格式：摘要、证据、建议。');
  await app.evaluate(({ dialog }, path) => {
    globalThis.__worketQAOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, materialPath);
  await material.locator('[data-material]').click();
  await panel.getByText(materialPath, { exact: true }).waitFor();
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.__worketQAOpenDialog; delete globalThis.__worketQAOpenDialog; });
  await panel.locator('#save-draft').click();
  await panel.waitForFunction(() => !document.querySelector('#save-draft')?.disabled);
  assert.equal(await panel.locator('#definition-name').inputValue(), '可复用竞品报告');
  assert.equal(await panel.locator('[data-explanation]').inputValue(), '固定格式可复用');
  assert.equal(await panel.getByText(materialPath, { exact: true }).count(), 1);
  await panel.locator('[data-add="constraints"]').scrollIntoViewIfNeeded();
  assert.equal(await panel.locator('#definition-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Long material paths must not widen the editor');
  await panel.screenshot({ path: join(output, '02b-review-fields.png') });
  await panel.locator("#publish-definition").click();
  await panel.locator("#use-definition").waitFor();
  await panel.screenshot({ path: join(output, "03-saved-definition.png") });
  await panel.locator("#use-definition").click();
  await panel.locator('[data-input="customer"]').fill("客户丙");
  await panel.locator('[data-input="market"]').fill("欧洲市场");
  assert.equal(await panel.locator("#improvement-consent").isChecked(), improvementQA);
  await panel.locator("#create-defined-work").click();
  await panel.locator("#definition-dialog").waitFor({ state: "hidden" });
  const dashboard = await panel.evaluate(() => window.workpet.getDashboard());
  workId = dashboard.selectedWorkId;
  assert.notEqual(workId, original.instance.id);
  assert.equal(dashboard.selectedWork.captureStatus, "stopped");
  const pkg = await panel.evaluate(
    (workId) => window.workpet.distillation("package", { workId }),
    workId,
  );
  assert.equal(pkg.json.inputs.customer, "客户丙");
  assert.equal(pkg.json.purpose, "START");
  assert.ok(!JSON.stringify(pkg).includes("客户甲"));
  assert.ok(!pkg.markdown.includes("[WORKPET:"));
  await panel.screenshot({ path: join(output, "04-new-instance.png") });
  const delivery = join(directory, "new-delivery.md");
  writeFileSync(
    delivery,
    "客户丙 / 欧洲市场：合成验收交付物，仅用于 UI 流程验证。",
  );
  await panel.evaluate(
    ({ workId, path }) =>
      window.workpet.distillation("attach", { workId, path }),
    { workId, path: delivery },
  );
  await panel.locator('#back-to-list').click();
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/panel.html')).webContents.send('panel:shown', id);
  }, workId);
  await panel.locator('[data-action="complete"]').click();
  await panel.locator("[data-criterion]").selectOption("PASS");
  await panel.locator("[data-output]").check();
  await panel.screenshot({ path: join(output, "05-user-acceptance.png") });
  await panel.locator("#accept-output").click();
  await panel.locator("#definition-dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await panel.evaluate(() => window.workpet.getDashboard())).selectedWork
      .status,
    "COMPLETED",
  );
  if (improvementQA) {
    await panel.evaluate(() => window.workpet.distillation("syncImprovement"));
    const samples = improvement.list();
    assert.equal(samples.length, 2);
    const events = samples.flatMap(s => improvement.get(s.id).events);
    for (const kind of ["SOURCE", "CANDIDATE", "EDIT", "PUBLISH", "REUSE", "ACCEPTANCE"]) assert.ok(events.some(e => e.kind === kind), kind);
    assert.ok(Object.values(events.find(e => e.kind === "ACCEPTANCE").data.criteriaResults).every(v => v === "PASS"));
  }
  assert.deepEqual(errors, []);
  await app.close();
  app = null;
  ({ app, panel } = await launch());
  const recovered = await panel.evaluate(
    (workId) => window.workpet.getDashboard(workId),
    workId,
  );
  assert.equal(recovered.selectedWork.status, "COMPLETED");
  assert.equal(
    (await panel.evaluate(() => window.workpet.distillation("definitions")))
      .items.length,
    1,
  );
  await panel.locator("#tab-definitions").click();
  await panel.getByRole("heading", { name: "可复用竞品报告" }).waitFor();
  await panel.screenshot({
    path: join(output, "06-restarted-definitions.png"),
  });
  if (improvementQA) {
    await panel.locator(".secondary-menu summary").click();
    await panel.locator("#service-settings").click();
    await panel.locator("#improvement-data").click();
    await panel.getByRole("heading", { name: "改进数据", exact: true }).waitFor();
    await panel.locator("#improvement-consent").uncheck();
    await panel.waitForFunction(() => !document.querySelector("#improvement-consent")?.disabled);
    assert.ok((await panel.evaluate(() => window.workpet.distillation("improvementSamples"))).every(s => s.state === "STOPPED"));
    await panel.screenshot({ path: join(output, "07-stop-collection.png") });
    const sampleId = improvement.list()[0].client_id;
    const section = panel.locator("section").filter({ has: panel.locator(`[data-delete-confirm="${sampleId}"]`) });
    await section.locator("summary").click();
    await panel.locator(`[data-delete-confirm="${sampleId}"]`).fill("删除样本");
    await panel.locator(`[data-delete-sample="${sampleId}"]`).click();
    await panel.locator("#sync-improvement").click();
    assert.equal(improvement.list().length, 1);
    await panel.screenshot({ path: join(output, "08-delete-sample.png") });
  }
  // Persist the opt-out across a full process restart, including the reuse page.
  await app.close();
  app = null;
  ({ app, panel } = await launch());
  assert.deepEqual(await panel.evaluate(() => window.workpet.distillation("improvementPreference")), { enabled: false });
  await panel.locator("#tab-definitions").click();
  await panel.locator("[data-definition]").click();
  await panel.locator("#use-definition").click();
  assert.equal(await panel.locator("#improvement-consent").isChecked(), false);
  await panel.screenshot({ path: join(output, "09-opt-out-after-restart.png") });
  const metrics = await panel.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.equal(metrics.scrollWidth, metrics.width);
  const report = {
    passed: true,
    mode: improvementQA ? "synthetic-improvement-desktop-test" : "synthetic-model-desktop-test",
    realModelAcceptance: false,
    realExecutorAcceptance: false,
    calls,
    workId,
    directory,
    metrics,
    restart: true,
    screenshots: improvementQA ? 10 : 8,
    unpackaged,
    defaultEnabled: true,
    persistentOptOut: true,
  };
  writeFileSync(
    join(output, "desktop-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
  await service.close();
}
