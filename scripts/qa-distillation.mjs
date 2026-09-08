import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { _electron as electron } from "playwright";
import { createWorkCore } from "../dist/core/index.js";
import { createAIService } from "../server/service.mjs";
import { source, result } from "../test/distillation/fixtures.ts";
const directory = mkdtempSync(join(tmpdir(), "worket-distillation-desktop-"));
const output = join(process.cwd(), "output", "distillation");
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
      return { result: result(wire), usage: { total_tokens: 1 } };
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
const executable = join(
  process.cwd(),
  "release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket",
);
async function launch() {
  const app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${directory}`, "--dev"],
    cwd: process.cwd(),
    env: {
      ...process.env,
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
  assert.equal(calls, 0);
  await panel.screenshot({ path: join(output, "01-confirm-range.png") });
  await panel.locator("#start-distillation").click();
  await panel
    .getByRole("heading", { name: "检查候选定义", exact: true })
    .waitFor({ timeout: 20000 });
  await panel.locator("#definition-name").fill("可复用竞品报告");
  await panel.screenshot({ path: join(output, "02-review-draft.png") });
  await panel.locator("#publish-definition").click();
  await panel.locator("#use-definition").waitFor();
  await panel.screenshot({ path: join(output, "03-saved-definition.png") });
  await panel.locator("#use-definition").click();
  await panel.locator('[data-input="customer"]').fill("客户丙");
  await panel.locator('[data-input="market"]').fill("欧洲市场");
  await panel.locator("#create-defined-work").click();
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
  await panel.locator('[data-action="complete"]').click();
  await panel.locator("[data-criterion]").selectOption("PASS");
  await panel.locator("[data-output]").check();
  await panel.screenshot({ path: join(output, "05-user-acceptance.png") });
  await panel.locator("#accept-output").click();
  assert.equal(
    (await panel.evaluate(() => window.workpet.getDashboard())).selectedWork
      .status,
    "COMPLETED",
  );
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
  const metrics = await panel.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.equal(metrics.scrollWidth, metrics.width);
  const report = {
    passed: true,
    mode: "synthetic-model-desktop-test",
    realModelAcceptance: false,
    realExecutorAcceptance: false,
    calls,
    workId,
    directory,
    metrics,
    restart: true,
    screenshots: 6,
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
