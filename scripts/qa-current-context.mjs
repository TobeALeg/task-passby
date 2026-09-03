import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { _electron as electron } from "playwright";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const outputDirectory = join(root, "output", "playwright");
const testDirectory = await mkdtemp(join(tmpdir(), "workpet-current-context-"));
const screenshotPath = join(outputDirectory, "current-context-panel.png");
const petScreenshotPath = join(outputDirectory, "current-context-pet-hover.png");

await mkdir(outputDirectory, { recursive: true });

const electronApp = await electron.launch({
  executablePath: join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
  args: [".", `--user-data-dir=${testDirectory}`],
  cwd: root,
  env: {
    ...process.env,
    WORKPET_BRIDGE_CONFIG: join(testDirectory, "bridge.json"),
    WORKPET_DATA_DIR: testDirectory
  }
});

try {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const pages = electronApp.windows();
  const pet = pages.find((page) => page.url().endsWith("/pet.html"));
  const panel = pages.find((page) => page.url().endsWith("/panel.html"));
  if (!pet || !panel) throw new Error(`WorkPet 窗口不完整：${pages.map((page) => page.url()).join(", ")}`);
  const rendererErrors = [];
  pet.on("pageerror", (error) => rendererErrors.push(error.message));

  await electronApp.evaluate(({ BrowserWindow }) => {
    const panelWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("/panel.html"));
    panelWindow?.show();
    panelWindow?.focus();
  });
  await panel.waitForTimeout(200);
  const paperAction = pet.locator("#paper-action");
  await paperAction.waitFor({ state: "visible", timeout: 5_000 });
  await pet.waitForFunction(() => !document.querySelector("#paper-action")?.hasAttribute("disabled"), undefined, { timeout: 15_000 });
  const conversationTitle = await pet.locator("#context-title").innerText();

  const foregroundBeforeClick = JSON.parse((await execFileAsync(join(root, "dist", "foreground-context"))).stdout.trim());
  await paperAction.hover();
  await pet.screenshot({ path: petScreenshotPath });
  await paperAction.click();
  let dashboard = await pet.evaluate(() => window.workpet.getDashboard());
  for (let attempt = 0; attempt < 120 && !dashboard.works.length && !dashboard.notice; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    dashboard = await pet.evaluate(() => window.workpet.getDashboard());
  }
  await panel.screenshot({ path: screenshotPath });

  if (!dashboard.selectedWork || dashboard.selectedWork.bindings[0]?.adapter !== "codex") {
    throw new Error(
      `点击桌宠后没有创建当前 Codex 工作：${dashboard.notice ?? "无提示"}；点击前台=${JSON.stringify(foregroundBeforeClick)}；渲染错误=${rendererErrors.join(" | ") || "无"}`
    );
  }
  await pet.waitForFunction(() => document.querySelector("#paper-action")?.getAttribute("data-action") === "open", undefined, { timeout: 10_000 });
  if (!conversationTitle.trim()) throw new Error("当前会话气泡没有展示应用生成的标题");
  if (await panel.locator("textarea[data-item-id], [data-remove-item]").count()) {
    throw new Error("只读 Work State 中仍存在编辑或删除控件");
  }

  console.log(JSON.stringify({
    passed: true,
    foregroundBeforeClick,
    workId: dashboard.selectedWork.id,
    title: dashboard.selectedWork.title,
    conversationTitle,
    binding: dashboard.selectedWork.bindings[0],
    screenshots: [petScreenshotPath, screenshotPath],
    database: join(testDirectory, "workpet.sqlite")
  }, null, 2));
} finally {
  await electronApp.close();
}
